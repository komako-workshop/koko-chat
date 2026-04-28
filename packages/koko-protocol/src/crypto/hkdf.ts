import { hkdf as nobleHkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";

const ZERO_SALT = new Uint8Array(32);
const textEncoder = new TextEncoder();

function infoToBytes(info: string | Uint8Array): Uint8Array {
  return typeof info === "string" ? textEncoder.encode(info) : info;
}

/** Derives bytes with HKDF-SHA256. String info is UTF-8 encoded. */
export function hkdf(
  ikm: Uint8Array,
  info: string | Uint8Array,
  length: number,
  salt: Uint8Array = ZERO_SALT
): Uint8Array {
  if (!Number.isSafeInteger(length) || length <= 0) {
    throw new RangeError("HKDF output length must be a positive safe integer");
  }

  return nobleHkdf(sha256, ikm, salt, infoToBytes(info), length);
}
