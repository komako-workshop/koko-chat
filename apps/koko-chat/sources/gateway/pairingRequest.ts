import {
  DEFAULT_ROLE,
  DEFAULT_SCOPES,
  base64url,
  deriveDeviceIdentity,
  type GatewayClientMetadata
} from "@koko/openclaw-client/protocol";

import { kokoGatewayClientMetadata } from "@/gateway/clientMetadata";
import { loadOrCreateDeviceSeed } from "@/gateway/identityStorage";

const PAIRING_REQUEST_TYPE = "kokochat.pairingRequest";
const KOKOCHAT_OPENCLAW_INSTALL_URL =
  "https://github.com/komako-workshop/koko-chat#openclaw-setup";

export interface KokoChatPairingRequest {
  type: typeof PAIRING_REQUEST_TYPE;
  version: 1;
  deviceId: string;
  publicKey: string;
  role: typeof DEFAULT_ROLE;
  scopes: string[];
  client: GatewayClientMetadata & { displayName: string };
}

function encodeJson(value: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}

export async function buildKokoChatPairingRequest(): Promise<KokoChatPairingRequest> {
  const identity = await deriveDeviceIdentity(loadOrCreateDeviceSeed());
  return {
    type: PAIRING_REQUEST_TYPE,
    version: 1,
    deviceId: identity.deviceId,
    publicKey: identity.publicKey,
    role: DEFAULT_ROLE,
    scopes: [...DEFAULT_SCOPES],
    client: {
      ...kokoGatewayClientMetadata(),
      displayName: "KokoChat"
    }
  };
}

export async function buildKokoChatPairingPrompt(): Promise<string> {
  const request = await buildKokoChatPairingRequest();
  const code = encodeJson(request);
  return [
    "请查看 KokoChat 开源仓库 README 的 OpenClaw Setup，按说明安装或更新 KokoChat 支持，然后批准下面的配对请求，并只返回 KokoChat 连接码。",
    "如果 OpenClaw 版本低于 2026.4.15，安装脚本会先升级到 2026.5.22；期间 Gateway 可能短暂断开或重启。等脚本结束并恢复连接后，再批准下面的配对请求：",
    KOKOCHAT_OPENCLAW_INSTALL_URL,
    "",
    "KokoChat 配对请求：",
    code
  ].join("\n");
}
