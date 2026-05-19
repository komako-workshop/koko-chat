import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Animated,
  AppState,
  Easing,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ListRenderItemInfo
} from "react-native";
import { Link, useLocalSearchParams, useNavigation, router } from "expo-router";
import { useHeaderHeight } from "@react-navigation/elements";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";

import { CachedImage } from "@/components/CachedImage";
import { MarkdownText } from "@/components/MarkdownText";
import { useGatewayStore } from "@/state/gateway";
import { useConversationStore, type ChatMessage, type ConversationMeta } from "@/state/conversations";
import { MessageBlockView } from "@/runtime/messageBlocks";
import { getMiniAppListImage } from "@/runtime/miniApps";
import { KokoColors, KokoRadius } from "@/theme/koko";

const KOKO_CHAT_AVATAR = require("../../assets/brand/chat-avatar.png");
const NEAR_BOTTOM_THRESHOLD_PX = 44;

interface ChatScrollSnapshot {
  contentHeight: number;
  viewportHeight: number;
  offsetY: number;
  isNearBottom: boolean;
}

const chatScrollSnapshots = new Map<string, ChatScrollSnapshot>();

function messageKey(message: ChatMessage): string {
  return `${message.role}:${message.runId ?? "local"}:${message.id}`;
}

function saveChatScrollSnapshot(
  conversationId: string | null,
  metrics: ChatScrollSnapshot
): void {
  if (conversationId === null) return;
  chatScrollSnapshots.set(conversationId, {
    contentHeight: metrics.contentHeight,
    viewportHeight: metrics.viewportHeight,
    offsetY: Math.max(0, metrics.offsetY),
    isNearBottom: metrics.isNearBottom
  });
}

/**
 * True when `current` is from the same agent "turn" as `previous`. We use it
 * to collapse the avatar on follow-up bubbles, IM-style.
 */
function isAgentContinuation(previous: ChatMessage | undefined, current: ChatMessage): boolean {
  if (current.role !== "agent") return false;
  if (previous === undefined) return false;
  if (previous.role !== "agent") return false;
  // Same logical turn: same OpenClaw run, or both are local-only welcome /
  // bootstrap messages without a runId.
  return previous.runId === current.runId;
}

/**
 * Per-mini-app empty-state hint shown before any messages exist. Keeping
 * the strings here (rather than in each mini-app descriptor) avoids a
 * descriptor field churn just for one piece of copy; we can promote this
 * into the descriptor later if more mini-apps need their own onboarding.
 */
function getEmptyStateHint(mode: string, isConnected: boolean): string {
  const offlineHint = "连接 OpenClaw 之后，这里就能开始对话。";
  if (!isConnected) {
    if (mode === "tavern") {
      return [
        "酒馆助手：告诉我想找什么样的角色扮演伙伴，",
        "连上 OpenClaw 之后我会从角色卡库里推荐几张给你。"
      ].join("\n");
    }
    if (mode === "tavern-roleplay") {
      return "从酒馆的推荐卡进入这里开始角色扮演。" + "\n" + offlineHint;
    }
    return offlineHint;
  }
  if (mode === "tavern") {
    return "告诉我想找什么样的角色扮演伙伴吧～";
  }
  if (mode === "tavern-roleplay") {
    return "请从酒馆里选一张角色卡进入这里。";
  }
  return "跟 Koko 说点什么吧～";
}

/**
 * "Block-only" agent messages — no text, no error, just one or more rendered
 * blocks (sticker, tavern card, …). These blocks own their full visual
 * presentation (border, background, padding); wrapping them inside the
 * default white agent bubble would double up padding/border and squash the
 * inner layout. We render them on a transparent bubble instead.
 */
function isBlockOnlyMessage(message: ChatMessage): boolean {
  return (
    message.role === "agent" &&
    message.text.length === 0 &&
    message.error === undefined &&
    message.blocks !== undefined &&
    message.blocks.length > 0
  );
}

