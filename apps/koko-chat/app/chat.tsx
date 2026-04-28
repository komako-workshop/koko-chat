import { FlatList, Text, View, type ListRenderItemInfo } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import tw from "twrnc";

import { useChatStore, type Message } from "@/state/chat";

function messageKey(message: Message) {
  // 旧仓库踩过的坑：裸用 message.id 在某些路径下会 collide，Task 04c 会改 uuid prefix。
  return `${message.role}:${message.runId ?? "local"}:${message.id}:${message.timestamp}`;
}

function renderMessage({ item }: ListRenderItemInfo<Message>) {
  const isAgent = item.role === "agent";

  return (
    <View style={tw.style("my-2 max-w-[88%] rounded-2xl px-4 py-3", isAgent ? "self-start bg-white" : "self-end bg-cyan-600")}>
      <Text style={tw.style("text-base", isAgent ? "text-slate-950" : "text-white")}>{item.text}</Text>
    </View>
  );
}

export default function ChatScreen() {
  const messages = useChatStore((state) => state.messages);

  return (
    <SafeAreaView style={tw`flex-1 bg-slate-50 dark:bg-slate-950`}>
      <View style={tw`flex-1 px-6 py-8`}>
        <Text style={tw`text-3xl font-bold text-slate-950 dark:text-slate-50`}>Chat</Text>

        <FlatList
          contentContainerStyle={tw`flex-grow py-8`}
          data={messages}
          keyExtractor={messageKey}
          ListEmptyComponent={
            <View style={tw`flex-1 items-center justify-center rounded-2xl border border-dashed border-slate-300 px-6 py-16 dark:border-slate-700`}>
              <Text style={tw`text-base text-slate-500 dark:text-slate-400`}>no messages yet</Text>
            </View>
          }
          renderItem={renderMessage}
        />
      </View>
    </SafeAreaView>
  );
}
