import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket, type RawData } from "ws";
import {
  boxEncryptToPublicKey,
  decodeEnvelope,
  decodePairingQrUrl,
  generateEphemeralBoxKeypair,
  initCrypto,
  symmetricDecrypt,
  symmetricEncrypt,
  PROTOCOL_VERSION,
  type Envelope
} from "@koko/protocol";
import { createRelayServer, type RelayServer } from "@koko/relay";
import type { CliConfig } from "../src/config";
import { createLogger } from "../src/logger";
import { PLACEHOLDER_SESSION_KEY, runStart } from "../src/start";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

interface TestRelay {
  server: RelayServer;
  baseUrl: string;
  wsBaseUrl: string;
}

async function startRelay(): Promise<TestRelay> {
  const server = createRelayServer({
    port: 0,
    host: "127.0.0.1",
    logger: createLogger({ level: "error", enabled: false }),
    pairingTtlMs: 300_000,
    roomTtlMs: 86_400_000,
    roomOfflineQueueMax: 1_000,
    roomOfflineQueueTtlMs: 86_400_000
  });
  const address = await server.listen();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    wsBaseUrl: `ws://127.0.0.1:${address.port}`
  };
}

async function postJson(baseUrl: string, pathName: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  return {
    status: response.status,
    body: await response.json()
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("expected object");
  }
  return value as Record<string, unknown>;
}

function rawDataToText(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  return data.toString("utf8");
}

function openWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const websocket = new WebSocket(url);
    const timer = setTimeout(() => {
      websocket.terminate();
      reject(new Error("websocket open timed out"));
    }, 1_000);
    websocket.once("open", () => {
      clearTimeout(timer);
      resolve(websocket);
    });
    websocket.once("error", (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function waitForMessage(
  websocket: WebSocket,
  predicate: (message: Record<string, unknown>) => boolean,
  timeoutMs = 2_000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      websocket.off("message", onMessage);
      reject(new Error("waitForMessage timed out"));
    }, timeoutMs);
    const onMessage = (data: RawData, isBinary: boolean): void => {
      if (isBinary) {
        return;
      }
      try {
        const parsed = asRecord(JSON.parse(rawDataToText(data)) as unknown);
        if (predicate(parsed)) {
          clearTimeout(timer);
          websocket.off("message", onMessage);
          resolve(parsed);
        }
      } catch {
        // Ignore malformed messages while waiting for a specific relay event.
      }
    };
    websocket.on("message", onMessage);
  });
}

function base64Encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function base64Decode(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "base64"));
}

function encryptedUserEnvelope(roomId: string, text: string): Envelope {
  return {
    v: PROTOCOL_VERSION,
    type: "chat.user",
    roomId,
    seq: 1,
    ts: Date.now(),
    payload: base64Encode(symmetricEncrypt(textEncoder.encode(text), PLACEHOLDER_SESSION_KEY)),
    encrypted: true
  };
}

async function simulateApp(relay: TestRelay, pairingUrlPromise: Promise<string>): Promise<string> {
  const qrUrl = await pairingUrlPromise;
  const decodedQr = decodePairingQrUrl(qrUrl);
  const appBoxKeypair = generateEphemeralBoxKeypair();
  const responseBundle = boxEncryptToPublicKey(appBoxKeypair.publicKey, decodedQr.publicKey);
  const pairResponse = await postJson(relay.baseUrl, "/v1/pair/response", {
    publicKey: Buffer.from(decodedQr.publicKey).toString("base64url"),
    response: Buffer.from(responseBundle).toString("base64")
  });
  expect(pairResponse.status).toBe(200);
  const roomId = asRecord(pairResponse.body).roomId;
  if (typeof roomId !== "string") {
    throw new Error("pair response missing roomId");
  }

  const appWs = await openWs(`${relay.wsBaseUrl}/v1/room/${roomId}`);
  try {
    appWs.send(JSON.stringify({ type: "hello", role: "app", roomId, protocolVersion: PROTOCOL_VERSION }));
    const hello = await waitForMessage(appWs, (message) => message.type === "hello-ok" || message.type === "hello-error");
    expect(hello.type).toBe("hello-ok");

    await waitForMessage(appWs, (message) => message.type === "peer-joined" && message.role === "cli");

    const userMessage = "Hello from APP! 你好 OpenClaw 🦞";
    appWs.send(JSON.stringify({ type: "envelope", envelope: encryptedUserEnvelope(roomId, userMessage) }));
    const echoMessage = await waitForMessage(appWs, (message) => message.type === "envelope");
    const envelope = decodeEnvelope(JSON.stringify(echoMessage.envelope));
    if (typeof envelope.payload !== "string") {
      throw new Error("echo payload must be string");
    }
    const decrypted = symmetricDecrypt(base64Decode(envelope.payload), PLACEHOLDER_SESSION_KEY);
    return textDecoder.decode(decrypted);
  } finally {
    appWs.close(1000);
  }
}

describe("start integration", () => {
  const relays: RelayServer[] = [];

  beforeAll(async () => {
    await initCrypto();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    while (relays.length > 0) {
      const relay = relays.pop();
      if (relay !== undefined) {
        await relay.close();
      }
    }
  });

  it("starts, pairs, echoes one encrypted APP message, and shuts down on abort", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const relay = await startRelay();
    relays.push(relay.server);
    const keyDir = await mkdtemp(path.join(os.tmpdir(), "koko-cli-start-"));
    const config: CliConfig = {
      relayUrl: relay.baseUrl,
      relayWsUrl: relay.wsBaseUrl,
      deviceKeyPath: path.join(keyDir, "device.key"),
      logLevel: "error",
      pairingPollIntervalMs: 10,
      pairingMaxWaitMs: 2_000
    };
    const controller = new AbortController();
    let resolvePairingUrl: (url: string) => void = () => undefined;
    const pairingUrlPromise = new Promise<string>((resolve) => {
      resolvePairingUrl = resolve;
    });

    const startPromise = runStart({
      config,
      logger: createLogger({ level: "error", enabled: false }),
      signal: controller.signal,
      onPairingUrl: resolvePairingUrl,
      renderQr: false
    });
    const echoed = await simulateApp(relay, pairingUrlPromise);
    expect(echoed).toBe("ECHO: Hello from APP! 你好 OpenClaw 🦞");

    controller.abort();
    await Promise.race([
      startPromise,
      delay(500).then(() => {
        throw new Error("runStart did not stop within 500ms");
      })
    ]);
  });
});
