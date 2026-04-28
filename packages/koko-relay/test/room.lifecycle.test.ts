import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "@koko/protocol";
import { randomPublicKey, startTestRelayServer, waitFor, type TestRelayServer } from "./helpers/testServer";
import { TestWsClient } from "./helpers/wsClient";

let fixture: TestRelayServer | undefined;
let clients: TestWsClient[] = [];

async function start(roomTtlMs = 86_400_000): Promise<TestRelayServer> {
  fixture = await startTestRelayServer({ roomTtlMs });
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

async function connectExpectHelloError(
  relay: TestRelayServer,
  roomId: string,
  role: "cli" | "app",
  error: string
): Promise<void> {
  const client = await TestWsClient.connect(`${relay.wsBaseUrl}/v1/room/${roomId}`);
  clients.push(client);
  client.sendJson({ type: "hello", role, roomId, protocolVersion: PROTOCOL_VERSION });
  expect(await client.receiveJson()).toMatchObject({ type: "hello-error", error });
  await client.waitClosed();
}

afterEach(async () => {
  await Promise.allSettled(clients.map((client) => client.close()));
  clients = [];
  await fixture?.close();
  fixture = undefined;
});

describe("room lifecycle", () => {
  it("rejects hello for unknown rooms and closes the connection", async () => {
    const relay = await start();
    await connectExpectHelloError(relay, crypto.randomUUID(), "cli", "room_not_found");
  });

  it("rejects duplicate role connections for both CLI and APP", async () => {
    const relay = await start();
    const roomId = await pair(relay);
    await connectRole(relay, roomId, "cli");
    await connectExpectHelloError(relay, roomId, "cli", "role_conflict");

    await connectRole(relay, roomId, "app");
    await connectExpectHelloError(relay, roomId, "app", "role_conflict");
  });

  it("rejects connections after room TTL expires", async () => {
    const relay = await start(40);
    const roomId = await pair(relay);
    await delay(60);
    await connectExpectHelloError(relay, roomId, "cli", "room_expired");
  });

  it("keeps an empty room until its TTL expires", async () => {
    const relay = await start(100);
    const roomId = await pair(relay);
    const cli = await connectRole(relay, roomId, "cli");
    const app = await connectRole(relay, roomId, "app");

    await app.close();
    await cli.close();
    await waitFor(() => (relay.server.stats().activeConnections === 0 ? true : null));
    await delay(40);
    expect(relay.server.stats().rooms).toBe(1);

    await waitFor(() => (relay.server.stats().rooms === 0 ? true : null), 300);
    expect(relay.server.stats().rooms).toBe(0);
  });
});
