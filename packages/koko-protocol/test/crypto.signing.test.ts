import { beforeAll, describe, expect, it } from "vitest";
import {
  generateChallenge,
  initCrypto,
  signChallenge,
  signingKeypairFromSeed,
  verifyChallenge
} from "../src/crypto";

describe("signing", () => {
  beforeAll(async () => {
    await initCrypto();
  });

  it("verifies a signature for the same challenge and seed-derived keypair", () => {
    const kp = signingKeypairFromSeed(Uint8Array.from({ length: 32 }, (_, index) => index));
    const challenge = generateChallenge();
    const signature = signChallenge(challenge, kp);

    expect(verifyChallenge(challenge, signature, kp.publicKey)).toBe(true);
  });

  it("returns different public keys for different seeds", () => {
    const first = signingKeypairFromSeed(Uint8Array.from({ length: 32 }, (_, index) => index));
    const second = signingKeypairFromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 1));

    expect(first.publicKey).not.toEqual(second.publicKey);
  });

  it("returns false when the challenge is changed", () => {
    const kp = signingKeypairFromSeed(Uint8Array.from({ length: 32 }, (_, index) => index));
    const challenge = generateChallenge();
    const changedChallenge = new Uint8Array(challenge);
    changedChallenge[0] = (changedChallenge[0] ?? 0) ^ 1;
    const signature = signChallenge(challenge, kp);

    expect(verifyChallenge(changedChallenge, signature, kp.publicKey)).toBe(false);
  });

  it("returns false when the signature is changed", () => {
    const kp = signingKeypairFromSeed(Uint8Array.from({ length: 32 }, (_, index) => index));
    const challenge = generateChallenge();
    const signature = signChallenge(challenge, kp);
    const changedSignature = new Uint8Array(signature);
    changedSignature[0] = (changedSignature[0] ?? 0) ^ 1;

    expect(verifyChallenge(challenge, changedSignature, kp.publicKey)).toBe(false);
  });

  it("returns false when the public key is changed", () => {
    const kp = signingKeypairFromSeed(Uint8Array.from({ length: 32 }, (_, index) => index));
    const other = signingKeypairFromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
    const challenge = generateChallenge();
    const signature = signChallenge(challenge, kp);

    expect(verifyChallenge(challenge, signature, other.publicKey)).toBe(false);
  });
});
