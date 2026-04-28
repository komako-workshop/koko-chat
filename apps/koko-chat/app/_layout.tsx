import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppStateProvider } from "@/providers/AppStateProvider";
import { ThemeProvider } from "@/providers/ThemeProvider";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppStateProvider>
          <ThemeProvider>
            <StatusBar style="auto" />
            <Stack screenOptions={{ headerShown: true }}>
              <Stack.Screen name="index" options={{ title: "KokoChat" }} />
              <Stack.Screen name="pair" options={{ title: "Pair" }} />
              <Stack.Screen name="chat" options={{ title: "Chat" }} />
              <Stack.Screen name="settings" options={{ title: "Settings" }} />
            </Stack>
          </ThemeProvider>
        </AppStateProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
