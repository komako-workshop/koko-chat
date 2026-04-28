import { describe, expect, it } from "vitest";
import { hkdf } from "../src/crypto";

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("hex input must have even length");
  }

  const output = new Uint8Array(hex.length / 2);
  for (let index = 0; index < output.length; index += 1) {
    const byte = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error("invalid hex input");
    }
    output[index] = byte;
  }

  return output;
}

describe("hkdf", () => {
  it("passes RFC 5869 test case 1", () => {
    const ikm = hexToBytes("0b".repeat(22));
    const salt = hexToBytes("000102030405060708090a0b0c");
    const info = hexToBytes("f0f1f2f3f4f5f6f7f8f9");
    const okm = hexToBytes(
      "3cb25f25faacd57a90434f64d0362f2a" +
        "2d2d0a90cf1a5a4c5db02d56ecc4c5bf" +
        "34007208d5b887185865"
    );

    expect(hkdf(ikm, info, 42, salt)).toEqual(okm);
  });

  it("returns deterministic output for the same input and info", () => {
    const ikm = Uint8Array.from([1, 2, 3, 4]);

    expect(hkdf(ikm, "same", 32)).toEqual(hkdf(ikm, "same", 32));
  });

  it("returns different output for different info", () => {
    const ikm = Uint8Array.from([1, 2, 3, 4]);

    expect(hkdf(ikm, "left", 32)).not.toEqual(hkdf(ikm, "right", 32));
  });

  it("returns different output for different salt", () => {
    const ikm = Uint8Array.from([1, 2, 3, 4]);

    expect(hkdf(ikm, "info", 32, Uint8Array.of(1))).not.toEqual(
      hkdf(ikm, "info", 32, Uint8Array.of(2))
    );
  });
});
