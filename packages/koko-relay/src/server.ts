import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import type { Socket } from "node:net";
import { initCrypto } from "@koko/protocol";
import { handleHealth } from "./http/health";
import { sendJson, sendNotFound, type HttpRequestContext } from "./http";
import type { pino } from "./logger";
import { createPairingRoutes } from "./pairing/routes";
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
  logger: pino.Logger;
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

function closeHttpServer(server: HttpServer): Promise<void> {
  if (!server.listening) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
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
  const pairingRoutes = createPairingRoutes({
    pairingStore,
    roomStore,
    logger: options.logger
  });
  const roomHandler = new RoomWebSocketHandler({
    roomStore,
    logger: options.logger
  });

  const httpServer = createHttpServer((req, res) => {
    const url = parseRequestUrl(req.url, req.headers.host);
    const ctx: HttpRequestContext = { req, res, url };
    void (async () => {
      try {
        if (handleHealth(ctx, startedAt)) {
          return;
        }
        if (await pairingRoutes.handle(ctx)) {
          return;
        }
        sendNotFound(res);
      } catch (error) {
        options.logger.error(error instanceof Error ? error : { error }, "unhandled HTTP route error");
        if (!res.headersSent) {
          sendJson(res, 500, { error: "internal_error", message: "internal server error" });
        } else {
          res.end();
        }
      }
    })();
  });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = parseRequestUrl(req.url, req.headers.host);
    const roomId = roomIdFromPath(url.pathname);
    if (roomId === null) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    roomHandler.handleUpgrade(req, socket as Socket, head, roomId);
  });

  return {
    async listen(): Promise<{ address: string; port: number }> {
      await initCrypto();
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          httpServer.off("listening", onListening);
          reject(error);
        };
        const onListening = (): void => {
          httpServer.off("error", onError);
          resolve();
        };
        httpServer.once("error", onError);
        httpServer.once("listening", onListening);
        httpServer.listen(options.port, options.host);
      });
      const address = httpServer.address();
      if (address === null || typeof address === "string") {
        return { address: options.host, port: options.port };
      }
      return { address: address.address, port: address.port };
    },

    async close(): Promise<void> {
      await roomHandler.close();
      pairingStore.close();
      roomStore.clear();
      await closeHttpServer(httpServer);
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
