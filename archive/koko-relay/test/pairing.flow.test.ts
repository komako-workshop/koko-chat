import { afterEach, describe, expect, it } from "vitest";
import { randomPublicKey, startTestRelayServer, type TestRelayServer } from "./helpers/testServer";

let fixture: TestRelayServer | undefined;

async function start(): Promise<TestRelayServer> {
  fixture = await startTestRelayServer();
  return fixture;
}

afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

describe("pairing flow", () => {
  it("runs the CLI request and APP response flow end to end", async () => {
    const relay = await start();
    const publicKey = randomPublicKey();
    const response = "encrypted-bundle";

    const first = await relay.requestJson("POST", "/v1/pair/request", {
      publicKey,
      supportsProtocol: 1
    });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ state: "pending" });

    const second = await relay.requestJson("POST", "/v1/pair/request", {
      publicKey,
      supportsProtocol: 1
    });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ state: "pending" });

    const appResponse = await relay.requestJson("POST", "/v1/pair/response", {
      publicKey,
      response
    });
    expect(appResponse.status).toBe(200);
    expect(appResponse.body).toMatchObject({ roomId: expect.any(String) });
    const roomId = (appResponse.body as { roomId: string }).roomId;

    const authorized = await relay.requestJson("POST", "/v1/pair/request", {
      publicKey,
      supportsProtocol: 1
    });
    expect(authorized.status).toBe(200);
    expect(authorized.body).toEqual({
      state: "authorized",
      roomId,
      response,
      ttlMs: expect.any(Number)
    });

    const deleted = await relay.requestJson("DELETE", "/v1/pair/request", { publicKey });
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ ok: true });
    expect(relay.server.stats().pairingRequests).toBe(0);
  });
});
