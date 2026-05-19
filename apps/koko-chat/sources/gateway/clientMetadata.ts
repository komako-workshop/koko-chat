import { Platform } from "react-native";

import type { GatewayClientMetadata } from "@koko/openclaw-client/protocol";

export function kokoGatewayClientMetadata(): GatewayClientMetadata {
  if (Platform.OS === "ios") {
    return {
      id: "openclaw-ios",
      version: "0.0.1",
      platform: "ios",
      mode: "ui"
    };
  }

  if (Platform.OS === "android") {
    return {
      id: "openclaw-android",
      version: "0.0.1",
      platform: "android",
      mode: "ui"
    };
  }

  return {
    id: "webchat",
    version: "0.0.1",
    platform: Platform.OS,
    mode: "webchat"
  };
}
