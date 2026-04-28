import { assertByteLength } from "./bytes";
import { ensureReady, sodium } from "./sodium";

/** Returns cryptographically secure random bytes from libsodium. */
export function randomBytes(n: number): Uint8Array {
  ensureReady();

  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError("random byte length must be a non-negative safe integer");
  }

  const bytes = sodium.randombytes_buf(n);
  assertByteLength("random output", bytes, n);
  return bytes;
}
