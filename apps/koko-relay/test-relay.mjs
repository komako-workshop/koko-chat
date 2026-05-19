#!/usr/bin/env node
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocketServer, WebSocket } from "ws";

import { createRelayServer } from "./server.mjs";

const gatewayServer = new WebSocketServer({ port: 0 });
const gatewayPort = gatewayServer.address().port;
gatewayServer.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "n1" } }));
  ws.on("message", (data) => {
    ws.send(data.toString("utf8"));
  });
});

const relay = createRelayServer({ host: "127.0.0.1", port: 0, logger: silentLogger() });
await relay.listen();
const relayPort = relay.httpServer.address().port;
const relayId = "test-relay-123456";
const secret = "test-secret-123456789012345678901234";

const connector = new WebSocket(`ws://127.0.0.1:${relayPort}/v1/connector/${relayId}?secret=${secret}`);
await once(connector, "open");

const streams = new Map();
connector.on("message", (raw) => {
  const msg = JSON.parse(raw.toString("utf8"));
  if (msg.type === "open") {
    const local = new WebSocket(`ws://127.0.0.1:${gatewayPort}`);
    streams.set(msg.streamId, local);
    local.on("message", (data) => {
      connector.send(JSON.stringify({ type: "data", streamId: msg.streamId, data: data.toString("utf8") }));
    });
    local.on("close", () => {
      connector.send(JSON.stringify({ type: "close", streamId: msg.streamId, code: 1000, reason: "local closed" }));
    });
    return;
  }
  if (msg.type === "data") {
    streams.get(msg.streamId)?.send(msg.data);
  }
});

const client = new WebSocket(`ws://127.0.0.1:${relayPort}/v1/gateway/${relayId}?secret=${secret}`);
await once(client, "open");
const [challenge] = await once(client, "message");
assert.deepEqual(JSON.parse(challenge.toString("utf8")), {
  type: "event",
  event: "connect.challenge",
  payload: { nonce: "n1" }
});

client.send(JSON.stringify({ type: "req", id: "1", method: "ping" }));
const [echo] = await once(client, "message");
assert.deepEqual(JSON.parse(echo.toString("utf8")), { type: "req", id: "1", method: "ping" });

client.close();
connector.close();
for (const local of streams.values()) {
  local.close();
}
await new Promise((resolve) => gatewayServer.close(resolve));
await relay.close();

function silentLogger() {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  };
}
