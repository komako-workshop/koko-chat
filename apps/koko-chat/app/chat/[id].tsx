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

import { useGatewayStore } from "@/state/gateway";
import { useConversationStore, type ChatMessage, type ConversationMeta } from "@/state/conversations";
import { MessageBlockView } from "@/runtime/messageBlocks";
import { KokoColors, KokoRadius } from "@/theme/koko";

const KOKO_CHAT_AVATAR = require("../../assets/brand/chat-avatar.png");

function messageKey(message: ChatMessage): string {
  return `${message.role}:${message.runId ?? "local"}:${message.id}`;
}

function renderMessageText(message: ChatMessage, isAgent: boolean): React.ReactElement | null {
  if (message.text.length === 0 && message.streaming !== true) return null;
  return (
    <Text style={[styles.messageText, isAgent ? styles.agentText : styles.userText]}>
      {message.text}
      {message.streaming === true ? (
        <Text style={styles.streamingCursor}> ▋</Text>
      ) : null}
    </Text>
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

function renderMessage(
  { item }: ListRenderItemInfo<ChatMessage>,
  conversation: ConversationMeta
): React.ReactElement {
  const isAgent = item.role === "agent";
  const hasBlocks = item.blocks !== undefined && item.blocks.length > 0;
  const bubble = (
    <View style={[styles.bubble, isAgent ? styles.agentBubble : styles.userBubble]}>
      {item.error !== undefined ? (
        <Text style={styles.errorText}>⚠️ {item.error}</Text>
      ) : hasBlocks ? (
        <View style={styles.blocksColumn}>
          {renderMessageBlocks(item, conversation)}
          {item.text.length > 0 ? renderMessageText(item, isAgent) : null}
        </View>
      ) : (
        renderMessageText(item, isAgent)
      )}
    </View>
  );

  if (isAgent) {
    return (
      <View style={styles.agentRow}>
        <Image source={KOKO_CHAT_AVATAR} style={styles.avatar} />
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

  if (status !== "connected" && status !== "handshaking") {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.fallback}>
          <Text style={styles.fallbackTitle}>未连接到 OpenClaw Gateway</Text>
          <Text style={styles.fallbackSubtitle}>当前状态：{status}</Text>
          <Link href="/pair" asChild>
            <Pressable style={styles.fallbackButton}>
              <Text style={styles.fallbackButtonText}>去配对</Text>
            </Pressable>
          </Link>
        </View>
      </SafeAreaView>
    );
  }

  const sendDisabled = sending || draft.trim().length === 0;

  return (
    <SafeAreaView style={styles.screen} edges={["left", "right", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={headerHeight}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={messageKey}
          renderItem={(item) => renderMessage(item, conversation)}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => {
            if (messages.length > 0) {
              listRef.current?.scrollToEnd({ animated: false });
            }
          }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>
                跟 Koko 说点什么吧～
              </Text>
            </View>
          }
        />

        <View style={styles.inputBar}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="说点什么…"
            placeholderTextColor={KokoColors.inkPlaceholder}
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
    alignItems: "flex-end",
    alignSelf: "flex-start",
    maxWidth: "88%",
    marginBottom: 4
  },
  userRow: {
    alignSelf: "flex-end",
    maxWidth: "88%",
    marginBottom: 4
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: KokoRadius.pill,
    marginRight: 8,
    backgroundColor: KokoColors.primarySoft
  },
  bubble: {
    marginVertical: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: KokoRadius.xl,
    flexShrink: 1
  },
  agentBubble: {
    backgroundColor: KokoColors.surface,
    borderTopLeftRadius: 8
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
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: KokoColors.surfaceMuted,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: KokoColors.hairline
  },
  input: {
    flex: 1,
    maxHeight: 120,
    marginRight: 8,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    borderRadius: KokoRadius.xl,
    backgroundColor: KokoColors.surface,
    fontSize: 16,
    color: KokoColors.ink
  },
  sendButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: KokoRadius.pill,
    backgroundColor: KokoColors.primary
  },
  sendButtonDisabled: {
    backgroundColor: KokoColors.primarySoft
  },
  sendButtonText: {
    fontSize: 15,
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
  fallbackSubtitle: {
    marginTop: 6,
    fontSize: 13,
    color: KokoColors.inkSecondary
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
