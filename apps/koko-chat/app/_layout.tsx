import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppStateProvider } from "@/providers/AppStateProvider";
import { ErrorBoundary } from "@/providers/ErrorBoundary";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { hydrateStorage } from "@/storage/mmkv";

export default function RootLayout() {
  // Load persisted KV from AsyncStorage before exposing routes, so that
  // zustand persist reads see the stored values. On Web this is a no-op
  // (localStorage is already synchronous).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    void hydrateStorage().then(() => setHydrated(true));
  }, []);

  if (!hydrated) {
    return null;
  }

  return (
    <ErrorBoundary>
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
    </ErrorBoundary>
  );
}
