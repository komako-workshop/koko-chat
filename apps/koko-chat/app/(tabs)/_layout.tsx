import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";

import { KokoColors } from "@/theme/koko";

/**
 * Bottom tab layout.
 *
 * Two tabs only: Chats (会话列表) and Me (设置入口).
 * Stack-level screens like `/chat/[id]` and `/pair` are defined in the
 * root `app/_layout.tsx` and are pushed on top of this tab navigator.
 *
 * Colors come from `theme/koko` — warm off-white bar with the Koko orange
 * as the active tint.
 */
export default function TabsLayout(): React.ReactElement {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: KokoColors.primaryDeep,
        tabBarInactiveTintColor: KokoColors.inactive,
        tabBarStyle: {
          backgroundColor: KokoColors.bg,
          borderTopColor: KokoColors.hairline,
          borderTopWidth: 0.5
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "500"
        }
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "聊天",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubbles" color={color} size={size} />
          )
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: "我",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person" color={color} size={size} />
          )
        }}
      />
    </Tabs>
  );
}
