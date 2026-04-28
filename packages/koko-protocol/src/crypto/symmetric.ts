import { PROTOCOL_VERSION } from "../version";
import { assertByteLength, concatBytes, sliceBytes } from "./bytes";
import { DecryptionError } from "./errors";
import { randomBytes } from "./random";
import { ensureReady, sodium } from "./sodium";

/**
 * Symmetric AEAD built on XChaCha20-Poly1305 (IETF construction).
 *
 * Why XChaCha20-Poly1305 instead of AES-256-GCM:
 *   - libsodium.js deliberately omits AES-GCM from the default bundle
 *     (needs AES-NI for constant-time ops; only shipped in the "sumo" build).
 *   - XChaCha20-Poly1305 is libsodium's recommended symmetric AEAD.
 *   - 24-byte random nonces make accidental nonce reuse essentially impossible.
 *
 * Bundle format: version(1B=0x01) || nonce(24B) || ciphertext_and_tag
 */

const SYMMETRIC_KEY_BYTES = 32;
const SYMMETRIC_NONCE_BYTES = 24;
const SYMMETRIC_TAG_BYTES = 16;
const SYMMETRIC_MIN_BUNDLE_BYTES = 1 + SYMMETRIC_NONCE_BYTES + SYMMETRIC_TAG_BYTES;

/** Encrypts plaintext with XChaCha20-Poly1305 into version||nonce||ciphertext_and_tag. */
export function symmetricEncrypt(plaintext: Uint8Array, key: Uint8Array): Uint8Array {
  ensureReady();
  assertByteLength("symmetric key", key, SYMMETRIC_KEY_BYTES);

  const nonce = randomBytes(SYMMETRIC_NONCE_BYTES);
  const ciphertextAndTag = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    null,
    null,
    nonce,
    key
  );

  return concatBytes(Uint8Array.of(PROTOCOL_VERSION), nonce, ciphertextAndTag);
}

/** Decrypts a version||nonce||ciphertext_and_tag bundle with XChaCha20-Poly1305. */
export function symmetricDecrypt(bundle: Uint8Array, key: Uint8Array): Uint8Array {
  ensureReady();
  assertByteLength("symmetric key", key, SYMMETRIC_KEY_BYTES);

  if (bundle.length < SYMMETRIC_MIN_BUNDLE_BYTES) {
    throw new DecryptionError("symmetric bundle too short");
  }

  const version = bundle[0];
  if (version !== PROTOCOL_VERSION) {
    throw new DecryptionError(`unknown version byte for symmetric bundle: ${String(version)}`);
  }

  const nonce = sliceBytes(bundle, 1, 1 + SYMMETRIC_NONCE_BYTES);
  const ciphertextAndTag = sliceBytes(bundle, 1 + SYMMETRIC_NONCE_BYTES);

  try {
    return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      ciphertextAndTag,
      null,
      nonce,
      key
    );
  } catch {
    throw new DecryptionError("symmetric decryption failed");
  }
}
