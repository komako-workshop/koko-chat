import { initCrypto } from "@koko/protocol";
import Fastify from "fastify";
import type { Logger } from "pino";
import { registerHealthRoute } from "./http/health";
import { registerPairingRoutes } from "./pairing/routes";
import { PairingStore } from "./pairing/store";
import { RoomWebSocketHandler } from "./room/handler";
import { RoomStore } from "./room/store";

/** Options required to construct a relay server. */
export interface RelayServerOptions {
  /** TCP port to listen on. Use 0 in tests for a random port. */
  port: number;
  /** Host interface to bind. */
  host: string;
  /** Structured logger. */
  logger: Logger;
  /** Pairing request TTL in milliseconds. */
  pairingTtlMs: number;
  /** Room inactivity TTL in milliseconds. */
  roomTtlMs: number;
  /** Maximum number of offline envelopes held per room and target role. */
  roomOfflineQueueMax: number;
  /** Offline queue entry TTL in milliseconds. */
  roomOfflineQueueTtlMs: number;
}

/** Running relay server instance. */
export interface RelayServer {
  /** Starts listening and returns the actual bound address and port. */
  listen(): Promise<{ address: string; port: number }>;
  /** Closes HTTP, WebSocket, and in-memory store resources. */
  close(): Promise<void>;
  /** Returns lightweight operational counters. */
  stats(): {
    pairingRequests: number;
    rooms: number;
    activeConnections: number;
  };
}

function parseRequestUrl(reqUrl: string | undefined, host: string | string[] | undefined): URL {
  const hostname = Array.isArray(host) ? host[0] : host;
  return new URL(reqUrl ?? "/", `http://${hostname ?? "localhost"}`);
}

function roomIdFromPath(pathname: string): string | null {
  const prefix = "/v1/room/";
  if (!pathname.startsWith(prefix)) {
    return null;
  }
  const roomId = pathname.slice(prefix.length);
  return roomId.length > 0 && !roomId.includes("/") ? decodeURIComponent(roomId) : null;
}

function errorCodeOf(error: unknown): string | undefined {
  return error !== null && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function invalidJsonError(): Error & { code: string } {
  const error = new Error("request body must be valid JSON") as Error & { code: string };
  error.code = "FST_ERR_CTP_INVALID_JSON_BODY";
  return error;
}

/** Creates a relay server with HTTP pairing routes and WebSocket room handling. */
export function createRelayServer(options: RelayServerOptions): RelayServer {
  const startedAt = Date.now();
  const pairingStore = new PairingStore(options.pairingTtlMs);
  const roomStore = new RoomStore(
    options.roomTtlMs,
    options.roomOfflineQueueMax,
    options.roomOfflineQueueTtlMs
  );
  const app = Fastify({
    bodyLimit: 64 * 1024,
    exposeHeadRoutes: false,
    loggerInstance: options.logger
  });
  const roomHandler = new RoomWebSocketHandler({
    roomStore,
    logger: options.logger
  });

  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string", bodyLimit: 64 * 1024 }, (_request, body, done) => {
    const text = typeof body === "string" ? body : body.toString("utf8");
    if (text.length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch {
      done(invalidJsonError());
    }
  });

  registerHealthRoute(app, startedAt);
  registerPairingRoutes(app, {
    pairingStore,
    roomStore,
    logger: options.logger
  });

  app.setNotFoundHandler(async (_request, reply) => {
    return reply.status(404).send({ error: "not_found", message: "route not found" });
  });

  app.setErrorHandler((error, _request, reply) => {
    const code = errorCodeOf(error);
    if (code === "FST_ERR_CTP_INVALID_JSON_BODY") {
      void reply.status(400).send({ error: "invalid_json", message: "request body must be valid JSON" });
      return;
    }
    if (code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      void reply.status(413).send({ error: "body_too_large", message: "request body is too large" });
      return;
    }
    options.logger.error(error instanceof Error ? error : { error }, "unhandled HTTP route error");
    void reply.status(500).send({ error: "internal_error", message: "internal server error" });
  });

  app.server.on("upgrade", (req, socket, head) => {
    const url = parseRequestUrl(req.url, req.headers.host);
    const roomId = roomIdFromPath(url.pathname);
    if (roomId === null) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    roomHandler.handleUpgrade(req, socket, head, roomId);
  });

  return {
    async listen(): Promise<{ address: string; port: number }> {
      await initCrypto();
      await app.listen({ port: options.port, host: options.host });
      const address = app.server.address();
      if (address === null || typeof address === "string") {
        return { address: options.host, port: options.port };
      }
      return { address: address.address, port: address.port };
    },

    async close(): Promise<void> {
      await roomHandler.close();
      pairingStore.close();
      roomStore.clear();
      await app.close();
    },

    stats() {
      return {
        pairingRequests: pairingStore.size(),
        rooms: roomStore.size(),
        activeConnections: roomStore.activeConnections()
      };
    }
  };
}
