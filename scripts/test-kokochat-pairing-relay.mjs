#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PAIRING_SCRIPT = new URL("../openclaw/skills/kokochat-pairing/generate-kokochat-code.mjs", import.meta.url);
const DEFAULT_RELAY_PREFIX = "ws://47.84.141.40:8787/v1/gateway/";

runCase("default relay ignores direct gateway config", {
  env: {
    KOKOCHAT_RELAY_URL: "",
    KOKOCHAT_GATEWAY_URL: "ws://198.51.100.11:18789",
    OPENCLAW_PUBLIC_URL: "ws://198.51.100.10:18789",
    OPENCLAW_PUBLIC_HOST: "198.51.100.12"
  },
  openclawJson: {
    gateway: {
      port: 18789,
      controlUi: {
        allowedOrigins: ["http://192.168.71.168:18789"]
      }
    }
  },
  assert: ({ setup, connectorConfig }) => {
    assert(setup.url.startsWith(DEFAULT_RELAY_PREFIX), `expected default relay url, got ${setup.url}`);
    assert(!setup.url.includes("192.168."), `setup url leaked LAN address: ${setup.url}`);
    assert(!setup.url.includes(":18789"), `setup url leaked direct gateway port: ${setup.url}`);
    assert(setup.relay?.mode === "gateway-tunnel", "setup code missing relay tunnel metadata");
    assert(connectorConfig.relayUrl === "ws://47.84.141.40:8787", "connector used wrong default relay url");
    assert(connectorConfig.gatewayUrl === "ws://127.0.0.1:18789", "connector should target local OpenClaw gateway");
  }
});

runCase("custom relay override still uses relay tunnel", {
  env: {
    KOKOCHAT_RELAY_URL: "wss://relay.example.test/koko/"
  },
  openclawJson: {
    gateway: {
      port: 19789
    }
  },
  assert: ({ setup, connectorConfig }) => {
    assert(
      setup.url.startsWith("wss://relay.example.test/koko/v1/gateway/"),
      `expected custom relay url, got ${setup.url}`
    );
    assert(connectorConfig.relayUrl === "wss://relay.example.test/koko", "connector did not normalize relay url");
    assert(connectorConfig.gatewayUrl === "ws://127.0.0.1:19789", "connector did not preserve local gateway port");
  }
});

console.log("[ok] KokoChat pairing relay regression passed");

function runCase(name, testCase) {
  const dir = mkdtempSync(join(tmpdir(), "kokochat-pairing-"));
  try {
    writeFileSync(join(dir, "openclaw.json"), `${JSON.stringify(testCase.openclawJson, null, 2)}\n`);
    const setupCode = execFileSync(process.execPath, [PAIRING_SCRIPT.pathname], {
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "test",
        OPENCLAW_CONFIG_DIR: dir,
        KOKOCHAT_PAIRING_REQUEST: encodeJson(createPairingRequest()),
        KOKOCHAT_SKIP_RELAY_CONNECTOR_START: "1",
        ...testCase.env
      }
    }).trim();
    const setup = decodeJson(setupCode);
    const connectorConfig = readSingleConnectorConfig(dir);
    testCase.assert({ setup, connectorConfig });
    console.log(`[ok] ${name}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function createPairingRequest() {
  return {
    type: "kokochat.pairingRequest",
    version: 1,
    deviceId: randomBytes(32).toString("hex"),
    publicKey: randomBytes(32).toString("base64url"),
    role: "operator",
    scopes: [
      "operator.admin",
      "operator.read",
      "operator.write",
      "operator.approvals",
      "operator.talk.secrets"
    ],
    client: {
      id: "openclaw-ios",
      version: "0.0.1-test",
      platform: "ios",
      mode: "ui",
      displayName: "KokoChat"
    }
  };
}

function readSingleConnectorConfig(root) {
  const relayState = JSON.parse(readFileSync(join(root, "kokochat-relay", "relay.json"), "utf8"));
  const file = join(root, "kokochat-relay", `${relayState.relayId}.json`);
  assert(existsSync(file), `connector config not found: ${file}`);
  return JSON.parse(readFileSync(file, "utf8"));
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeJson(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
