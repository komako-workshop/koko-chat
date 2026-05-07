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
    backgroundColor: "#ffffff"
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: "ai.komako.kokochat"
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
  plugins: [
    "expo-router",
    [
      "expo-camera",
      {
        cameraPermission:
          "KokoChat uses the camera to scan OpenClaw pairing QR codes."
      }
    ]
  ],
  experiments: {
    typedRoutes: true
  },
  extra: {
    // Populated by scripts/dev-start.mjs in dev mode only. This intentionally
    // bypasses QR/bootstrap pairing for local development so Expo Go can open
    // straight into Chat against the Mac's running Gateway.
    devGatewayUrl: process.env.KOKO_DEV_GATEWAY_URL ?? null,
    devGatewayToken: process.env.KOKO_DEV_GATEWAY_TOKEN ?? null
  }
};

module.exports = config;
