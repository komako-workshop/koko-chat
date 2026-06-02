// Dynamic Expo config so we can inject runtime env vars into `extra`.
// Mirrors what app.json had. The Gateway connection always goes through the
// relay (paired from the in-app "配对 OpenClaw" screen), in dev and in
// production alike — there is no LAN dev auto-connect to configure here.

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
    // The current public KokoChat relay is plain ws://. Android release builds
    // block cleartext WebSockets unless this manifest flag is enabled.
    usesCleartextTraffic: true,
    package: "ai.komako.kokochat"
  },
  web: {
    bundler: "metro",
    output: "single"
  },
  plugins: ["expo-router", "./plugins/with-android-cleartext-traffic"],
  experiments: {
    typedRoutes: true
  },
  extra: {
    // Optional single-mini-app demo mode. When set (e.g. "deeply"), the host
    // boots straight into that mini-app's surface instead of showing the
    // launcher, and renders a phone-sized frame on web for layout sanity.
    // Wired up by `pnpm deeply:web` / scripts/dev-start.mjs.
    demoApp: process.env.KOKO_DEMO_APP ?? null,
    // Deeply 课程库 API base。客户端 libraryData.ts 从这里读,不再把
    // library-pool.json 打进 bundle。
    //
    // 默认走 https://deeply.plus(部署在 Komako exchange 服务器,Caddy 反代
    // 到本地 kokochat-library.service:8788)。dev / Expo Go / TestFlight
    // 开箱即用,无需在本机起 server。
    //
    // 想用本机 dev library server 改库时,export 环境变量覆盖:
    //   KOKO_DEEPLY_LIBRARY_API_BASE=http://192.168.x.x:8788 pnpm app:dev
    //
    // 部署说明:apps/deeply-library-server/deploy/README-deeply-plus.md
    deeplyLibraryApiBase:
      process.env.KOKO_DEEPLY_LIBRARY_API_BASE ??
      "https://deeply.plus",
    eas: {
      projectId: "e0f1a3d6-5d11-417b-b49f-a8da8891fb5e"
    }
  }
};

module.exports = config;
