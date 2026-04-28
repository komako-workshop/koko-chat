import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createLogger } from "../../src/logger";
import { createRelayServer, type RelayServer, type RelayServerOptions } from "../../src/server";

/** HTTP JSON response returned by test helpers. */
export interface JsonResponse {
  /** HTTP status code. */
  status: number;
  /** Parsed JSON response body. */
  body: unknown;
}

/** Started relay server fixture. */
export interface TestRelayServer {
  /** Relay server instance. */
  server: RelayServer;
  /** Base HTTP URL. */
  baseUrl: string;
  /** Base WebSocket URL. */
  wsBaseUrl: string;
  /** Sends a JSON HTTP request to the relay. */
  requestJson(method: string, path: string, body?: unknown): Promise<JsonResponse>;
  /** Closes the relay fixture. */
  close(): Promise<void>;
}

/** Generates a base64url public key with the required 32 byte length. */
export function randomPublicKey(): string {
  return randomBytes(32).toString("base64url");
}

/** Waits until a condition returns a non-nullish value. */
export async function waitFor<T>(fn: () => T | null | undefined, timeoutMs = 500): Promise<T> {
  const startedAt = Date.now();
  for (;;) {
    const value = fn();
    if (value !== null && value !== undefined) {
      return value;
    }
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await delay(5);
  }
}

/** Starts a relay server on a random localhost port. */
export async function startTestRelayServer(
  overrides: Partial<Omit<RelayServerOptions, "logger" | "host" | "port">> = {}
): Promise<TestRelayServer> {
  const server = createRelayServer({
    port: 0,
    host: "127.0.0.1",
    logger: createLogger({ level: "error", enabled: false }),
    pairingTtlMs: 300_000,
    roomTtlMs: 86_400_000,
    roomOfflineQueueMax: 1_000,
    roomOfflineQueueTtlMs: 86_400_000,
    ...overrides
  });
  const address = await server.listen();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const wsBaseUrl = `ws://127.0.0.1:${address.port}`;

  return {
    server,
    baseUrl,
    wsBaseUrl,
    async requestJson(method: string, path: string, body?: unknown): Promise<JsonResponse> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 500);
      try {
        const requestInit: RequestInit = {
          method,
          headers: {
            "content-type": "application/json"
          },
          signal: controller.signal
        };
        if (body !== undefined) {
          requestInit.body = JSON.stringify(body);
        }
        const response = await fetch(`${baseUrl}${path}`, requestInit);
        return {
          status: response.status,
          body: await response.json()
        };
      } finally {
        clearTimeout(timeout);
      }
    },
    async close(): Promise<void> {
      await server.close();
    }
  };
}
