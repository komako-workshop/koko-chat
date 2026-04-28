import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { randomPublicKey, startTestRelayServer, type TestRelayServer } from "./helpers/testServer";

let fixture: TestRelayServer | undefined;

async function start(pairingTtlMs = 300_000): Promise<TestRelayServer> {
  fixture = await startTestRelayServer({ pairingTtlMs });
  return fixture;
}

afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

describe("pairing errors", () => {
  it("rejects invalid public keys", async () => {
    const relay = await start();
    const response = await relay.requestJson("POST", "/v1/pair/request", {
      publicKey: "not base64url!",
      supportsProtocol: 1
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "invalid_public_key" });
  });

  it("rejects unsupported protocol versions", async () => {
    const relay = await start();
    const response = await relay.requestJson("POST", "/v1/pair/request", {
      publicKey: randomPublicKey(),
      supportsProtocol: 999
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "unsupported_protocol" });
  });

  it("returns 404 when the app responds to a missing request", async () => {
    const relay = await start();
    const response = await relay.requestJson("POST", "/v1/pair/response", {
      publicKey: randomPublicKey(),
      response: "encrypted-bundle"
    });
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "request_not_found" });
  });

  it("returns 409 when a request is already authorized", async () => {
    const relay = await start();
    const publicKey = randomPublicKey();
    await relay.requestJson("POST", "/v1/pair/request", { publicKey, supportsProtocol: 1 });
    const first = await relay.requestJson("POST", "/v1/pair/response", {
      publicKey,
      response: "encrypted-bundle"
    });
    expect(first.status).toBe(200);

    const second = await relay.requestJson("POST", "/v1/pair/response", {
      publicKey,
      response: "encrypted-bundle-2"
    });
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ error: "already_authorized" });
  });

  it("treats an expired pairing request as gone and creates a new pending request", async () => {
    const relay = await start(20);
    const publicKey = randomPublicKey();
    await relay.requestJson("POST", "/v1/pair/request", { publicKey, supportsProtocol: 1 });
    await delay(35);

    const oldResponse = await relay.requestJson("POST", "/v1/pair/response", {
      publicKey,
      response: "encrypted-bundle"
    });
    expect(oldResponse.status).toBe(404);

    const newRequest = await relay.requestJson("POST", "/v1/pair/request", {
      publicKey,
      supportsProtocol: 1
    });
    expect(newRequest.status).toBe(200);
    expect(newRequest.body).toMatchObject({ state: "pending" });
  });
});
