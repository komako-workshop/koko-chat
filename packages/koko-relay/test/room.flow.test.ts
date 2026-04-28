import { afterEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type Envelope } from "@koko/protocol";
import { randomPublicKey, startTestRelayServer, type TestRelayServer } from "./helpers/testServer";
import { TestWsClient } from "./helpers/wsClient";

let fixture: TestRelayServer | undefined;
let clients: TestWsClient[] = [];

async function start(): Promise<TestRelayServer> {
  fixture = await startTestRelayServer();
  return fixture;
}

async function pair(relay: TestRelayServer): Promise<string> {
  const publicKey = randomPublicKey();
  await relay.requestJson("POST", "/v1/pair/request", { publicKey, supportsProtocol: PROTOCOL_VERSION });
  const response = await relay.requestJson("POST", "/v1/pair/response", {
    publicKey,
    response: "encrypted-bundle"
  });
  expect(response.status).toBe(200);
  return (response.body as { roomId: string }).roomId;
}

async function connectRole(relay: TestRelayServer, roomId: string, role: "cli" | "app"): Promise<TestWsClient> {
  const client = await TestWsClient.connect(`${relay.wsBaseUrl}/v1/room/${roomId}`);
  clients.push(client);
  client.sendJson({ type: "hello", role, roomId, protocolVersion: PROTOCOL_VERSION });
  expect(await client.receiveJson()).toEqual({ type: "hello-ok", roomId });
  return client;
}

function envelope(roomId: string, seq: number, from: string): Envelope {
  return {
    v: PROTOCOL_VERSION,
    type: "chat.test",
    roomId,
    seq,
    ts: 1_700_000_000_000 + seq,
    payload: { from, seq },
    encrypted: true
  };
}

afterEach(async () => {
  await Promise.allSettled(clients.map((client) => client.close()));
  clients = [];
  await fixture?.close();
  fixture = undefined;
});

describe("room flow", () => {
  it("forwards envelopes between CLI and APP", async () => {
    const relay = await start();
    const roomId = await pair(relay);
    const cli = await connectRole(relay, roomId, "cli");
    const app = await connectRole(relay, roomId, "app");
    expect(await cli.receiveJson()).toEqual({ type: "peer-joined", role: "app" });

    const cliEnvelope = envelope(roomId, 1, "cli");
    cli.sendJson({ type: "envelope", envelope: cliEnvelope });
    expect(JSON.stringify(await app.receiveJson())).toBe(JSON.stringify({ type: "envelope", envelope: cliEnvelope }));

    const appEnvelope = envelope(roomId, 2, "app");
    app.sendJson({ type: "envelope", envelope: appEnvelope });
    expect(JSON.stringify(await cli.receiveJson())).toBe(JSON.stringify({ type: "envelope", envelope: appEnvelope }));
  });

  it("ignores invalid JSON messages without closing the connection", async () => {
    const relay = await start();
    const roomId = await pair(relay);
    const cli = await connectRole(relay, roomId, "cli");

    cli.sendText("{");
    await expect(cli.receiveJson(50)).rejects.toThrow("receive timed out");
    expect(relay.server.stats().activeConnections).toBe(1);
  });

  it("returns envelope-error for room mismatches and keeps the connection open", async () => {
    const relay = await start();
    const roomId = await pair(relay);
    const cli = await connectRole(relay, roomId, "cli");

    cli.sendJson({ type: "envelope", envelope: envelope("other-room", 1, "cli") });
    expect(await cli.receiveJson()).toEqual({ type: "envelope-error", reason: "room_mismatch" });
    expect(relay.server.stats().activeConnections).toBe(1);
  });
});
