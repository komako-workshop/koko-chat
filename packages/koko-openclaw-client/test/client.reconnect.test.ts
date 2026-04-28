import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayClient } from "../src";
import { MockWsServer, waitFor } from "./helpers/mockWsServer";

const seed = Uint8Array.from({ length: 32 }, (_value, index) => index + 4);

let server: MockWsServer | undefined;
let client: GatewayClient | undefined;

async function connectClient(options: { maxRetries?: number; reconnectBaseDelayMs?: number; reconnectMaxDelayMs?: number } = {}): Promise<{
  server: MockWsServer;
  client: GatewayClient;
}> {
  server = await MockWsServer.start();
  client = new GatewayClient({
    url: server.url,
    token: "operator-token",
    deviceSeed: seed,
    requestTimeoutMs: 100,
    reconnectBaseDelayMs: options.reconnectBaseDelayMs ?? 10,
    reconnectMaxDelayMs: options.reconnectMaxDelayMs ?? 40,
    maxRetries: options.maxRetries ?? 3
  });
  const connectPromise = client.connect();
  const request = await server.waitForRequest("connect");
  server.sendOk(request.id, { type: "hello-ok" });
  await connectPromise;
  return { server, client };
}

afterEach(async () => {
  await client?.disconnect().catch(() => undefined);
  await server?.close().catch(() => undefined);
  client = undefined;
  server = undefined;
});

describe("GatewayClient reconnect", () => {
  it("reconnects after an unexpected close and repeats the handshake", async () => {
    const fixture = await connectClient();

    fixture.server.terminateLatest();
    const reconnectRequest = await fixture.server.waitForRequest("connect", 800);
    expect(reconnectRequest.id).toBe("pd-1");
    fixture.server.sendOk(reconnectRequest.id, { type: "hello-ok" });

    await waitFor(() => fixture.client.getStatus() === "connected", 300);
    expect(fixture.server.connectionCount).toBeGreaterThanOrEqual(2);
  });

  it("uses exponential delay for consecutive reconnect failures", async () => {
    const fixture = await connectClient({ reconnectBaseDelayMs: 25, reconnectMaxDelayMs: 100, maxRetries: 3 });

    const firstStartedAt = Date.now();
    fixture.server.terminateLatest();
    const firstReconnect = await fixture.server.waitForRequest("connect", 800);
    const firstDelay = Date.now() - firstStartedAt;
    fixture.server.closeLatest(1011, "retry");

    const secondStartedAt = Date.now();
    const secondReconnect = await fixture.server.waitForRequest("connect", 800);
    const secondDelay = Date.now() - secondStartedAt;
    fixture.server.sendOk(secondReconnect.id, { type: "hello-ok" });

    expect(firstReconnect.id).toBe("pd-1");
    expect(secondReconnect.id).toBe("pd-2");
    expect(firstDelay).toBeGreaterThanOrEqual(15);
    expect(secondDelay).toBeGreaterThanOrEqual(35);
  });

  it("sets error after maxRetries is exceeded", async () => {
    const fixture = await connectClient({ maxRetries: 1, reconnectBaseDelayMs: 10 });

    fixture.server.terminateLatest();
    const reconnectRequest = await fixture.server.waitForRequest("connect", 800);
    expect(reconnectRequest.id).toBe("pd-1");
    fixture.server.closeLatest(1011, "retry failed");

    await waitFor(() => fixture.client.getStatus() === "error", 500);
    const connectionCount = fixture.server.connectionCount;
    await delay(40);
    expect(fixture.server.connectionCount).toBe(connectionCount);
  });

  it("does not reconnect after disconnect", async () => {
    const fixture = await connectClient({ reconnectBaseDelayMs: 10 });
    await fixture.client.disconnect();
    const connectionCount = fixture.server.connectionCount;

    await delay(40);
    expect(fixture.client.getStatus()).toBe("disconnected");
    expect(fixture.server.connectionCount).toBe(connectionCount);
  });

  it("does not reconnect after a fatal 4xxx close", async () => {
    const fixture = await connectClient({ reconnectBaseDelayMs: 10 });

    fixture.server.closeLatest(4001, "fatal");
    await waitFor(() => fixture.client.getStatus() === "error", 300);
    const connectionCount = fixture.server.connectionCount;
    await delay(40);
    expect(fixture.server.connectionCount).toBe(connectionCount);
  });
});
