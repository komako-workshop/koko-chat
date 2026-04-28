import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayClient, type Logger } from "../src";
import { MockWsServer } from "./helpers/mockWsServer";

const seed = Uint8Array.from({ length: 32 }, (_value, index) => index + 3);

let server: MockWsServer | undefined;
let client: GatewayClient | undefined;

function testLogger(): Logger {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
}

async function connectClient(logger?: Logger): Promise<{ server: MockWsServer; client: GatewayClient }> {
  server = await MockWsServer.start();
  client = new GatewayClient({
    url: server.url,
    token: "operator-token",
    deviceSeed: seed,
    requestTimeoutMs: 100,
    ...(logger === undefined ? {} : { logger })
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

describe("GatewayClient events", () => {
  it("delivers event payloads to subscribers", async () => {
    const fixture = await connectClient();
    const payloadPromise = new Promise<Record<string, unknown>>((resolve) => {
      fixture.client.on("chat", resolve);
    });

    fixture.server.sendEvent("chat", { delta: "hi" });
    await expect(payloadPromise).resolves.toEqual({ delta: "hi" });
  });

  it("delivers to multiple subscribers and supports unsubscribe", async () => {
    const fixture = await connectClient();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = fixture.client.on("chat", first);
    fixture.client.on("chat", second);

    fixture.server.sendEvent("chat", { delta: "one" });
    await vi.waitFor(() => expect(first).toHaveBeenCalledWith({ delta: "one" }));
    expect(second).toHaveBeenCalledWith({ delta: "one" });

    unsubscribe();
    fixture.server.sendEvent("chat", { delta: "two" });
    await vi.waitFor(() => expect(second).toHaveBeenCalledWith({ delta: "two" }));
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("logs subscriber errors without blocking other subscribers", async () => {
    const logger = testLogger();
    const fixture = await connectClient(logger);
    const second = vi.fn();
    fixture.client.on("chat", () => {
      throw new Error("subscriber failed");
    });
    fixture.client.on("chat", second);

    fixture.server.sendEvent("chat", { delta: "hi" });
    await vi.waitFor(() => expect(second).toHaveBeenCalledWith({ delta: "hi" }));
    expect(logger.error).toHaveBeenCalled();
  });

  it("does not dispatch connect.challenge to consumer subscriptions", async () => {
    server = await MockWsServer.start({ challengeNonce: "nonce-private" });
    const callback = vi.fn();
    client = new GatewayClient({ url: server.url, token: "operator-token", deviceSeed: seed, requestTimeoutMs: 100 });
    client.on("connect.challenge", callback);

    const connectPromise = client.connect();
    const request = await server.waitForRequest("connect");
    server.sendOk(request.id, { type: "hello-ok" });
    await connectPromise;

    expect(callback).not.toHaveBeenCalled();
  });
});
