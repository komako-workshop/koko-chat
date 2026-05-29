import { useEffect, useRef, useState } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import Constants from "expo-constants";
import { Platform, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppStateProvider } from "@/providers/AppStateProvider";
import { ErrorBoundary } from "@/providers/ErrorBoundary";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { hydrateStorage } from "@/storage/mmkv";
import { hasStoredGatewayPairing } from "@/gateway/identityStorage";
import { parseSetupCode } from "@/gateway/setupCode";
import { registerMiniApps } from "@/miniapps";
import { seedInitialKokoConversation } from "@/miniapps/koko";
import { useConversationStore } from "@/state/conversations";
import { useGatewayStore } from "@/state/gateway";
import { KokoColors, KokoRadius } from "@/theme/koko";
import { useTavernPersonaStore } from "@/state/tavernPersona";

// Register mini-app block renderers and outbound builders once at module load,
// before any conversation can render. Idempotent.
registerMiniApps();

// Dev URL-hash triggers,只在 web + dev 跑。设计上让 agent (我) 能通过
// osascript 改 Chrome tab URL 一键复位 / 触发 demo,不用让用户每次手动
// devtools console + click。Chrome 禁止 osascript 执行 JS,但允许 set URL
// 到非 javascript: 链接,所以走 hash trigger 这条间接路径。
//
//   #koko-reset                            清 localStorage + 跳 /deeply
//   #koko-run-research:<topic>:<sections>  清 storage + 跑一轮 research kickoff,
//                                          topic 必须 encodeURIComponent。
//   #koko-run-material-url:<url>:<sections> 清 storage + 跑一轮 URL 资料课程。
//
// Guard 必须用 Platform.OS === "web":React Native Hermes 也定义了 window
// 全局(空对象),`typeof window !== "undefined"` 不够,会在真机抛
// "window.addEventListener is not a function"。
if (Platform.OS === "web" && typeof window !== "undefined" && typeof window.addEventListener === "function") {
  const handleHashTrigger = async () => {
    const hash = window.location.hash;
    if (hash === "#koko-reset") {
      try {
        window.localStorage?.clear();
        window.sessionStorage?.clear();
      } catch {
        /* ignore */
      }
      window.location.replace("/deeply");
      return;
    }
    const researchMatch = hash.match(/^#koko-run-research:([^:]+):(\d+)$/);
    if (researchMatch !== null) {
      const topic = decodeURIComponent(researchMatch[1] ?? "");
      const sections = Number(researchMatch[2]);
      if (topic.length === 0 || !Number.isFinite(sections) || sections <= 0) return;
      try {
        window.localStorage?.clear();
        window.sessionStorage?.clear();
      } catch {
        /* ignore */
      }
      history.replaceState(
        null,
        "",
        `${window.location.pathname}?koko_run_research_topic=${encodeURIComponent(topic)}&koko_run_research_sections=${sections}`
      );
      window.location.reload();
      return;
    }

    const materialUrlMatch = hash.match(/^#koko-run-material-url:([^:]+):(\d+)$/);
    if (materialUrlMatch !== null) {
      const materialUrl = decodeURIComponent(materialUrlMatch[1] ?? "");
      const sections = Number(materialUrlMatch[2]);
      if (materialUrl.length === 0 || !Number.isFinite(sections) || sections <= 0) return;
      try {
        window.localStorage?.clear();
        window.sessionStorage?.clear();
      } catch {
        /* ignore */
      }
      history.replaceState(
        null,
        "",
        `${window.location.pathname}?koko_run_material_url=${encodeURIComponent(materialUrl)}&koko_run_material_sections=${sections}`
      );
      window.location.reload();
      return;
    }

    // #koko-auto-section:N 让 agent (我) 在 course screen 上自动 fire
    // "继续讲解第 N 节",不清 storage,只刷当前 path 加 query 强制 reload。
    const sectionMatch = hash.match(/^#koko-auto-section:(\d+)$/);
    if (sectionMatch !== null) {
      const target = Number(sectionMatch[1]);
      if (!Number.isFinite(target) || target <= 0) return;
      history.replaceState(
        null,
        "",
        `${window.location.pathname}?koko_auto_section=${target}`
      );
      window.location.reload();
    }
  };
  void handleHashTrigger();
  window.addEventListener("hashchange", () => {
    void handleHashTrigger();
  });
}

/**
 * Read once at startup. When set (e.g. "deeply"), the host boots straight
 * into a single mini-app surface and hides the launcher / tab bar entirely.
 * Wired by `pnpm deeply:web` -> KOKO_DEMO_APP=deeply -> app.config.js extra.
 */
const DEMO_APP = (() => {
  const raw = Constants.expoConfig?.extra?.demoApp;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
})();

export default function RootLayout() {
  // Load persisted KV from AsyncStorage before exposing routes, so that
  // identityStorage and the conversation store both see their data. On
  // Web this is a no-op (localStorage is already synchronous).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    void hydrateStorage().then(() => {
      // Rehydrate the conversation registry once the sync KV is ready,
      // then drop a pinned Koko conversation in for brand-new installs so
      // the chat list isn't empty on first launch.
      useConversationStore.getState().rehydrate();
      // Tavern persona (user's roleplay name) is read by detail page +
      // first_mes substitution + agent bootstrap prompt; load it before
      // any Tavern screen can mount.
      useTavernPersonaStore.getState().rehydrate();
      // Skip the default Koko seed when running a single-mini-app demo so the
      // demo surface stays isolated.
      if (DEMO_APP === null) {
        seedInitialKokoConversation();
      }
      setHydrated(true);
    });
  }, []);

  if (!hydrated) {
    return null;
  }

  const stackProps = DEMO_APP === "deeply" ? { initialRouteName: "deeply/index" } : {};

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={styles.flex}>
        <DemoFrame>
          <SafeAreaProvider>
            <AppStateProvider>
              <ThemeProvider>
                <DevAutoConnect />
                <StatusBar style="dark" />
                <Stack
                  {...stackProps}
                  screenOptions={{
                    headerShown: true,
                    headerStyle: { backgroundColor: KokoColors.bg },
                    headerTitleStyle: { color: KokoColors.ink, fontWeight: "600" },
                    headerTitleAlign: "center",
                    headerTintColor: KokoColors.primaryDeep,
                    headerBackTitle: "",
                    headerBackButtonDisplayMode: "minimal",
                    headerShadowVisible: false,
                    contentStyle: { backgroundColor: KokoColors.bg }
                  }}
                >
                  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                  <Stack.Screen name="pair" options={{ title: "配对 OpenClaw" }} />
                  <Stack.Screen name="chat/[id]" options={{ title: "聊天" }} />
                  <Stack.Screen name="settings" options={{ title: "设置" }} />
                  <Stack.Screen name="deeply/index" options={{ title: "Deeply" }} />
                  <Stack.Screen name="deeply/course/[id]" options={{ title: "课程讲解" }} />
                  <Stack.Screen name="tavern/browse" options={{ title: "角色广场" }} />
                  <Stack.Screen name="tavern/card/[...path]" options={{ title: "角色详情" }} />
                  <Stack.Screen name="tavern/settings" options={{ title: "酒馆设置" }} />
                </Stack>
              </ThemeProvider>
            </AppStateProvider>
          </SafeAreaProvider>
        </DemoFrame>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

