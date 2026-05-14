import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AppState,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo
} from "react-native";
import { Link, useLocalSearchParams, useNavigation, router } from "expo-router";
import { useHeaderHeight } from "@react-navigation/elements";
import { SafeAreaView } from "react-native-safe-area-context";

import { MarkdownText } from "@/components/MarkdownText";
import { useGatewayStore } from "@/state/gateway";
import { useConversationStore, type ChatMessage, type ConversationMeta } from "@/state/conversations";
import { MessageBlockView } from "@/runtime/messageBlocks";
import { KokoColors, KokoRadius } from "@/theme/koko";

const KOKO_CHAT_AVATAR = require("../../assets/brand/chat-avatar.png");
const KOKO_STICKER_BLOCK_TYPE = "koko.sticker";

function messageKey(message: ChatMessage): string {
  return `${message.role}:${message.runId ?? "local"}:${message.id}`;
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

function isStickerOnlyMessage(message: ChatMessage): boolean {
  return (
    message.role === "agent" &&
    message.text.length === 0 &&
    message.error === undefined &&
    message.blocks?.length === 1 &&
    message.blocks[0]?.type === KOKO_STICKER_BLOCK_TYPE
  );
}

function renderAgentBody(message: ChatMessage): React.ReactElement | null {
  const hasText = message.text.length > 0;
  if (!hasText && message.streaming !== true) return null;
  const trailing = message.streaming === true ? <StreamingCursor /> : undefined;
  return (
    <MarkdownText
      text={message.text}
      color={KokoColors.ink}
      trailing={trailing}
    />
  );
}

function renderUserBody(message: ChatMessage): React.ReactElement | null {
  if (message.text.length === 0) return null;
  return <Text style={[styles.messageText, styles.userText]}>{message.text}</Text>;
}

function StreamingCursor(): React.ReactElement {
  return <Text style={styles.streamingCursor}> ·</Text>;
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
  const stickerOnly = isStickerOnlyMessage(item);
  const body = isAgent ? renderAgentBody(item) : renderUserBody(item);

  const bubble = (
    <View
      style={[
        styles.bubble,
        isAgent ? styles.agentBubble : styles.userBubble,
        stickerOnly && styles.stickerBubble
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
          <Image source={KOKO_CHAT_AVATAR} style={styles.avatar} />
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
  useLayoutEffect(() => {
    navigation.setOptions({
      title: conversation?.title ?? "聊天"
    });
  }, [conversation?.title, navigation]);

  useEffect(() => {
    if (messages.length === 0) return;
    const timer = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: false });
    }, 16);
    return () => clearTimeout(timer);
  }, [messages]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") {
        // iOS can restore a stale keyboard frame after backgrounding, which
        // makes KeyboardAvoidingView collapse the FlatList and place the input
        // bar directly under the header. Dismissing before suspension avoids
        // resuming into that broken layout state.
        Keyboard.dismiss();
      }
    });
    return () => subscription.remove();
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

  const isConnected = status === "connected" || status === "handshaking";
  const sendDisabled = sending || draft.trim().length === 0 || !isConnected;

  return (
    <SafeAreaView style={styles.screen} edges={["left", "right", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={headerHeight}
      >
        {!isConnected ? (
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
          onContentSizeChange={() => {
            if (messages.length > 0) {
              listRef.current?.scrollToEnd({ animated: false });
            }
          }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>
                {getEmptyStateHint(conversation.mode, isConnected)}
              </Text>
            </View>
          }
        />

        <View style={styles.inputDock}>
          <View style={styles.inputBar}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={isConnected ? "说点什么…" : "连接 OpenClaw 后可以聊天"}
              placeholderTextColor={KokoColors.inkPlaceholder}
              editable={isConnected}
              multiline
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
  stickerBubble: {
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
  streamingCursor: {
    opacity: 0.6
  },
  errorText: {
    fontSize: 14,
    color: KokoColors.danger
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
