import { useEffect, useRef, useState } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import Constants from "expo-constants";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppStateProvider } from "@/providers/AppStateProvider";
import { ErrorBoundary } from "@/providers/ErrorBoundary";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { hydrateStorage } from "@/storage/mmkv";
import { parseSetupCode } from "@/gateway/setupCode";
import { useConversationStore } from "@/state/conversations";
import { useGatewayStore } from "@/state/gateway";

export default function RootLayout() {
  // Load persisted KV from AsyncStorage before exposing routes, so that
  // identityStorage and the conversation store both see their data. On
  // Web this is a no-op (localStorage is already synchronous).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    void hydrateStorage().then(() => {
      // Rehydrate the conversation registry once the sync KV is ready.
      useConversationStore.getState().rehydrate();
      setHydrated(true);
    });
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
              <DevAutoConnect />
              <StatusBar style="auto" />
              <Stack screenOptions={{ headerShown: true }}>
                <Stack.Screen name="index" options={{ title: "KokoChat" }} />
                <Stack.Screen name="pair" options={{ title: "Pair" }} />
                <Stack.Screen name="chat/[id]" options={{ title: "Chat" }} />
                <Stack.Screen name="settings" options={{ title: "Settings" }} />
              </Stack>
            </ThemeProvider>
          </AppStateProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

/**
 * Dev-only side effect: when scripts/dev-start.mjs has populated
 * `extra.devGatewayUrl` + `extra.devGatewayToken`, auto-connect to the
 * local Gateway on first mount so we don't have to rescan a QR on every
 * reload. Production builds skip this branch entirely.
 *
 * We do NOT navigate here anymore: with multiple conversations the user
 * should land on the thread list, not an arbitrary chat.
 */
function DevAutoConnect(): null {
  const ranRef = useRef(false);
  const status = useGatewayStore((s) => s.status);
  const connect = useGatewayStore((s) => s.connect);

  useEffect(() => {
    if (ranRef.current) return;
    if (!__DEV__) return;
    const devGatewayUrl = (Constants.expoConfig?.extra?.devGatewayUrl ?? null) as
      | string
      | null;
    const devGatewayToken = (Constants.expoConfig?.extra?.devGatewayToken ?? null) as
      | string
      | null;
    if (devGatewayUrl === null || devGatewayUrl.length === 0) return;
    if (devGatewayToken === null || devGatewayToken.length === 0) return;
    if (status !== "disconnected") return;
    ranRef.current = true;

    void (async () => {
      try {
        const setup = parseSetupCode(
          JSON.stringify({ url: devGatewayUrl, token: devGatewayToken })
        );
        // eslint-disable-next-line no-console
        console.info("[koko-dev] auto-connecting to local Gateway:", setup.url);
        await connect(setup);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[koko-dev] auto-connect failed:", err);
      }
    })();
  }, [connect, status]);

  return null;
}
