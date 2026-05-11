import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo
} from "react-native";
import { Link, useLocalSearchParams, useNavigation, router } from "expo-router";
import { useHeaderHeight } from "@react-navigation/elements";
import { SafeAreaView } from "react-native-safe-area-context";
import tw from "twrnc";

import { useGatewayStore } from "@/state/gateway";
import { useConversationStore, type ChatMessage, type ConversationMeta } from "@/state/conversations";
import { MessageBlockView } from "@/runtime/messageBlocks";

function messageKey(message: ChatMessage): string {
  return `${message.role}:${message.runId ?? "local"}:${message.id}`;
}

function renderMessageText(message: ChatMessage, isAgent: boolean): React.ReactElement | null {
  if (message.text.length === 0 && message.streaming !== true) return null;
  return (
    <Text
      style={tw.style(
        "text-base",
        isAgent ? "text-slate-950 dark:text-slate-50" : "text-white"
      )}
    >
      {message.text}
      {message.streaming === true ? <Text style={tw`opacity-60`}> ▋</Text> : null}
    </Text>
  );
}

function renderMessageBlocks(
  message: ChatMessage,
  conversation: ConversationMeta
): React.ReactElement | null {
  if (message.blocks === undefined || message.blocks.length === 0) return null;
  return (
    <View style={tw`gap-2`}>
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
  return (
    <View
      style={tw.style(
        "my-1.5 max-w-[88%] rounded-2xl px-4 py-3",
        isAgent
          ? "self-start bg-white dark:bg-slate-800"
          : "self-end bg-cyan-600"
      )}
    >
      {item.error !== undefined ? (
        <Text style={tw`text-sm text-rose-300`}>⚠️ {item.error}</Text>
      ) : hasBlocks ? (
        <View style={tw`gap-2`}>
          {renderMessageBlocks(item, conversation)}
          {item.text.length > 0 ? renderMessageText(item, isAgent) : null}
        </View>
      ) : (
        renderMessageText(item, isAgent)
      )}
    </View>
  );
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
      // Only clear active if we're leaving for a non-chat screen — in the
      // thread list we don't want a stale selection. The cleanest signal is
      // that another ChatScreen's select() will overwrite ours before this
      // cleanup runs, so we only clear when no conversation is active.
      const current = useConversationStore.getState().activeId;
      if (current === conversationId) {
        useConversationStore.getState().clearActive();
      }
    };
  }, [conversationId]);

  // Set the nav header title to the conversation title, and surface
  // Disconnect as headerRight so we never draw a second in-screen header.
  const navigation = useNavigation();
  const disconnect = useGatewayStore((s) => s.disconnect);
  useLayoutEffect(() => {
    navigation.setOptions({
      title: conversation?.title ?? "Chat",
      headerRight: () => (
        <Pressable
          accessibilityRole="button"
          onPress={() => void disconnect()}
          hitSlop={8}
          style={tw`rounded-full border border-slate-300 px-3 py-1 dark:border-slate-700`}
        >
          <Text style={tw`text-xs text-slate-700 dark:text-slate-200`}>Disconnect</Text>
        </Pressable>
      )
    });
  }, [conversation?.title, disconnect, navigation]);

  // Autoscroll to bottom on new messages / streaming updates.
  useEffect(() => {
    if (messages.length === 0) return;
    const timer = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: false });
    }, 16);
    return () => clearTimeout(timer);
  }, [messages]);

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

  // Conversation not found or invalid id. Offer a way back.
  if (conversationId === null || conversation === null) {
    return (
      <SafeAreaView style={tw`flex-1 bg-slate-50 dark:bg-slate-950`}>
        <View style={tw`flex-1 items-center justify-center px-6`}>
          <Text style={tw`text-center text-lg text-slate-700 dark:text-slate-200`}>
            Conversation not found
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace("/")}
            style={tw`mt-6 rounded-2xl bg-cyan-600 px-6 py-3`}
          >
            <Text style={tw`text-base font-semibold text-white`}>Back to threads</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (status !== "connected" && status !== "handshaking") {
    return (
      <SafeAreaView style={tw`flex-1 bg-slate-50 dark:bg-slate-950`}>
        <View style={tw`flex-1 items-center justify-center px-6`}>
          <Text style={tw`text-center text-lg text-slate-700 dark:text-slate-200`}>
            Not connected to OpenClaw Gateway ({status})
          </Text>
          <Link href="/pair" asChild>
            <Pressable style={tw`mt-6 rounded-2xl bg-cyan-600 px-6 py-3`}>
              <Text style={tw`text-base font-semibold text-white`}>Go Pair</Text>
            </Pressable>
          </Link>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={tw`flex-1 bg-slate-50 dark:bg-slate-950`}
      edges={["left", "right", "bottom"]}
    >
      <KeyboardAvoidingView
        style={tw`flex-1`}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={headerHeight}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={messageKey}
          renderItem={(item) => renderMessage(item, conversation)}
          contentContainerStyle={tw`px-4 py-4`}
          onContentSizeChange={() => {
            if (messages.length > 0) {
              listRef.current?.scrollToEnd({ animated: false });
            }
          }}
          ListEmptyComponent={
            <View style={tw`mt-16 items-center`}>
              <Text style={tw`text-slate-500 dark:text-slate-400`}>
                Say something to your OpenClaw agent…
              </Text>
            </View>
          }
        />

        <View
          style={tw`flex-row items-center border-t border-slate-200 bg-slate-100 px-3 py-3 dark:border-slate-800 dark:bg-slate-900`}
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Message…"
            placeholderTextColor={tw.color("slate-400") ?? "#94a3b8"}
            multiline
            style={tw`mr-2 max-h-28 flex-1 rounded-2xl bg-white px-4 py-2.5 text-base text-slate-950 dark:bg-slate-800 dark:text-slate-50`}
          />
          <Pressable
            accessibilityRole="button"
            disabled={sending || draft.trim().length === 0}
            onPress={() => void handleSend()}
            style={tw.style(
              "rounded-full px-5 py-2.5",
              sending || draft.trim().length === 0
                ? "bg-slate-300 dark:bg-slate-700"
                : "bg-cyan-600"
            )}
          >
            <Text style={tw`text-base font-semibold text-white`}>Send</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const EMPTY: ChatMessage[] = [];
