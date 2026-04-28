import { beforeAll, describe, expect, it } from "vitest";
import {
  boxDecryptWithSecretKey,
  boxEncryptToPublicKey,
  boxKeypairFromSeed,
  initCrypto
} from "../src/crypto";

describe("box", () => {
  beforeAll(async () => {
    await initCrypto();
  });

  it("round-trips from a recipient public key to the matching secret key", () => {
    const recipient = boxKeypairFromSeed(Uint8Array.from({ length: 32 }, (_, index) => index));
    const plaintext = new TextEncoder().encode("hello koko");
    const bundle = boxEncryptToPublicKey(plaintext, recipient.publicKey);

    expect(boxDecryptWithSecretKey(bundle, recipient.secretKey)).toEqual(plaintext);
  });

  it("throws when decrypting with the wrong secret key", () => {
    const recipient = boxKeypairFromSeed(Uint8Array.from({ length: 32 }, (_, index) => index));
    const wrongRecipient = boxKeypairFromSeed(
      Uint8Array.from({ length: 32 }, (_, index) => index + 1)
    );
    const bundle = boxEncryptToPublicKey(new TextEncoder().encode("hello koko"), recipient.publicKey);

    expect(() => boxDecryptWithSecretKey(bundle, wrongRecipient.secretKey)).toThrow(
      /box decryption failed/
    );
  });

  it("throws when the bundle is tampered with", () => {
    const recipient = boxKeypairFromSeed(Uint8Array.from({ length: 32 }, (_, index) => index));
    const bundle = boxEncryptToPublicKey(new TextEncoder().encode("hello koko"), recipient.publicKey);
    const tampered = new Uint8Array(bundle);
    const lastIndex = tampered.length - 1;
    tampered[lastIndex] = (tampered[lastIndex] ?? 0) ^ 1;

    expect(() => boxDecryptWithSecretKey(tampered, recipient.secretKey)).toThrow(
      /box decryption failed/
    );
  });

  it("throws unknown version for 0x00 and 0x02 bundle versions", () => {
    const recipient = boxKeypairFromSeed(Uint8Array.from({ length: 32 }, (_, index) => index));
    const bundle = boxEncryptToPublicKey(new TextEncoder().encode("hello koko"), recipient.publicKey);

    for (const version of [0x00, 0x02]) {
      const changed = new Uint8Array(bundle);
      changed[0] = version;
      expect(() => boxDecryptWithSecretKey(changed, recipient.secretKey)).toThrow(/unknown version/);
    }
  });

  it("throws when the bundle length is too short", () => {
    const recipient = boxKeypairFromSeed(Uint8Array.from({ length: 32 }, (_, index) => index));
    const bundle = new Uint8Array(1 + 32 + 24 + 15);
    bundle[0] = 1;

    expect(() => boxDecryptWithSecretKey(bundle, recipient.secretKey)).toThrow(/too short/);
  });

  it("round-trips an empty plaintext", () => {
    const recipient = boxKeypairFromSeed(Uint8Array.from({ length: 32 }, (_, index) => index));
    const plaintext = new Uint8Array(0);
    const bundle = boxEncryptToPublicKey(plaintext, recipient.publicKey);

    expect(boxDecryptWithSecretKey(bundle, recipient.secretKey)).toEqual(plaintext);
  });
});
