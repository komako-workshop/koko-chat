// Dynamic Expo config so we can inject runtime env vars.
// Mirrors what app.json had, plus an `extra` block populated from
// KOKO_DEV_SETUP_CODE (set by scripts/dev-start.mjs).
//
// Production builds (TestFlight / EAS) won't have KOKO_DEV_SETUP_CODE so
// extra.devSetupCode will be undefined and the APP boots into the normal
// Pair flow.

/** @type {import('@expo/config-types').ExpoConfig} */
const config = {
  name: "KokoChat",
  slug: "koko-chat",
  scheme: "koko",
  version: "0.0.1",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  splash: {
    image: "./assets/splash-icon.png",
    resizeMode: "contain",
    backgroundColor: "#FFFFFF"
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: "ai.komako.kokochat",
    infoPlist: {
      // Required when KokoChat is paired with a local OpenClaw Gateway. Without
      // this string iOS shows a generic permission prompt and Apple reviewers
      // may flag it as unclear usage. We also list Bonjour service types so the
      // system can resolve the gateway via mDNS when the user prefers a
      // friendly name.
      NSLocalNetworkUsageDescription:
        "KokoChat 通过网络连接你的 OpenClaw 服务器，用于配对设备和收发聊天消息。",
      NSBonjourServices: ["_openclaw._tcp", "_openclaw-gateway._tcp"],
      ITSAppUsesNonExemptEncryption: false
    }
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#ffffff"
    },
    package: "ai.komako.kokochat"
  },
  web: {
    bundler: "metro",
    output: "single"
  },
  plugins: ["expo-router"],
  experiments: {
    typedRoutes: true
  },
  extra: {
    // Populated by scripts/dev-start.mjs in dev mode only. This intentionally
    // bypasses QR/bootstrap pairing for local development so Expo Go can open
    // straight into Chat against the local OpenClaw Gateway.
    devGatewayUrl: process.env.KOKO_DEV_GATEWAY_URL ?? null,
    devGatewayToken: process.env.KOKO_DEV_GATEWAY_TOKEN ?? null,
    // Optional single-mini-app demo mode. When set (e.g. "deeply"), the host
    // boots straight into that mini-app's surface instead of showing the
    // launcher, and renders a phone-sized frame on web for layout sanity.
    // Wired up by `pnpm deeply:web` / scripts/dev-start.mjs.
    demoApp: process.env.KOKO_DEMO_APP ?? null,
    // Deeply 课程库 API base。客户端 libraryData.ts 从这里读,不再把
    // library-pool.json 打进 bundle。
    //
    // 默认走线上 cloudflared tunnel(dev / Expo Go / TestFlight 开箱即用)。
    // 想用本机 dev library server 改库时,export 环境变量覆盖:
    //   KOKO_DEEPLY_LIBRARY_API_BASE=http://192.168.x.x:8788 pnpm app:dev
    //
    // 注意:当前线上是 Cloudflare *quick* tunnel,cloudflared systemd 重启
    // 会换子域名。要切到固定 named tunnel,见
    // apps/deeply-library-server/deploy/cloudflared-setup.md。
    deeplyLibraryApiBase:
      process.env.KOKO_DEEPLY_LIBRARY_API_BASE ??
      "https://implementing-pixels-refurbished-modified.trycloudflare.com",
    eas: {
      projectId: "e0f1a3d6-5d11-417b-b49f-a8da8891fb5e"
    }
  }
};

module.exports = config;
