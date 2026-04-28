import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  boxEncryptToPublicKey,
  decodePairingQrUrl,
  generateEphemeralBoxKeypair,
  initCrypto
} from "@koko/protocol";
import { createRelayServer, type RelayServer } from "@koko/relay";
import { createLogger } from "../src/logger";
import { runPairingFlow } from "../src/pairing";

interface TestRelay {
  server: RelayServer;
  baseUrl: string;
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
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

async function postJson(baseUrl: string, path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}${path}`, {
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

describe("pairing flow", () => {
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

  it("runs complete pairing against a real relay instance", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const relay = await startRelay();
    relays.push(relay.server);
    const logger = createLogger({ level: "error", enabled: false });
    let resolvePairingUrl: (url: string) => void = () => undefined;
    const pairingUrl = new Promise<string>((resolve) => {
      resolvePairingUrl = resolve;
    });
    const appBoxKeypair = generateEphemeralBoxKeypair();

    const cliPairing = runPairingFlow({
      relayUrl: relay.baseUrl,
      logger,
      pollIntervalMs: 10,
      maxWaitMs: 2_000,
      onPairingUrl: resolvePairingUrl,
      renderQr: false
    });

    const appPairing = (async (): Promise<void> => {
      const qrUrl = await pairingUrl;
      await delay(10);
      const decodedQr = decodePairingQrUrl(qrUrl);
      const responseBundle = boxEncryptToPublicKey(appBoxKeypair.publicKey, decodedQr.publicKey);
      const response = await postJson(relay.baseUrl, "/v1/pair/response", {
        publicKey: Buffer.from(decodedQr.publicKey).toString("base64url"),
        response: Buffer.from(responseBundle).toString("base64")
      });
      expect(response.status).toBe(200);
    })();

    const result = await cliPairing;
    await appPairing;
    expect(result.roomId).toEqual(expect.any(String));
    expect(result.cliEphSecretKey.byteLength).toBe(32);
    expect(Buffer.from(result.appBoxPublicKey).equals(Buffer.from(appBoxKeypair.publicKey))).toBe(true);
  });

  it("times out if APP never authorizes", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const relay = await startRelay();
    relays.push(relay.server);

    await expect(runPairingFlow({
      relayUrl: relay.baseUrl,
      logger: createLogger({ level: "error", enabled: false }),
      pollIntervalMs: 10,
      maxWaitMs: 80,
      renderQr: false
    })).rejects.toThrow(/timed out/);
  });

  it("rejects with AbortError when the signal is aborted", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const relay = await startRelay();
    relays.push(relay.server);
    const controller = new AbortController();
    const run = runPairingFlow({
      relayUrl: relay.baseUrl,
      logger: createLogger({ level: "error", enabled: false }),
      pollIntervalMs: 50,
      maxWaitMs: 5_000,
      signal: controller.signal,
      renderQr: false
    });

    await delay(20);
    controller.abort();
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
  });
});