/**
 * Phone-shaped centered viewport for the web demo. Keeps the layout honest
 * about mobile-first mini-apps even when designed on a desktop browser. On
 * native (iOS / Android) this is a transparent passthrough.
 */
function DemoFrame({ children }: { children: React.ReactNode }): React.ReactElement {
  if (DEMO_APP === null || Platform.OS !== "web") {
    return <View style={styles.flex}>{children}</View>;
  }
  return (
    <View style={styles.demoFrameBackdrop}>
      <View style={styles.demoFrameViewport}>{children}</View>
    </View>
  );
}

/**
 * Dev-only side effect: when scripts/dev-start.mjs has populated
 * `extra.devGatewayUrl` + `extra.devGatewayToken`, auto-connect to the
 * local Gateway on first mount so we don't have to re-pair on every
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
    const devGatewayUrl = Constants.expoConfig?.extra?.devGatewayUrl;
    const devGatewayToken = Constants.expoConfig?.extra?.devGatewayToken;
    if (typeof devGatewayUrl !== "string" || devGatewayUrl.length === 0) return;
    if (typeof devGatewayToken !== "string" || devGatewayToken.length === 0) return;
    if (status !== "disconnected") return;

    // If the phone already has a real Gateway device pairing, let
    // AppStateProvider.reconnectIfPossible() reuse the stored URL + deviceToken
    // instead of overriding that state with the dev shared-token LAN setup.
    //
    // This is especially important in Expo Go: otherwise every restart can
    // clobber the relay/device-token pairing with a temporary dev URL, and the
    // next cold launch feels like it needs pairing again.
    if (hasStoredGatewayPairing()) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.info("[koko-dev] existing device pairing found; skipping dev shared-token auto-connect");
      }
      ranRef.current = true;
      return;
    }

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

// 手机 viewport 框宽。420 偏瘦,480 更接近 iPhone 14/15 Pro Max 的实际
// 阅读宽度;再宽就开始失去"这是个手机 demo"的视觉锚点了。
const PHONE_VIEWPORT_WIDTH = 480;

const styles = StyleSheet.create({
  flex: {
    flex: 1
  },
  demoFrameBackdrop: {
    flex: 1,
    backgroundColor: "#1f1a14",
    alignItems: "center",
    justifyContent: "center"
  },
  demoFrameViewport: {
    flex: 1,
    width: "100%",
    maxWidth: PHONE_VIEWPORT_WIDTH,
    backgroundColor: "#F9F9F7",
    overflow: "hidden",
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: KokoColors.border,
    borderRadius: KokoRadius.lg
  }
});
