import { assertByteLength } from "../crypto/bytes";
import { decodeBase64Url, encodeBase64Url } from "./base64url";

/** Decoded pairing QR payload. */
export interface PairingQr {
  /** 32-byte one-time Curve25519 public key. */
  publicKey: Uint8Array;
}

/** Encodes a 32-byte public key as koko://pair?k=<base64url>. */
export function encodePairingQrUrl(publicKey: Uint8Array): string {
  assertByteLength("pairing publicKey", publicKey, 32);
  return `koko://pair?k=${encodeBase64Url(publicKey)}`;
}

/** Decodes and validates a koko://pair?k=<base64url> QR URL. */
export function decodePairingQrUrl(url: string): PairingQr {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("invalid pairing QR URL");
  }

  if (parsed.protocol !== "koko:") {
    throw new Error("invalid pairing QR scheme");
  }

  if (parsed.hostname !== "pair" || (parsed.pathname !== "" && parsed.pathname !== "/")) {
    throw new Error("invalid pairing QR path");
  }

  const encodedKey = parsed.searchParams.get("k");
  if (encodedKey === null || encodedKey.length === 0) {
    throw new Error("missing pairing public key");
  }

  const publicKey = decodeBase64Url(encodedKey);
  assertByteLength("pairing publicKey", publicKey, 32);

  return { publicKey };
}
