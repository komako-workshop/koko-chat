#!/usr/bin/env node
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;

export function createRelayServer(options = {}) {
  const host = options.host ?? process.env.KOKO_RELAY_HOST ?? DEFAULT_HOST;
  const port = Number(options.port ?? process.env.KOKO_RELAY_PORT ?? DEFAULT_PORT);
  const maxPayload = Number(
    options.maxPayloadBytes ?? process.env.KOKO_RELAY_MAX_PAYLOAD_BYTES ?? DEFAULT_MAX_PAYLOAD_BYTES
  );
  const logger = options.logger ?? console;
  const connectors = new Map();
  const stats = {
    startedAtMs: Date.now(),
    acceptedGatewayConnections: 0,
    acceptedConnectorConnections: 0,
    rejectedGatewayConnections: 0
  };

  const httpServer = createServer((req, res) => {
    if (req.url === "/healthz" || req.url === "/health") {
      const body = JSON.stringify({
        ok: true,
        status: "live",
        connectors: connectors.size,
        uptimeMs: Date.now() - stats.startedAtMs
      });
      res.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store"
      });
      res.end(body);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found\n");
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload });

  httpServer.on("upgrade", (req, socket, head) => {
    let parsed;
    try {
      parsed = parseRelayUrl(req.url);
    } catch {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    if (parsed.kind === "unknown") {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      if (parsed.kind === "connector") {
        acceptConnector(ws, parsed);
      } else {
        acceptGateway(ws, parsed);
      }
    });
  });

  function acceptConnector(ws, parsed) {
    stats.acceptedConnectorConnections += 1;
    const existing = connectors.get(parsed.relayId);
    if (existing !== undefined) {
      if (existing.secret !== parsed.secret) {
        closeQuietly(ws, 1008, "relay id already registered");
        return;
      }
      closeConnector(existing, 1012, "connector replaced");
    }

    const connector = {
      relayId: parsed.relayId,
      secret: parsed.secret,
      ws,
      streams: new Map(),
      openedAtMs: Date.now()
    };
    connectors.set(parsed.relayId, connector);
    logger.info?.(`[relay] connector online relayId=${parsed.relayId}`);

    ws.on("message", (data) => {
      handleConnectorMessage(connector, data);
    });
    ws.on("close", (code, reason) => {
      if (connectors.get(parsed.relayId) === connector) {
        connectors.delete(parsed.relayId);
      }
      for (const stream of connector.streams.values()) {
        closeQuietly(stream.client, 1013, "connector offline");
      }
      connector.streams.clear();
      logger.info?.(`[relay] connector offline relayId=${parsed.relayId} code=${code} reason=${reason}`);
    });
    ws.on("error", (error) => {
      logger.warn?.(`[relay] connector error relayId=${parsed.relayId}: ${error.message}`);
    });
  }

  function acceptGateway(client, parsed) {
    const connector = connectors.get(parsed.relayId);
    if (connector === undefined || connector.secret !== parsed.secret || connector.ws.readyState !== WebSocket.OPEN) {
      stats.rejectedGatewayConnections += 1;
      closeQuietly(client, 1013, "relay connector unavailable");
      return;
    }

    stats.acceptedGatewayConnections += 1;
    const streamId = randomUUID();
    connector.streams.set(streamId, { client });
    connector.ws.send(JSON.stringify({ type: "open", streamId }));

    client.on("message", (data, isBinary) => {
      if (isBinary) {
        closeStream(connector, streamId, 1003, "binary frames are not supported");
        return;
      }
      const text = typeof data === "string" ? data : data.toString("utf8");
      sendConnector(connector, { type: "data", streamId, data: text });
    });
    client.on("close", (code, reason) => {
      connector.streams.delete(streamId);
      sendConnector(connector, { type: "close", streamId, code, reason: reason.toString() });
    });
    client.on("error", () => {
      connector.streams.delete(streamId);
      sendConnector(connector, { type: "close", streamId, code: 1011, reason: "client error" });
    });
  }

  function handleConnectorMessage(connector, data) {
    let msg;
    try {
      msg = JSON.parse(typeof data === "string" ? data : data.toString("utf8"));
    } catch {
      closeConnector(connector, 1003, "invalid connector json");
      return;
    }

    if (!msg || typeof msg !== "object" || typeof msg.streamId !== "string") {
      closeConnector(connector, 1003, "invalid connector frame");
      return;
    }

    const stream = connector.streams.get(msg.streamId);
    if (stream === undefined) {
      return;
    }

    if (msg.type === "data" && typeof msg.data === "string") {
      if (stream.client.readyState === WebSocket.OPEN) {
        stream.client.send(msg.data);
      }
      return;
    }

    if (msg.type === "close") {
      closeStream(connector, msg.streamId, Number(msg.code) || 1011, stringOr(msg.reason, "gateway closed"));
      return;
    }

    closeConnector(connector, 1003, "unknown connector frame");
  }

  function closeStream(connector, streamId, code, reason) {
    const stream = connector.streams.get(streamId);
    connector.streams.delete(streamId);
    if (stream !== undefined) {
      closeQuietly(stream.client, code, reason);
    }
    sendConnector(connector, { type: "close", streamId, code, reason });
  }

  function closeConnector(connector, code, reason) {
    closeQuietly(connector.ws, code, reason);
  }

  function sendConnector(connector, message) {
    if (connector.ws.readyState === WebSocket.OPEN) {
      connector.ws.send(JSON.stringify(message));
    }
  }

  function listen() {
    return new Promise((resolve) => {
      httpServer.listen(port, host, () => {
        logger.info?.(`[relay] listening on ${host}:${port}`);
        resolve({ host, port });
      });
    });
  }

  function close() {
    return new Promise((resolve) => {
      for (const connector of connectors.values()) {
        closeConnector(connector, 1001, "relay shutting down");
      }
      wss.close(() => {
        httpServer.close(() => resolve());
      });
    });
  }

  return {
    httpServer,
    listen,
    close,
    stats,
    connectorCount: () => connectors.size
  };
}

function parseRelayUrl(rawUrl) {
  const url = new URL(rawUrl ?? "/", "http://relay.local");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length === 3 && parts[0] === "v1" && (parts[1] === "connector" || parts[1] === "gateway")) {
    const secret = url.searchParams.get("secret") ?? "";
    const relayId = parts[2] ?? "";
    if (!isRelayId(relayId) || !isSecret(secret)) {
      throw new Error("invalid relay id or secret");
    }
    return { kind: parts[1], relayId, secret };
  }
  return { kind: "unknown" };
}

function isRelayId(value) {
  return /^[A-Za-z0-9_-]{16,160}$/.test(value);
}

function isSecret(value) {
  return /^[A-Za-z0-9_-]{32,256}$/.test(value);
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createRelayServer();
  await server.listen();
}
