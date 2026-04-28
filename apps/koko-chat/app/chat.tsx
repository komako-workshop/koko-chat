import { useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View, type ListRenderItemInfo } from "react-native";
import { Link } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import tw from "twrnc";

import { type ChatMessage, useGatewayStore } from "@/state/gateway";

function messageKey(message: ChatMessage): string {
  return `${message.role}:${message.runId ?? "local"}:${message.id}`;
}

function renderMessage({ item }: ListRenderItemInfo<ChatMessage>): React.ReactElement {
  const isAgent = item.role === "agent";
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
      ) : (
        <Text style={tw.style("text-base", isAgent ? "text-slate-950 dark:text-slate-50" : "text-white")}>
          {item.text}
          {item.streaming === true ? <Text style={tw`opacity-60`}> ▋</Text> : null}
        </Text>
      )}
    </View>
  );
}

export default function ChatScreen() {
  const status = useGatewayStore((s) => s.status);
  const messages = useGatewayStore((s) => s.messages);
  const sendUserMessage = useGatewayStore((s) => s.sendUserMessage);
  const disconnect = useGatewayStore((s) => s.disconnect);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSend(): Promise<void> {
    if (sending || draft.trim().length === 0) return;
    const text = draft;
    setDraft("");
    setSending(true);
    try {
      await sendUserMessage(text);
    } catch (error) {
      console.error("send failed", error);
    } finally {
      setSending(false);
    }
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
    <SafeAreaView style={tw`flex-1 bg-slate-50 dark:bg-slate-950`}>
      <KeyboardAvoidingView
        style={tw`flex-1`}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
      >
        <View style={tw`flex-row items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800`}>
          <Text style={tw`text-lg font-semibold text-slate-950 dark:text-slate-50`}>Chat</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void disconnect()}
            style={tw`rounded-full border border-slate-300 px-3 py-1 dark:border-slate-700`}
          >
            <Text style={tw`text-xs text-slate-700 dark:text-slate-200`}>Disconnect</Text>
          </Pressable>
        </View>

        <FlatList
          data={messages}
          keyExtractor={messageKey}
          renderItem={renderMessage}
          contentContainerStyle={tw`px-4 py-4`}
          ListEmptyComponent={
            <View style={tw`mt-16 items-center`}>
              <Text style={tw`text-slate-500 dark:text-slate-400`}>
                Say something to your OpenClaw agent…
              </Text>
            </View>
          }
        />

        <View style={tw`flex-row items-center border-t border-slate-200 bg-slate-100 px-3 py-3 dark:border-slate-800 dark:bg-slate-900`}>
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
              sending || draft.trim().length === 0 ? "bg-slate-300 dark:bg-slate-700" : "bg-cyan-600"
            )}
          >
            <Text style={tw`text-base font-semibold text-white`}>Send</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
