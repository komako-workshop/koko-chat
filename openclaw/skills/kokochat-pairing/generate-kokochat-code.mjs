#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir, platform } from "node:os";
import { fileURLToPath } from "node:url";

const REQUIRED_SCOPES = [
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.talk.secrets"
];
const OPTIONAL_SCOPES = [
  "operator.admin"
];
const DEFAULT_SCOPES = [
  ...OPTIONAL_SCOPES,
  ...REQUIRED_SCOPES
];
const RELAY_STATE_FILE = "relay.json";

const argInput = process.argv.slice(2).join(" ");
const input = process.env.KOKOCHAT_PAIRING_REQUEST || argInput || readStdin();

const request = parsePairingRequest(input);
const stateDir = process.env.OPENCLAW_CONFIG_DIR ?? process.env.OPENCLAW_HOME ?? join(homedir(), ".openclaw");
const deviceToken = approveDevice(stateDir, request);
const relay = prepareRelayConnector(stateDir, request);
const gatewayUrl = relay?.gatewayUrl ?? resolveGatewayUrl(stateDir);
const setupCode = encodeJson({
  url: gatewayUrl,
  deviceToken,
  deviceId: request.deviceId,
  ...(relay ? { relay: { id: relay.relayId, mode: "gateway-tunnel" } } : {})
});

process.stdout.write(`${setupCode}\n`);

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parsePairingRequest(rawInput) {
  const candidates = [];
  const trimmed = String(rawInput ?? "").trim();
  if (trimmed) {
    candidates.push(trimmed);
  }
  for (const match of trimmed.matchAll(/[A-Za-z0-9_-]{80,}/g)) {
    candidates.push(match[0]);
  }

  for (const candidate of candidates) {
    const parsed = parseCandidate(candidate);
    if (parsed) {
      return validateRequest(parsed);
    }
  }
  throw new Error("No valid KokoChat pairing request found.");
}

