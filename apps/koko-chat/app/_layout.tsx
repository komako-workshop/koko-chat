import { useEffect, useRef, useState } from "react";
import { router, Stack, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import Constants from "expo-constants";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppStateProvider } from "@/providers/AppStateProvider";
import { ErrorBoundary } from "@/providers/ErrorBoundary";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { hydrateStorage } from "@/storage/mmkv";
import { parseSetupCode } from "@/gateway/setupCode";
import { useGatewayStore } from "@/state/gateway";

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
              <DevAutoConnect />
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

/**
 * Dev-only side effect: when scripts/dev-start.mjs has populated
 * `extra.devSetupCode`, auto-connect to the local Gateway on first mount.
 *
 * - Production builds (no devSetupCode) skip this entirely.
 * - We only auto-connect once per APP boot, even if the component remounts.
 * - We don't navigate anywhere; the user can land on Home and the
 *   Gateway: connected indicator will light up. Tapping Chat then works.
 */
function DevAutoConnect(): null {
  const ranRef = useRef(false);
  const status = useGatewayStore((s) => s.status);
  const connect = useGatewayStore((s) => s.connect);
  const pathname = usePathname();

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
        if (pathname === "/") {
          router.replace("/chat");
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[koko-dev] auto-connect failed:", err);
      }
    })();
  }, [connect, pathname, status]);

  return null;
}
