import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type Envelope } from "@koko/protocol";
import { randomPublicKey, startTestRelayServer, type TestRelayServer } from "./helpers/testServer";
import { TestWsClient } from "./helpers/wsClient";

let fixture: TestRelayServer | undefined;
let clients: TestWsClient[] = [];

async function start(options: { max?: number; ttlMs?: number } = {}): Promise<TestRelayServer> {
  fixture = await startTestRelayServer({
    roomOfflineQueueMax: options.max ?? 1_000,
    roomOfflineQueueTtlMs: options.ttlMs ?? 86_400_000
  });
  return fixture;
}

async function pair(relay: TestRelayServer): Promise<string> {
  const publicKey = randomPublicKey();
  await relay.requestJson("POST", "/v1/pair/request", { publicKey, supportsProtocol: PROTOCOL_VERSION });
  const response = await relay.requestJson("POST", "/v1/pair/response", {
    publicKey,
    response: "encrypted-bundle"
  });
  return (response.body as { roomId: string }).roomId;
}

async function connectRole(relay: TestRelayServer, roomId: string, role: "cli" | "app"): Promise<TestWsClient> {
  const client = await TestWsClient.connect(`${relay.wsBaseUrl}/v1/room/${roomId}`);
  clients.push(client);
  client.sendJson({ type: "hello", role, roomId, protocolVersion: PROTOCOL_VERSION });
  expect(await client.receiveJson()).toEqual({ type: "hello-ok", roomId });
  return client;
}

function envelope(roomId: string, seq: number): Envelope {
  return {
    v: PROTOCOL_VERSION,
    type: "chat.test",
    roomId,
    seq,
    ts: 1_700_000_000_000 + seq,
    payload: `message-${seq}`,
    encrypted: true
  };
}

afterEach(async () => {
  await Promise.allSettled(clients.map((client) => client.close()));
  clients = [];
  await fixture?.close();
  fixture = undefined;
});

describe("room offline queue", () => {
  it("delivers queued envelopes to a later APP connection in seq order", async () => {
    const relay = await start();
    const roomId = await pair(relay);
    const cli = await connectRole(relay, roomId, "cli");

    for (const seq of [3, 1, 2]) {
      cli.sendJson({ type: "envelope", envelope: envelope(roomId, seq) });
    }

    const app = await connectRole(relay, roomId, "app");
    expect(await app.receiveJson()).toEqual({ type: "envelope", envelope: envelope(roomId, 1) });
    expect(await app.receiveJson()).toEqual({ type: "envelope", envelope: envelope(roomId, 2) });
    expect(await app.receiveJson()).toEqual({ type: "envelope", envelope: envelope(roomId, 3) });
  });

  it("drops the oldest queued envelopes when max length is exceeded", async () => {
    const relay = await start({ max: 3 });
    const roomId = await pair(relay);
    const cli = await connectRole(relay, roomId, "cli");

    for (const seq of [1, 2, 3, 4, 5]) {
      cli.sendJson({ type: "envelope", envelope: envelope(roomId, seq) });
    }

    const app = await connectRole(relay, roomId, "app");
    expect(await app.receiveJson()).toEqual({ type: "envelope", envelope: envelope(roomId, 3) });
    expect(await app.receiveJson()).toEqual({ type: "envelope", envelope: envelope(roomId, 4) });
    expect(await app.receiveJson()).toEqual({ type: "envelope", envelope: envelope(roomId, 5) });
    await expect(app.receiveJson(50)).rejects.toThrow("receive timed out");
  });

  it("expires queued envelopes by queue TTL", async () => {
    const relay = await start({ ttlMs: 50 });
    const roomId = await pair(relay);
    const cli = await connectRole(relay, roomId, "cli");
    cli.sendJson({ type: "envelope", envelope: envelope(roomId, 1) });
    await delay(70);

    const app = await connectRole(relay, roomId, "app");
    await expect(app.receiveJson(50)).rejects.toThrow("receive timed out");
  });
});
