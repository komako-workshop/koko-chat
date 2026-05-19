import {
  DEFAULT_ROLE,
  DEFAULT_SCOPES,
  base64url,
  deriveDeviceIdentity,
  type GatewayClientMetadata
} from "@koko/openclaw-client/protocol";

import { loadOrCreateDeviceSeed } from "@/gateway/identityStorage";

const PAIRING_REQUEST_TYPE = "kokochat.pairingRequest";
const KOKOCHAT_REPO_URL = "https://github.com/komako-workshop/koko-chat.git";
const KOKOCHAT_OPENCLAW_INSTALL_URL =
  "https://github.com/komako-workshop/koko-chat#openclaw-setup";

const pairingClient: GatewayClientMetadata = {
  id: "webchat",
  version: "0.0.1",
  platform: "web",
  mode: "webchat"
};

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
      ...pairingClient,
      displayName: "KokoChat"
    }
  };
}

export async function buildKokoChatPairingPrompt(): Promise<string> {
  const request = await buildKokoChatPairingRequest();
  const code = encodeJson(request);
  const installAndPairCommand = [
    "set -eu",
    'KOKOCHAT_REPO="${HOME}/.kokochat/koko-chat"',
    'mkdir -p "$(dirname "$KOKOCHAT_REPO")"',
    'if [ -d "$KOKOCHAT_REPO/.git" ]; then',
    '  git -C "$KOKOCHAT_REPO" pull --ff-only',
    'elif [ -e "$KOKOCHAT_REPO" ]; then',
    '  echo "$KOKOCHAT_REPO exists but is not a git repo" >&2',
    "  exit 1",
    "else",
    `  git clone ${KOKOCHAT_REPO_URL} "$KOKOCHAT_REPO"`,
    "fi",
    'node "$KOKOCHAT_REPO/scripts/install-openclaw-support.mjs"',
    `KOKOCHAT_PAIRING_REQUEST='${code}' node "$KOKOCHAT_REPO/openclaw/skills/kokochat-pairing/generate-kokochat-code.mjs"`
  ].join("\n");

  return [
    "请为这台手机安装或更新 KokoChat 的 OpenClaw 支持，然后批准下面这个 KokoChat 配对请求。命令成功后只返回最后输出的 KokoChat 连接码；如果命令失败，请返回失败原因。",
    "",
    "请在 OpenClaw 所在机器上执行这段命令：",
    "",
    "```bash",
    installAndPairCommand,
    "```",
    "",
    "安装说明在这里，命令失败时按 README 的 OpenClaw Setup 排查：",
    KOKOCHAT_OPENCLAW_INSTALL_URL,
    "",
    "KokoChat 配对请求：",
    code
  ].join("\n");
}
