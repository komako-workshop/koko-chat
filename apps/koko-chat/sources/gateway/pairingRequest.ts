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
const KOKOCHAT_OPENCLAW_INSTALL_COMMAND = `KOKOCHAT_REPO="\${HOME}/.kokochat/koko-chat"
mkdir -p "$(dirname "$KOKOCHAT_REPO")"
if [ -d "$KOKOCHAT_REPO/.git" ]; then
  git -C "$KOKOCHAT_REPO" pull --ff-only
else
  git clone https://github.com/komako-workshop/koko-chat.git "$KOKOCHAT_REPO"
fi
node "$KOKOCHAT_REPO/scripts/install-openclaw-support.mjs"`;

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

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
  const command = [
    `KOKOCHAT_PAIRING_REQUEST=${shellSingleQuote(code)}`,
    KOKOCHAT_OPENCLAW_INSTALL_COMMAND,
    `openclaw gateway restart || true`,
    `KOKOCHAT_PAIRING_REQUEST="$KOKOCHAT_PAIRING_REQUEST" node "$KOKOCHAT_REPO/openclaw/skills/kokochat-pairing/generate-kokochat-code.mjs"`
  ].join("\n");
  return [
    "请在运行 OpenClaw 的电脑 / 服务器终端里粘贴并运行下面整段命令。",
    "",
    "它会安装或更新 KokoChat support，然后批准这台手机的配对请求，最后输出 KokoChat 连接码。不要把 Brave / OpenRouter / OpenAI 等 API key 发给 KokoChat；Deeply 搜索走 KokoChat 托管服务。",
    "",
    "```bash",
    command,
    "```",
    "",
    "低于 2026.4.15 的 OpenClaw 会先升级到 2026.5.22；期间 Gateway 可能短暂断开或重启。等命令结束后，把最后输出的连接码粘贴回 KokoChat。",
    "",
    "参考说明：",
    KOKOCHAT_OPENCLAW_INSTALL_URL
  ].join("\n");
}
