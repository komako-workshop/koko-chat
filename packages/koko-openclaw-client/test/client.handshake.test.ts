import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayClient, HandshakeFailedError, HandshakeTimeoutError, FatalCloseError, type DeviceIdentity } from "../src";
import { MockWsServer, waitFor } from "./helpers/mockWsServer";

const seed = Uint8Array.from({ length: 32 }, (_value, index) => index + 1);

let server: MockWsServer | undefined;
let client: GatewayClient | undefined;

afterEach(async () => {
  await client?.disconnect().catch(() => undefined);
  await server?.close().catch(() => undefined);
  client = undefined;
  server = undefined;
});

describe("GatewayClient handshake", () => {
  it("responds to connect.challenge and resolves after hello-ok", async () => {
    server = await MockWsServer.start({ challengeNonce: "nonce-1" });
    const onDeviceToken = vi.fn();
    client = new GatewayClient({
      url: server.url,
      token: "operator-token",
      deviceSeed: seed,
      requestTimeoutMs: 100,
      onDeviceToken
    });

    const connectPromise = client.connect();
    const request = await server.waitForRequest("connect");
    const params = request.params ?? {};
    const device = params.device as DeviceIdentity;

    expect(request.id).toBe("pd-0");
    expect(params.auth).toEqual({ token: "operator-token" });
    expect(device.nonce).toBe("nonce-1");
    expect(device.id).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof device.publicKey).toBe("string");
    expect(typeof device.signature).toBe("string");

    server.sendOk(request.id, {
      type: "hello-ok",
      auth: { deviceToken: "device-token-1" },
      snapshot: { policy: { maxPayload: 65536 } }
    });
    await expect(connectPromise).resolves.toBeUndefined();
    expect(client.getStatus()).toBe("connected");
    expect(client.getMaxPayload()).toBe(65536);
    expect(onDeviceToken).toHaveBeenCalledWith("device-token-1");
  });

  it("rejects non hello-ok handshake responses", async () => {
    server = await MockWsServer.start();
    client = new GatewayClient({ url: server.url, token: "operator-token", deviceSeed: seed, requestTimeoutMs: 100 });

    const connectPromise = client.connect();
    const request = await server.waitForRequest("connect");
    server.sendOk(request.id, { type: "not-hello-ok" });

    await expect(connectPromise).rejects.toBeInstanceOf(HandshakeFailedError);
  });

  it("rejects when the connect response times out", async () => {
    server = await MockWsServer.start();
    client = new GatewayClient({ url: server.url, token: "operator-token", deviceSeed: seed, requestTimeoutMs: 30 });

    const connectPromise = client.connect();
    await server.waitForRequest("connect");

    await expect(connectPromise).rejects.toBeInstanceOf(HandshakeTimeoutError);
  });

  it("treats policy violation close as fatal and does not reconnect", async () => {
    server = await MockWsServer.start({
      autoChallenge: false,
      onConnection(socket) {
        socket.close(1008, "policy");
      }
    });
    client = new GatewayClient({
      url: server.url,
      token: "operator-token",
      deviceSeed: seed,
      requestTimeoutMs: 100,
      reconnectBaseDelayMs: 10
    });

    await expect(client.connect()).rejects.toBeInstanceOf(FatalCloseError);
    await waitFor(() => client?.getStatus() === "error", 200);
    expect(server.connectionCount).toBe(1);
  });
});
