import Constants from "expo-constants";
import { Link, router } from "expo-router";
import { FlatList, Pressable, Text, View, type ListRenderItemInfo } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import tw from "twrnc";

import { useGatewayStore } from "@/state/gateway";
import { useConversationStore, type ConversationMeta } from "@/state/conversations";

function formatRelative(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const date = new Date(timestamp);
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function renderConversation({ item }: ListRenderItemInfo<ConversationMeta>): React.ReactElement {
  return (
    <Link
      href={{ pathname: "/chat/[id]", params: { id: item.id } }}
      asChild
    >
      <Pressable
        accessibilityRole="button"
        style={tw`flex-row items-center rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-900`}
      >
        <View style={tw`flex-1 pr-3`}>
          <Text
            numberOfLines={1}
            style={tw`text-base font-semibold text-slate-950 dark:text-slate-50`}
          >
            {item.title}
          </Text>
          <Text
            numberOfLines={1}
            style={tw`mt-1 text-sm text-slate-500 dark:text-slate-400`}
          >
            {item.lastPreview ?? "No messages yet"}
          </Text>
        </View>
        <Text style={tw`ml-2 text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500`}>
          {formatRelative(item.updatedAt)}
        </Text>
      </Pressable>
    </Link>
  );
}

export default function HomeScreen() {
  const appVersion = Constants.expoConfig?.version ?? "0.0.1";
  const gatewayStatus = useGatewayStore((s) => s.status);
  const conversations = useConversationStore((s) => s.list);
  const createConversation = useConversationStore((s) => s.create);

  function handleNewChat(): void {
    const meta = createConversation();
    router.push({ pathname: "/chat/[id]", params: { id: meta.id } });
  }

  return (
    <SafeAreaView style={tw`flex-1 bg-slate-50 dark:bg-slate-950`} edges={["left", "right", "bottom"]}>
      <View style={tw`flex-row items-center justify-between px-5 pb-3 pt-5`}>
        <View>
          <Text style={tw`text-2xl font-bold text-slate-950 dark:text-slate-50`}>
            🦞 KokoChat
          </Text>
          <Text style={tw`text-xs text-slate-500 dark:text-slate-400`}>
            v{appVersion} · Gateway: {gatewayStatus}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={handleNewChat}
          style={tw`rounded-full bg-cyan-600 px-4 py-2`}
        >
          <Text style={tw`text-sm font-semibold text-white`}>+ New Chat</Text>
        </Pressable>
      </View>

      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        renderItem={renderConversation}
        contentContainerStyle={tw`gap-3 px-5 pb-6 pt-2`}
        ListEmptyComponent={
          <View style={tw`mt-24 items-center px-6`}>
            <Text style={tw`text-center text-slate-500 dark:text-slate-400`}>
              No conversations yet.{"\n"}Tap "+ New Chat" to start one.
            </Text>
          </View>
        }
        ListFooterComponent={
          <View style={tw`mt-6 gap-2`}>
            <Link href="/pair" asChild>
              <Pressable
                accessibilityRole="button"
                style={tw`rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900`}
              >
                <Text style={tw`text-sm font-medium text-slate-700 dark:text-slate-200`}>
                  Pair a new OpenClaw Gateway
                </Text>
              </Pressable>
            </Link>
            <Link href="/settings" asChild>
              <Pressable
                accessibilityRole="button"
                style={tw`rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900`}
              >
                <Text style={tw`text-sm font-medium text-slate-700 dark:text-slate-200`}>
                  Settings
                </Text>
              </Pressable>
            </Link>
          </View>
        }
      />
    </SafeAreaView>
  );
}
