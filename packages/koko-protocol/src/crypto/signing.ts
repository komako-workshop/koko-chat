import { assertByteLength } from "./bytes";
import { randomBytes } from "./random";
import { ensureReady, sodium } from "./sodium";

/** Ed25519 keypair used for challenge-response identity checks. */
export interface SigningKeypair {
  /** 32-byte Ed25519 public key. */
  publicKey: Uint8Array;
  /** 64-byte Ed25519 secret key as returned by libsodium. */
  secretKey: Uint8Array;
}

/** Builds a deterministic Ed25519 signing keypair from a 32-byte seed. */
export function signingKeypairFromSeed(seed: Uint8Array): SigningKeypair {
  ensureReady();
  assertByteLength("signing seed", seed, 32);

  const keypair = sodium.crypto_sign_seed_keypair(seed);
  return {
    publicKey: keypair.publicKey,
    secretKey: keypair.privateKey
  };
}

/** Generates a fresh 32-byte signing challenge. */
export function generateChallenge(): Uint8Array {
  return randomBytes(32);
}

/** Signs a 32-byte challenge with an Ed25519 keypair. */
export function signChallenge(challenge: Uint8Array, kp: SigningKeypair): Uint8Array {
  ensureReady();
  assertByteLength("challenge", challenge, 32);
  assertByteLength("signing publicKey", kp.publicKey, 32);
  assertByteLength("signing secretKey", kp.secretKey, 64);

  return sodium.crypto_sign_detached(challenge, kp.secretKey);
}

/** Verifies an Ed25519 challenge signature. */
export function verifyChallenge(
  challenge: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): boolean {
  ensureReady();

  try {
    assertByteLength("challenge", challenge, 32);
    assertByteLength("signature", signature, 64);
    assertByteLength("signing publicKey", publicKey, 32);
    return sodium.crypto_sign_verify_detached(signature, challenge, publicKey);
  } catch {
    return false;
  }
}
