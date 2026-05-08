import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";

import { useSettingsStore } from "@/state/settings";

/**
 * WeChat-style bottom tab layout.
 *
 * Two tabs only: Chats (会话列表) and Me (设置入口).
 * Stack-level screens like `/chat/[id]` and `/pair` are defined in the
 * root `app/_layout.tsx` and are pushed on top of this tab navigator.
 */
export default function TabsLayout(): React.ReactElement {
  const isDark = useSettingsStore((s) => s.darkMode);

  // WeChat brand green is close to #07c160 for selected, gray for unselected.
  const activeTint = "#07c160";
  const inactiveTint = isDark ? "#7d7d7f" : "#8e8e93";
  const tabBarBackground = isDark ? "#1c1c1e" : "#f7f7f8";
  const borderColor = isDark ? "#2c2c2e" : "#dcdcdd";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: activeTint,
        tabBarInactiveTintColor: inactiveTint,
        tabBarStyle: {
          backgroundColor: tabBarBackground,
          borderTopColor: borderColor,
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
