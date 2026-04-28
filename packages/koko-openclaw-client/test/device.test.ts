import { Buffer } from "node:buffer";
import { getPublicKeyAsync, verifyAsync } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha2";
import { describe, expect, it } from "vitest";
import { buildSignaturePayload, deriveDeviceIdentity, signDevicePayload } from "../src/device";

const seed = Uint8Array.from({ length: 32 }, (_value, index) => index);

describe("device identity", () => {
  it("derives a deterministic public key and device id from a seed", async () => {
    const actual = await deriveDeviceIdentity(seed);
    const publicKeyBytes = await getPublicKeyAsync(seed);
    const expectedDeviceId = Array.from(sha256(publicKeyBytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

    expect(actual.publicKey).toBe(Buffer.from(publicKeyBytes).toString("base64url"));
    expect(actual.deviceId).toBe(expectedDeviceId);
    expect(actual.deviceId).toMatch(/^[0-9a-f]{64}$/);
  });

  it("signs payload strings deterministically", async () => {
    const payload = "v2|device|client|cli|operator|operator.read|1700000000000|token|nonce";
    const signatureA = await signDevicePayload(seed, payload);
    const signatureB = await signDevicePayload(seed, payload);
    const publicKey = await getPublicKeyAsync(seed);

    expect(signatureA).toBe(signatureB);
    await expect(
      verifyAsync(Buffer.from(signatureA, "base64url"), new TextEncoder().encode(payload), publicKey)
    ).resolves.toBe(true);
  });

  it("builds the canonical v2 signature payload", () => {
    expect(
      buildSignaturePayload({
        deviceId: "device-id",
        clientId: "koko-cli",
        clientMode: "cli",
        role: "operator",
        scopes: ["operator.read", "operator.write"],
        signedAtMs: 1_700_000_000_000,
        token: "operator-token",
        nonce: "nonce-1"
      })
    ).toBe("v2|device-id|koko-cli|cli|operator|operator.read,operator.write|1700000000000|operator-token|nonce-1");
  });

  it("keeps empty scopes and null token as empty payload slots", () => {
    expect(
      buildSignaturePayload({
        deviceId: "device-id",
        clientId: "koko-cli",
        clientMode: "cli",
        role: "operator",
        scopes: [],
        signedAtMs: 1,
        token: null,
        nonce: "nonce-1"
      })
    ).toBe("v2|device-id|koko-cli|cli|operator||1||nonce-1");
  });
});