function renderAgentBody(message: ChatMessage): React.ReactElement | null {
  const hasText = message.text.length > 0;
  if (!hasText && message.streaming !== true) return null;
  // Show the breathing pulse only while waiting for the very first token.
  // Once any text has streamed in, the growing text itself signals "still
  // working" — same pattern as ChatGPT / Claude.
  if (!hasText) {
    return <StreamingPulse />;
  }
  return <MarkdownText text={message.text} color={KokoColors.ink} />;
}

function renderUserBody(message: ChatMessage): React.ReactElement | null {
  if (message.text.length === 0) return null;
  return <Text style={[styles.messageText, styles.userText]}>{message.text}</Text>;
}

/**
 * Breathing-halo "thinking" indicator. A solid Koko-orange core with two
 * staggered halo rings that scale out and fade. Designed to read as "Koko
 * is thinking" without the typewriter implication of 3-dot bouncers.
 *
 * Loop period is 1600ms; the second halo is offset by 800ms so the user
 * always sees one ring expanding while the other dissolves — no dead frames.
 */
function StreamingPulse(): React.ReactElement {
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const makeLoop = (value: Animated.Value): Animated.CompositeAnimation =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(value, {
            toValue: 1,
            duration: 1600,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true
          }),
          Animated.timing(value, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true
          })
        ])
      );

    const loop1 = makeLoop(ring1);
    loop1.start();

    // The second ring kicks in 800ms later so the two halos overlap and the
    // user never sees a dead frame. We keep the loop handle in a tiny holder
    // so the cleanup below can stop it without recomputing scope.
    const loop2Holder: { current?: Animated.CompositeAnimation } = {};
    const offsetTimer = setTimeout(() => {
      const loop2 = makeLoop(ring2);
      loop2.start();
      loop2Holder.current = loop2;
    }, 800);

    return () => {
      loop1.stop();
      clearTimeout(offsetTimer);
      loop2Holder.current?.stop();
    };
  }, [ring1, ring2]);

  const haloStyle = (value: Animated.Value) => ({
    transform: [
      {
        scale: value.interpolate({
          inputRange: [0, 1],
          outputRange: [0.55, 1.9]
        })
      }
    ],
    opacity: value.interpolate({
      inputRange: [0, 0.85, 1],
      outputRange: [0.45, 0, 0]
    })
  });

  return (
    <View
      style={styles.streamingPulse}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="正在思考"
    >
      <Animated.View style={[styles.streamingHalo, haloStyle(ring1)]} />
      <Animated.View style={[styles.streamingHalo, haloStyle(ring2)]} />
      <View style={styles.streamingCore} />
    </View>
  );
}

function renderMessageBlocks(
  message: ChatMessage,
  conversation: ConversationMeta
): React.ReactElement | null {
  if (message.blocks === undefined || message.blocks.length === 0) return null;
  return (
    <View style={styles.blocksColumn}>
      {message.blocks.map((block, index) => (
        <MessageBlockView
          key={`${block.type}:${block.version}:${index}`}
          block={block}
          conversation={conversation}
        />
      ))}
    </View>
  );
}

interface MessageRowProps {
  item: ChatMessage;
  conversation: ConversationMeta;
  isContinuation: boolean;
}

