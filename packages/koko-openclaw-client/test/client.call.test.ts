import { afterEach, describe, expect, it } from "vitest";
import { GatewayClient, GatewayError, NotConnectedError, RequestTimeoutError } from "../src";
import { MockWsServer } from "./helpers/mockWsServer";

const seed = Uint8Array.from({ length: 32 }, (_value, index) => index + 2);

let server: MockWsServer | undefined;
let client: GatewayClient | undefined;

async function connectClient(): Promise<{ server: MockWsServer; client: GatewayClient }> {
  server = await MockWsServer.start();
  client = new GatewayClient({ url: server.url, token: "operator-token", deviceSeed: seed, requestTimeoutMs: 100 });
  const connectPromise = client.connect();
  const request = await server.waitForRequest("connect");
  server.sendOk(request.id, { type: "hello-ok", snapshot: { policy: { maxPayload: 1024 } } });
  await connectPromise;
  return { server, client };
}

afterEach(async () => {
  await client?.disconnect().catch(() => undefined);
  await server?.close().catch(() => undefined);
  client = undefined;
  server = undefined;
});

describe("GatewayClient.call", () => {
  it("routes an ok response by request id", async () => {
    const fixture = await connectClient();
    const promise = fixture.client.call("foo", { x: 1 });
    const request = await fixture.server.waitForRequest("foo");

    expect(request).toMatchObject({ id: "pd-1", method: "foo", params: { x: 1 } });
    fixture.server.sendOk(request.id, { y: 2 });
    await expect(promise).resolves.toEqual({ y: 2 });
  });

  it("keeps simultaneous calls independent", async () => {
    const fixture = await connectClient();
    const first = fixture.client.call("first", { n: 1 });
    const second = fixture.client.call("second", { n: 2 });
    const firstRequest = await fixture.server.waitForRequest("first");
    const secondRequest = await fixture.server.waitForRequest("second");

    expect(firstRequest.id).not.toBe(secondRequest.id);
    fixture.server.sendOk(secondRequest.id, { second: true });
    fixture.server.sendOk(firstRequest.id, { first: true });
    await expect(second).resolves.toEqual({ second: true });
    await expect(first).resolves.toEqual({ first: true });
  });

  it("rejects Gateway error responses", async () => {
    const fixture = await connectClient();
    const promise = fixture.client.call("foo");
    const request = await fixture.server.waitForRequest("foo");

    fixture.server.sendError(request.id, "BAD_REQUEST", "bad request");
    await expect(promise).rejects.toMatchObject({ code: "BAD_REQUEST", message: "bad request" } satisfies Partial<GatewayError>);
  });

  it("rejects calls before connection", async () => {
    const disconnected = new GatewayClient({ url: "ws://127.0.0.1:1", token: "operator-token", requestTimeoutMs: 10 });

    await expect(disconnected.call("foo")).rejects.toBeInstanceOf(NotConnectedError);
  });

  it("times out unanswered requests and clears the pending entry", async () => {
    const fixture = await connectClient();
    const promise = fixture.client.call("foo");
    await fixture.server.waitForRequest("foo");

    await expect(promise).rejects.toBeInstanceOf(RequestTimeoutError);

    const next = fixture.client.call("bar");
    const nextRequest = await fixture.server.waitForRequest("bar");
    fixture.server.sendOk(nextRequest.id, { ok: true });
    await expect(next).resolves.toEqual({ ok: true });
  });
});
