import { describe, expect, it } from "vitest";
import { decodePairingQrUrl, encodePairingQrUrl } from "../src/pairing";

describe("pairing QR URL", () => {
  it("round-trips a public key", () => {
    const publicKey = Uint8Array.from({ length: 32 }, (_, index) => index);
    const url = encodePairingQrUrl(publicKey);

    expect(decodePairingQrUrl(url).publicKey).toEqual(publicKey);
  });

  it("starts with koko://pair?k=", () => {
    const publicKey = Uint8Array.from({ length: 32 }, (_, index) => index);

    expect(encodePairingQrUrl(publicKey).startsWith("koko://pair?k=")).toBe(true);
  });

  it("uses unpadded base64url for the k parameter", () => {
    const publicKey = Uint8Array.from({ length: 32 }, (_, index) => index);
    const url = encodePairingQrUrl(publicKey);
    const encodedKey = new URL(url).searchParams.get("k");

    expect(encodedKey).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodedKey).not.toMatch(/[+/=]/);
  });

  it("throws for a non-koko scheme", () => {
    const publicKey = Uint8Array.from({ length: 32 }, (_, index) => index);
    const url = encodePairingQrUrl(publicKey).replace("koko://", "https://");

    expect(() => decodePairingQrUrl(url)).toThrow(/scheme/);
  });

  it("throws when the path is not pair", () => {
    const publicKey = Uint8Array.from({ length: 32 }, (_, index) => index);
    const url = encodePairingQrUrl(publicKey).replace("koko://pair", "koko://other");

    expect(() => decodePairingQrUrl(url)).toThrow(/path/);
  });

  it("throws when the k parameter is missing or invalid base64url", () => {
    expect(() => decodePairingQrUrl("koko://pair")).toThrow(/missing/);
    expect(() => decodePairingQrUrl("koko://pair?k=not+base64url")).toThrow(/base64url/);
  });

  it("throws when the decoded k parameter is not 32 bytes", () => {
    expect(() => decodePairingQrUrl("koko://pair?k=AQID")).toThrow(/32 bytes/);
  });
});
