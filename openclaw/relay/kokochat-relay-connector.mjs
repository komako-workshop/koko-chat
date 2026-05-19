#!/usr/bin/env node
import { readFileSync } from "node:fs";

const config = loadConfig();
const reconnectBaseMs = Number(process.env.KOKOCHAT_RELAY_RECONNECT_BASE_MS ?? 1000);
const reconnectMaxMs = Number(process.env.KOKOCHAT_RELAY_RECONNECT_MAX_MS ?? 30000);
let reconnectAttempt = 0;

connectRelay();

function connectRelay() {
  const relayWs = new WebSocket(connectorUrl(config));
  const streams = new Map();

  relayWs.addEventListener("open", () => {
    reconnectAttempt = 0;
    log(`connected relay=${redactUrl(config.relayUrl)} id=${config.relayId}`);
  });

  relayWs.addEventListener("message", (event) => {
    handleRelayMessage(relayWs, streams, event.data);
  });

  relayWs.addEventListener("close", (event) => {
    for (const local of streams.values()) {
      closeQuietly(local, 1012, "relay closed");
    }
    streams.clear();
    const delay = Math.min(reconnectMaxMs, reconnectBaseMs * 2 ** reconnectAttempt);
    reconnectAttempt += 1;
    log(`relay closed code=${event.code}; reconnecting in ${delay}ms`);
    setTimeout(connectRelay, delay);
  });

  relayWs.addEventListener("error", () => {
    log("relay websocket error");
  });
}

function handleRelayMessage(relayWs, streams, raw) {
  let msg;
  try {
    msg = JSON.parse(String(raw));
  } catch {
    closeQuietly(relayWs, 1003, "invalid relay json");
    return;
  }
  if (!msg || typeof msg !== "object" || typeof msg.streamId !== "string") {
    closeQuietly(relayWs, 1003, "invalid relay frame");
    return;
  }

  if (msg.type === "open") {
    openLocalGateway(relayWs, streams, msg.streamId);
    return;
  }

  const local = streams.get(msg.streamId);
  if (local === undefined) {
    return;
  }

  if (msg.type === "data" && typeof msg.data === "string") {
    if (local.readyState === WebSocket.OPEN) {
      local.send(msg.data);
    } else {
      const queue = local.__kokoQueue ?? [];
      queue.push(msg.data);
      local.__kokoQueue = queue;
    }
    return;
  }

  if (msg.type === "close") {
    streams.delete(msg.streamId);
    closeQuietly(local, Number(msg.code) || 1000, stringOr(msg.reason, "client closed"));
    return;
  }

  closeQuietly(relayWs, 1003, "unknown relay frame");
}

function openLocalGateway(relayWs, streams, streamId) {
  const local = new WebSocket(config.gatewayUrl);
  streams.set(streamId, local);

  local.addEventListener("open", () => {
    const queue = local.__kokoQueue ?? [];
    local.__kokoQueue = [];
    for (const item of queue) {
      local.send(item);
    }
  });

  local.addEventListener("message", (event) => {
    if (relayWs.readyState === WebSocket.OPEN) {
      relayWs.send(JSON.stringify({ type: "data", streamId, data: String(event.data) }));
    }
  });

  local.addEventListener("close", (event) => {
    streams.delete(streamId);
    if (relayWs.readyState === WebSocket.OPEN) {
      relayWs.send(
        JSON.stringify({
          type: "close",
          streamId,
          code: event.code || 1000,
          reason: event.reason || "gateway closed"
        })
      );
    }
  });

  local.addEventListener("error", () => {
    streams.delete(streamId);
    closeQuietly(local, 1011, "gateway websocket error");
    if (relayWs.readyState === WebSocket.OPEN) {
      relayWs.send(JSON.stringify({ type: "close", streamId, code: 1011, reason: "gateway websocket error" }));
    }
  });
}

function loadConfig() {
  const configPath = argValue("--config") ?? process.env.KOKOCHAT_RELAY_CONNECTOR_CONFIG;
  if (configPath) {
    return validateConfig(JSON.parse(readFileSync(configPath, "utf8")));
  }
  return validateConfig({
    relayUrl: requiredEnv("KOKOCHAT_RELAY_URL"),
    relayId: requiredEnv("KOKOCHAT_RELAY_ID"),
    relaySecret: requiredEnv("KOKOCHAT_RELAY_SECRET"),
    gatewayUrl: process.env.KOKOCHAT_LOCAL_GATEWAY_URL ?? "ws://127.0.0.1:18789"
  });
}

function validateConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("connector config must be an object");
  }
  const relayUrl = wsUrl(value.relayUrl, "relayUrl");
  const relayId = stringField(value, "relayId");
  const relaySecret = stringField(value, "relaySecret");
  const gatewayUrl = wsUrl(value.gatewayUrl ?? "ws://127.0.0.1:18789", "gatewayUrl");
  return { relayUrl, relayId, relaySecret, gatewayUrl };
}

function connectorUrl(value) {
  const base = value.relayUrl.replace(/\/+$/, "");
  return `${base}/v1/connector/${encodeURIComponent(value.relayId)}?secret=${encodeURIComponent(value.relaySecret)}`;
}

function wsUrl(value, key) {
  const text = stringField({ [key]: value }, key);
  if (!/^wss?:\/\//.test(text)) {
    throw new Error(`${key} must start with ws:// or wss://`);
  }
  return text;
}

function stringField(value, key) {
  const raw = value?.[key];
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }
  throw new Error(`missing connector config field ${key}`);
}

function requiredEnv(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  return process.argv[index + 1];
}

function closeQuietly(ws, code, reason) {
  try {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(code, reason);
    }
  } catch {
    // Ignore shutdown races.
  }
}

function stringOr(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function redactUrl(value) {
  return value.replace(/secret=[^&]+/g, "secret=<redacted>");
}

function log(message) {
  console.error(`[kokochat-relay-connector] ${message}`);
}