function MessageRow({ item, conversation, isContinuation }: MessageRowProps): React.ReactElement {
  const isAgent = item.role === "agent";
  const hasBlocks = item.blocks !== undefined && item.blocks.length > 0;
  const blockOnly = isBlockOnlyMessage(item);
  const body = isAgent ? renderAgentBody(item) : renderUserBody(item);
  // In-chat agent avatar resolution, in order of priority:
  //   1. The conversation's own listSnapshot.avatarUri — e.g. a Character
  //      Tavern card portrait set by a mini-app at create time.
  //   2. The mini-app descriptor's bundled listImage.
  //   3. The Koko mascot, as a friendly default.
  const conversationAvatarUri = conversation.listSnapshot?.avatarUri;
  const agentAvatar =
    conversationAvatarUri !== undefined && conversationAvatarUri.length > 0
      ? { uri: conversationAvatarUri }
      : getMiniAppListImage(conversation.mode) ?? KOKO_CHAT_AVATAR;

  const bubble = (
    <View
      style={[
        styles.bubble,
        isAgent ? styles.agentBubble : styles.userBubble,
        blockOnly && styles.blockOnlyBubble
      ]}
    >
      {item.error !== undefined ? (
        <Text style={styles.errorText}>⚠️ {item.error}</Text>
      ) : hasBlocks ? (
        <View style={styles.blocksColumn}>
          {renderMessageBlocks(item, conversation)}
          {body}
        </View>
      ) : (
        body
      )}
    </View>
  );

  if (isAgent) {
    return (
      <View style={[styles.agentRow, isContinuation && styles.agentRowContinuation]}>
        {isContinuation ? (
          <View style={styles.avatarSpacer} />
        ) : (
          <CachedImage source={agentAvatar} style={styles.avatar} contentFit="cover" />
        )}
        {bubble}
      </View>
    );
  }

  return <View style={styles.userRow}>{bubble}</View>;
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = typeof id === "string" ? id : null;

  const conversation = useConversationStore((s) =>
    conversationId !== null ? s.list.find((m) => m.id === conversationId) ?? null : null
  );
  const messages = useConversationStore((s) =>
    conversationId !== null ? s.messages[conversationId] ?? EMPTY : EMPTY
  );
  const status = useGatewayStore((s) => s.status);
  const sendUserMessage = useGatewayStore((s) => s.sendUserMessage);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const headerHeight = useHeaderHeight();
  const isNearBottomRef = useRef(true);
  const scrollMetricsRef = useRef({
    contentHeight: 0,
    viewportHeight: 0,
    offsetY: 0
  });
  const pendingScrollRestoreRef = useRef<ChatScrollSnapshot | null>(
    conversationId === null ? null : chatScrollSnapshots.get(conversationId) ?? null
  );
  const hasRestoredScrollRef = useRef(pendingScrollRestoreRef.current === null);

  function updateNearBottom(): void {
    const { contentHeight, viewportHeight, offsetY } = scrollMetricsRef.current;
    if (contentHeight <= 0 || viewportHeight <= 0) {
      isNearBottomRef.current = true;
      return;
    }
    const distanceToBottom = contentHeight - (offsetY + viewportHeight);
    isNearBottomRef.current = distanceToBottom <= NEAR_BOTTOM_THRESHOLD_PX;
  }

  function saveCurrentScrollSnapshot(): void {
    saveChatScrollSnapshot(conversationId, {
      ...scrollMetricsRef.current,
      isNearBottom: isNearBottomRef.current
    });
  }

  function scrollToBottomSoon(animated: boolean): void {
    setTimeout(() => {
      listRef.current?.scrollToEnd({ animated });
    }, 16);
  }

  function tryRestoreSavedScroll(): boolean {
    const snapshot = pendingScrollRestoreRef.current;
    if (snapshot === null || hasRestoredScrollRef.current) return false;

    const { contentHeight, viewportHeight } = scrollMetricsRef.current;
    if (contentHeight <= 0 || viewportHeight <= 0) return true;

    hasRestoredScrollRef.current = true;
    pendingScrollRestoreRef.current = null;

    if (snapshot.isNearBottom) {
      isNearBottomRef.current = true;
      scrollToBottomSoon(false);
      return true;
    }

    const maxOffset = Math.max(0, contentHeight - viewportHeight);
    const offset = Math.min(Math.max(0, snapshot.offsetY), maxOffset);
    scrollMetricsRef.current = {
      ...scrollMetricsRef.current,
      offsetY: offset
    };
    updateNearBottom();

    setTimeout(() => {
      listRef.current?.scrollToOffset({ offset, animated: false });
    }, 16);
    return true;
  }

  function handleListScroll(event: NativeSyntheticEvent<NativeScrollEvent>): void {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    scrollMetricsRef.current = {
      contentHeight: contentSize.height,
      viewportHeight: layoutMeasurement.height,
      offsetY: contentOffset.y
    };
    updateNearBottom();
    saveCurrentScrollSnapshot();
  }

  function handleListLayout(height: number): void {
    scrollMetricsRef.current = {
      ...scrollMetricsRef.current,
      viewportHeight: height
    };
    updateNearBottom();
    tryRestoreSavedScroll();
  }

  function handleContentSizeChange(height: number): void {
    const shouldFollowBottom = isNearBottomRef.current;
    scrollMetricsRef.current = {
      ...scrollMetricsRef.current,
      contentHeight: height
    };
    updateNearBottom();
    if (tryRestoreSavedScroll()) return;
    if (shouldFollowBottom && messages.length > 0) {
      scrollToBottomSoon(false);
    }
  }

  // Register this conversation as the currently active one so side effects
  // (routing in from a notification, cross-mini-app nav, etc.) can reason
  // about "which conversation is the user looking at right now".
  useEffect(() => {
    if (conversationId === null) return;
    useConversationStore.getState().select(conversationId);
    return () => {
      const current = useConversationStore.getState().activeId;
      if (current === conversationId) {
        useConversationStore.getState().clearActive();
      }
    };
  }, [conversationId]);

  const navigation = useNavigation();
  // The 酒馆助手 conversation gets an extra header button that jumps to the
  // browse grid. Other mini-app conversations don't surface this — they're
  // either character-bound (tavern-roleplay) or unrelated (koko, etc).
  const showBrowseShortcut = conversation?.mode === "tavern";
  useLayoutEffect(() => {
    navigation.setOptions({
      title: conversation?.title ?? "聊天",
      headerRight: showBrowseShortcut
        ? () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="角色广场"
              onPress={() => router.push("/tavern/browse")}
              hitSlop={10}
              style={({ pressed }) => [
                styles.headerButton,
                pressed && styles.headerButtonPressed
              ]}
            >
              <Ionicons name="grid-outline" size={20} color={KokoColors.primaryDeep} />
            </Pressable>
          )
        : undefined
    });
  }, [conversation?.title, navigation, showBrowseShortcut]);

  useEffect(() => {
    const snapshot = conversationId === null
      ? null
      : chatScrollSnapshots.get(conversationId) ?? null;
    pendingScrollRestoreRef.current = snapshot;
    hasRestoredScrollRef.current = snapshot === null;
    if (snapshot !== null) {
      isNearBottomRef.current = snapshot.isNearBottom;
    }
  }, [conversationId]);

  useEffect(() => {
    if (messages.length === 0) return;
    if (pendingScrollRestoreRef.current !== null && !hasRestoredScrollRef.current) return;
    if (!isNearBottomRef.current) return;
    const timer = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: false });
    }, 16);
    return () => clearTimeout(timer);
  }, [messages]);

  useEffect(() => {
    return () => {
      saveCurrentScrollSnapshot();
    };
  }, [conversationId]);

  useEffect(() => {
    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") {
        // iOS can restore a stale keyboard frame after backgrounding, which
        // makes KeyboardAvoidingView collapse the FlatList and place the input
        // bar directly under the header. Dismissing before suspension avoids
        // resuming into that broken layout state.
        Keyboard.dismiss();
      }
    });
    const keyboardShowSubscription = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => {
        if (isNearBottomRef.current) {
          scrollToBottomSoon(true);
        }
      }
    );
    return () => {
      appStateSubscription.remove();
      keyboardShowSubscription.remove();
    };
  }, []);

  async function handleSend(): Promise<void> {
    if (conversationId === null) return;
    if (sending || draft.trim().length === 0) return;
    const text = draft;
    setDraft("");
    setSending(true);
    try {
      await sendUserMessage(conversationId, text);
    } catch (error) {
      console.error("send failed", error);
    } finally {
      setSending(false);
    }
  }

  if (conversationId === null || conversation === null) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.fallback}>
          <Text style={styles.fallbackTitle}>找不到该会话</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace("/")}
            style={styles.fallbackButton}
          >
            <Text style={styles.fallbackButtonText}>回到聊天列表</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const isConnected = status === "connected";
  const isRecoveringConnection = status === "connecting" || status === "handshaking";
  // Mini-apps can mark a conversation as still bootstrapping (e.g. tavern
  // roleplay fetching the character card + translating). While loading we
  // show a banner and lock the input; on error we show the reason but keep
  // input locked so the user doesn't send into a half-set-up chat.
  const bootstrap = conversation.bootstrap;
  const isBootstrapping = bootstrap?.status === "loading";
  const bootstrapError = bootstrap?.status === "error" ? bootstrap.error ?? "加载失败" : null;
  const sendDisabled =
    sending ||
    draft.trim().length === 0 ||
    !isConnected ||
    isBootstrapping ||
    bootstrapError !== null;

  return (
    <SafeAreaView style={styles.screen} edges={["left", "right", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={headerHeight}
      >
        {isBootstrapping ? (
          <View style={[styles.banner, styles.bannerRow]}>
            <View style={styles.bannerPulseSlot}>
              <StreamingPulse />
            </View>
            <View style={styles.bannerTextColumn}>
              <Text style={styles.bannerTitle}>正在加载角色卡</Text>
              <Text style={styles.bannerHint}>
                {bootstrap?.hint ?? "正在拉取角色信息，准备好就可以开始聊天。"}
              </Text>
            </View>
          </View>
        ) : bootstrapError !== null ? (
          <View style={styles.banner}>
            <Text style={styles.bannerTitle}>角色卡加载失败</Text>
            <Text style={styles.bannerHint}>{bootstrapError}</Text>
          </View>
        ) : isRecoveringConnection ? (
          <View style={styles.banner}>
            <Text style={styles.bannerTitle}>正在连接 OpenClaw</Text>
            <Text style={styles.bannerHint}>正在恢复本地 Gateway 连接，稍等一下就能继续聊天。</Text>
          </View>
        ) : !isConnected ? (
          <Link href="/pair" asChild>
            <Pressable accessibilityRole="button" style={styles.banner}>
              <Text style={styles.bannerTitle}>未连接 OpenClaw</Text>
              <Text style={styles.bannerHint}>
                配对成功后，Koko 才能为你生成新回答 · 点这里去配对
              </Text>
            </Pressable>
          </Link>
        ) : null}
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={messageKey}
          renderItem={({ item, index }: ListRenderItemInfo<ChatMessage>) => (
            <MessageRow
              item={item}
              conversation={conversation}
              isContinuation={isAgentContinuation(messages[index - 1], item)}
            />
          )}
          contentContainerStyle={styles.listContent}
          onLayout={(event) => {
            handleListLayout(event.nativeEvent.layout.height);
          }}
          onScroll={handleListScroll}
          scrollEventThrottle={16}
          onContentSizeChange={(_width, height) => {
            handleContentSizeChange(height);
          }}
          ListEmptyComponent={
            // While the conversation is still bootstrapping the top banner
            // already explains what's happening. The "请从酒馆里选一张角色卡
            // 进入这里" prompt is only meaningful when the user has somehow
            // landed on an empty tavern-roleplay session that's *not* loading
            // (a true edge case) — hide it during loading so the screen
            // doesn't tell the user to "pick a card" from inside a card they
            // already picked.
            isBootstrapping || bootstrapError !== null ? null : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>
                  {getEmptyStateHint(conversation.mode, isConnected)}
                </Text>
              </View>
            )
          }
        />

        <View style={styles.inputDock}>
          <View style={styles.inputBar}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={
                isBootstrapping
                  ? "角色卡加载中…"
                  : bootstrapError !== null
                    ? "角色卡加载失败，无法发送"
                    : isConnected
                      ? "说点什么…"
                      : "连接 OpenClaw 后可以聊天"
              }
              placeholderTextColor={KokoColors.inkPlaceholder}
              editable={isConnected && !isBootstrapping && bootstrapError === null}
              multiline
              onFocus={() => {
                if (isNearBottomRef.current) {
                  scrollToBottomSoon(true);
                }
              }}
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              disabled={sendDisabled}
              onPress={() => void handleSend()}
              style={[styles.sendButton, sendDisabled && styles.sendButtonDisabled]}
            >
              <Text style={styles.sendButtonText}>发送</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const EMPTY: ChatMessage[] = [];

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: KokoColors.bg
  },
  flex: {
    flex: 1
  },
  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 16
  },
  agentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    alignSelf: "flex-start",
    maxWidth: "88%",
    marginTop: 12,
    marginBottom: 2
  },
  agentRowContinuation: {
    marginTop: 2
  },
  userRow: {
    alignSelf: "flex-end",
    maxWidth: "88%",
    marginTop: 12,
    marginBottom: 2
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: KokoRadius.pill,
    marginRight: 8,
    marginTop: 2,
    backgroundColor: KokoColors.primarySoft
  },
  avatarSpacer: {
    width: 36,
    marginRight: 8
  },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: KokoRadius.xl,
    flexShrink: 1
  },
  agentBubble: {
    backgroundColor: KokoColors.surface,
    borderTopLeftRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: KokoColors.border
  },
  blockOnlyBubble: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    backgroundColor: "transparent",
    borderWidth: 0
  },
  userBubble: {
    backgroundColor: KokoColors.primary,
    borderTopRightRadius: 8
  },
  messageText: {
    fontSize: 16,
    lineHeight: 24
  },
  agentText: {
    color: KokoColors.ink
  },
  userText: {
    color: "#FFFFFF"
  },
  streamingPulse: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center"
  },
  streamingHalo: {
    position: "absolute",
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: KokoColors.primary
  },
  streamingCore: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: KokoColors.primary
  },
  errorText: {
    fontSize: 14,
    color: KokoColors.danger
  },
  headerButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: KokoRadius.pill,
    alignItems: "center",
    justifyContent: "center"
  },
  headerButtonPressed: {
    backgroundColor: KokoColors.surfaceSoft
  },
  blocksColumn: {
    gap: 8
  },
  inputDock: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 6,
    backgroundColor: KokoColors.bg
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: KokoColors.surface,
    borderRadius: KokoRadius.pill,
    paddingLeft: 6,
    paddingRight: 6,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: KokoColors.hairline
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 36,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    fontSize: 16,
    color: KokoColors.ink
  },
  sendButton: {
    minWidth: 56,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: KokoRadius.pill,
    backgroundColor: KokoColors.primary,
    marginLeft: 4
  },
  sendButtonDisabled: {
    backgroundColor: KokoColors.primarySoft
  },
  sendButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFFFFF"
  },
  emptyState: {
    marginTop: 64,
    alignItems: "center"
  },
  emptyText: {
    fontSize: 14,
    color: KokoColors.inkMuted
  },
  banner: {
    marginHorizontal: 12,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: KokoRadius.lg,
    backgroundColor: KokoColors.primarySoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: KokoColors.border
  },
  bannerTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: KokoColors.ink
  },
  bannerHint: {
    marginTop: 2,
    fontSize: 12,
    color: KokoColors.inkSecondary
  },
  bannerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  bannerPulseSlot: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center"
  },
  bannerTextColumn: {
    flex: 1
  },
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24
  },
  fallbackTitle: {
    fontSize: 17,
    color: KokoColors.ink,
    textAlign: "center"
  },
  fallbackButton: {
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: KokoRadius.xl,
    backgroundColor: KokoColors.primary
  },
  fallbackButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FFFFFF"
  }
});
