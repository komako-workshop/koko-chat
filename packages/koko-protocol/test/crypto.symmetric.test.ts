import { beforeAll, describe, expect, it } from "vitest";
import { initCrypto, symmetricDecrypt, symmetricEncrypt } from "../src/crypto";

describe("symmetric AEAD (XChaCha20-Poly1305)", () => {
  beforeAll(async () => {
    await initCrypto();
  });

  it("round-trips plaintext", () => {
    const key = Uint8Array.from({ length: 32 }, (_, index) => index);
    const plaintext = new TextEncoder().encode("hello koko");
    const bundle = symmetricEncrypt(plaintext, key);

    expect(symmetricDecrypt(bundle, key)).toEqual(plaintext);
  });

  it("throws when decrypting with the wrong key", () => {
    const key = Uint8Array.from({ length: 32 }, (_, index) => index);
    const wrongKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const bundle = symmetricEncrypt(new TextEncoder().encode("hello koko"), key);

    expect(() => symmetricDecrypt(bundle, wrongKey)).toThrow(/symmetric decryption failed/);
  });

  it("throws when ciphertext or tag is tampered with", () => {
    const key = Uint8Array.from({ length: 32 }, (_, index) => index);
    const bundle = symmetricEncrypt(new TextEncoder().encode("hello koko"), key);

    const tamperedCiphertext = new Uint8Array(bundle);
    // flip a byte inside the ciphertext region (after version + nonce prefix)
    tamperedCiphertext[25] = (tamperedCiphertext[25] ?? 0) ^ 1;

    const tamperedTag = new Uint8Array(bundle);
    const lastIndex = tamperedTag.length - 1;
    tamperedTag[lastIndex] = (tamperedTag[lastIndex] ?? 0) ^ 1;

    expect(() => symmetricDecrypt(tamperedCiphertext, key)).toThrow(/symmetric decryption failed/);
    expect(() => symmetricDecrypt(tamperedTag, key)).toThrow(/symmetric decryption failed/);
  });

  it("throws unknown version for an unsupported bundle version", () => {
    const key = Uint8Array.from({ length: 32 }, (_, index) => index);
    const bundle = symmetricEncrypt(new TextEncoder().encode("hello koko"), key);
    const changed = new Uint8Array(bundle);
    changed[0] = 0x02;

    expect(() => symmetricDecrypt(changed, key)).toThrow(/unknown version/);
  });

  it("uses a 24-byte nonce in the bundle", () => {
    const key = Uint8Array.from({ length: 32 }, (_, index) => index);
    const plaintext = new TextEncoder().encode("hello koko");
    const bundle = symmetricEncrypt(plaintext, key);
    const nonce = bundle.slice(1, 25);

    expect(nonce).toHaveLength(24);
    // bundle = version(1) + nonce(24) + ciphertext(=plaintext length) + tag(16)
    expect(bundle).toHaveLength(1 + 24 + plaintext.length + 16);
  });

  it("round-trips an empty plaintext", () => {
    const key = Uint8Array.from({ length: 32 }, (_, index) => index);
    const plaintext = new Uint8Array(0);
    const bundle = symmetricEncrypt(plaintext, key);

    expect(symmetricDecrypt(bundle, key)).toEqual(plaintext);
  });
});