function parseCandidate(candidate) {
  try {
    return JSON.parse(candidate);
  } catch {
    // Try base64url/base64 below.
  }

  try {
    return JSON.parse(Buffer.from(candidate, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function validateRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("KokoChat pairing request must decode to an object.");
  }
  if (value.type !== "kokochat.pairingRequest" || value.version !== 1) {
    throw new Error("Unsupported KokoChat pairing request type or version.");
  }
  const deviceId = stringField(value, "deviceId");
  const publicKey = stringField(value, "publicKey");
  if (!/^[0-9a-f]{64}$/.test(deviceId)) {
    throw new Error("KokoChat pairing request has an invalid deviceId.");
  }
  if (!/^[A-Za-z0-9_-]{32,}$/.test(publicKey)) {
    throw new Error("KokoChat pairing request has an invalid publicKey.");
  }
  const role = typeof value.role === "string" && value.role.trim() ? value.role.trim() : "operator";
  if (role !== "operator") {
    throw new Error(`Unsupported KokoChat role: ${role}`);
  }
  const requestedScopes = normalizeScopes(Array.isArray(value.scopes) ? value.scopes : DEFAULT_SCOPES);
  const scopes = DEFAULT_SCOPES.filter((scope) => requestedScopes.includes(scope));
  if (!REQUIRED_SCOPES.every((scope) => scopes.includes(scope))) {
    throw new Error("KokoChat pairing request is missing required operator scopes.");
  }
  const client = value.client && typeof value.client === "object" && !Array.isArray(value.client) ? value.client : {};
  return {
    deviceId,
    publicKey,
    role,
    scopes,
    displayName: stringField(client, "displayName", "KokoChat"),
    platform: stringField(client, "platform", "web"),
    deviceFamily: optionalStringField(client, "deviceFamily"),
    clientId: stringField(client, "id", "webchat"),
    clientMode: stringField(client, "mode", "webchat")
  };
}

function stringField(value, key, fallback) {
  const raw = value?.[key];
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(`KokoChat pairing request is missing ${key}.`);
}

function optionalStringField(value, key) {
  const raw = value?.[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

function normalizeScopes(scopes) {
  return [...new Set(scopes.map((scope) => String(scope).trim()).filter(Boolean))].sort();
}

function approveDevice(root, request) {
  const devicesDir = join(root, "devices");
  mkdirSync(devicesDir, { recursive: true, mode: 0o700 });
  const pairedPath = join(devicesDir, "paired.json");
  const pendingPath = join(devicesDir, "pending.json");
  const paired = readJsonObject(pairedPath);
  const pending = readJsonObject(pendingPath);
  const existing = paired[request.deviceId];
  if (existing?.publicKey && existing.publicKey !== request.publicKey) {
    throw new Error("Refusing to replace an existing paired device with a different public key.");
  }

  const now = Date.now();
  const existingToken = existing?.tokens?.[request.role];
  const token = randomBytes(32).toString("base64url");
  const roles = mergeStrings(existing?.roles, existing?.role, [request.role]);
  const approvedScopes = mergeStrings(existing?.approvedScopes ?? existing?.scopes, request.scopes);
  const tokens = { ...(existing?.tokens ?? {}) };
  tokens[request.role] = {
    token,
    role: request.role,
    scopes: request.scopes,
    createdAtMs: existingToken?.createdAtMs ?? now,
    ...(existingToken ? { rotatedAtMs: now } : {}),
    ...(existingToken?.lastUsedAtMs ? { lastUsedAtMs: existingToken.lastUsedAtMs } : {})
  };

  paired[request.deviceId] = {
    ...(existing ?? {}),
    deviceId: request.deviceId,
    publicKey: request.publicKey,
    displayName: request.displayName,
    platform: request.platform,
    ...(request.deviceFamily ? { deviceFamily: request.deviceFamily } : {}),
    clientId: request.clientId,
    clientMode: request.clientMode,
    role: request.role,
    roles,
    scopes: approvedScopes,
    approvedScopes,
    tokens,
    createdAtMs: existing?.createdAtMs ?? now,
    approvedAtMs: now
  };

  for (const [id, item] of Object.entries(pending)) {
    if (item?.deviceId === request.deviceId) {
      delete pending[id];
    }
  }

  writeJsonAtomic(pairedPath, paired);
  writeJsonAtomic(pendingPath, pending);
  return token;
}

function mergeStrings(...items) {
  const out = new Set();
  for (const item of items) {
    const values = Array.isArray(item) ? item : item ? [item] : [];
    for (const value of values) {
      const trimmed = String(value).trim();
      if (trimmed) {
        out.add(trimmed);
      }
    }
  }
  return [...out];
}

function readJsonObject(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeJsonAtomic(file, value) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, file);
}

function resolveGatewayUrl(root) {
  if (process.env.KOKOCHAT_GATEWAY_URL) {
    return normalizeWsUrl(process.env.KOKOCHAT_GATEWAY_URL);
  }
  if (process.env.OPENCLAW_PUBLIC_URL) {
    return normalizeWsUrl(process.env.OPENCLAW_PUBLIC_URL);
  }

  const config = readJsonObject(join(root, "openclaw.json"));
  const port = Number(config.gateway?.port) || 18789;
  const origin = config.gateway?.controlUi?.allowedOrigins?.find(
    (value) => typeof value === "string" && !isLoopbackUrl(value)
  );
  if (origin) {
    return normalizeWsUrl(origin);
  }
  const host = process.env.OPENCLAW_PUBLIC_HOST || localLanIp() || "127.0.0.1";
  return `ws://${host}:${port}`;
}

function prepareRelayConnector(root, request) {
  const rawRelayUrl = process.env.KOKOCHAT_RELAY_URL;
  if (!rawRelayUrl) {
    return null;
  }
  const relayUrl = normalizeWsUrl(rawRelayUrl).replace(/\/+$/, "");
  if (!/^wss?:\/\//.test(relayUrl)) {
    throw new Error("KOKOCHAT_RELAY_URL must start with ws:// or wss://");
  }

  const { relayId, relaySecret } = loadOrCreateRelayCredentials(root, relayUrl);
  const gatewayUrl = relayGatewayUrl(relayUrl, relayId, relaySecret);
  const localGatewayUrl = resolveLocalGatewayUrl(root);
  const configPath = writeRelayConnectorConfig(root, {
    relayUrl,
    relayId,
    relaySecret,
    gatewayUrl: localGatewayUrl
  });
  startRelayConnector(root, relayId, configPath);
  return { relayId, gatewayUrl };
}

function loadOrCreateRelayCredentials(root, relayUrl) {
  const dir = join(root, "kokochat-relay");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const statePath = join(dir, RELAY_STATE_FILE);
  const existing = readJsonObject(statePath);
  if (
    existing.relayUrl === relayUrl &&
    isRelayId(existing.relayId) &&
    isRelaySecret(existing.relaySecret)
  ) {
    return {
      relayId: existing.relayId,
      relaySecret: existing.relaySecret
    };
  }

  const next = {
    relayUrl,
    relayId: randomBytes(18).toString("base64url"),
    relaySecret: randomBytes(32).toString("base64url"),
    createdAtMs: Date.now()
  };
  writeJsonAtomic(statePath, next);
  chmodSync(statePath, 0o600);
  return next;
}

function resolveLocalGatewayUrl(root) {
  if (process.env.KOKOCHAT_LOCAL_GATEWAY_URL) {
    return normalizeWsUrl(process.env.KOKOCHAT_LOCAL_GATEWAY_URL);
  }
  const config = readJsonObject(join(root, "openclaw.json"));
  const port = Number(config.gateway?.port) || 18789;
  return `ws://127.0.0.1:${port}`;
}

function relayGatewayUrl(relayUrl, relayId, relaySecret) {
  return `${relayUrl}/v1/gateway/${encodeURIComponent(relayId)}?secret=${encodeURIComponent(relaySecret)}`;
}

function writeRelayConnectorConfig(root, config) {
  const dir = join(root, "kokochat-relay");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${config.relayId}.json`);
  writeJsonAtomic(file, config);
  chmodSync(file, 0o600);
  return file;
}

function startRelayConnector(root, relayId, configPath) {
  const connector = fileURLToPath(new URL("../../relay/kokochat-relay-connector.mjs", import.meta.url));
  if (!existsSync(connector)) {
    throw new Error(`KokoChat relay connector is missing: ${connector}`);
  }

  const pidFile = join(root, "kokochat-relay", `${relayId}.pid`);
  stopOtherRelayConnectors(root, relayId);
  if (isPidAlive(pidFile)) {
    return;
  }
  stopExistingConnector(pidFile);
  const child = spawn(process.execPath, [connector, "--config", configPath], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      KOKOCHAT_RELAY_CONNECTOR_CONFIG: configPath
    }
  });
  child.unref();
  writeFileSync(pidFile, `${child.pid}\n`, { mode: 0o600 });
}

function stopOtherRelayConnectors(root, relayId) {
  const dir = join(root, "kokochat-relay");
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".pid") || entry === `${relayId}.pid`) {
      continue;
    }
    stopExistingConnector(join(dir, entry));
  }
}

function isPidAlive(pidFile) {
  if (!existsSync(pidFile)) {
    return false;
  }
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stopExistingConnector(pidFile) {
  if (!existsSync(pidFile)) {
    return;
  }
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // The previous connector is already gone.
  }
}

function normalizeWsUrl(url) {
  return String(url).replace(/^http:/, "ws:").replace(/^https:/, "wss:");
}

function isLoopbackUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function localLanIp() {
  if (platform() === "darwin") {
    for (const iface of ["en0", "en1"]) {
      try {
        const ip = execFileSync("ipconfig", ["getifaddr", iface], { encoding: "utf8" }).trim();
        if (ip) {
          return ip;
        }
      } catch {
        // Try the next interface.
      }
    }
  }
  try {
    const out = execFileSync("hostname", ["-I"], { encoding: "utf8" }).trim();
    return out.split(/\s+/).find(Boolean);
  } catch {
    return undefined;
  }
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function isRelayId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,160}$/.test(value);
}

function isRelaySecret(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,256}$/.test(value);
}
