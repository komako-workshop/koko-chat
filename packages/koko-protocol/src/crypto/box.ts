import { PROTOCOL_VERSION } from "../version";
import { assertByteLength, concatBytes, sliceBytes } from "./bytes";
import { DecryptionError } from "./errors";
import { randomBytes } from "./random";
import { ensureReady, sodium } from "./sodium";

const BOX_VERSION_OFFSET = 0;
const BOX_EPHEMERAL_PUBLIC_KEY_OFFSET = 1;
const BOX_NONCE_OFFSET = BOX_EPHEMERAL_PUBLIC_KEY_OFFSET + 32;
const BOX_CIPHERTEXT_OFFSET = BOX_NONCE_OFFSET + 24;
const BOX_MAC_BYTES = 16;
const BOX_MIN_BUNDLE_BYTES = BOX_CIPHERTEXT_OFFSET + BOX_MAC_BYTES;

/** Curve25519 keypair used with libsodium crypto_box. */
export interface BoxKeypair {
  /** 32-byte Curve25519 public key. */
  publicKey: Uint8Array;
  /** 32-byte Curve25519 secret key. */
  secretKey: Uint8Array;
}

/** Builds a deterministic Curve25519 box keypair from a 32-byte seed. */
export function boxKeypairFromSeed(seed: Uint8Array): BoxKeypair {
  ensureReady();
  assertByteLength("box seed", seed, 32);

  const keypair = sodium.crypto_box_seed_keypair(seed);
  return {
    publicKey: keypair.publicKey,
    secretKey: keypair.privateKey
  };
}

/** Generates a fresh ephemeral Curve25519 box keypair. */
export function generateEphemeralBoxKeypair(): BoxKeypair {
  ensureReady();

  const keypair = sodium.crypto_box_keypair();
  return {
    publicKey: keypair.publicKey,
    secretKey: keypair.privateKey
  };
}

/** Encrypts to a recipient public key using an ephemeral sender box keypair. */
export function boxEncryptToPublicKey(
  plaintext: Uint8Array,
  recipientPublicKey: Uint8Array
): Uint8Array {
  ensureReady();
  assertByteLength("recipientPublicKey", recipientPublicKey, 32);

  const ephemeral = generateEphemeralBoxKeypair();
  const nonce = randomBytes(24);
  const ciphertext = sodium.crypto_box_easy(
    plaintext,
    nonce,
    recipientPublicKey,
    ephemeral.secretKey
  );

  return concatBytes(Uint8Array.of(PROTOCOL_VERSION), ephemeral.publicKey, nonce, ciphertext);
}

/** Decrypts an ephemeral-sender box bundle with the recipient secret key. */
export function boxDecryptWithSecretKey(
  bundle: Uint8Array,
  recipientSecretKey: Uint8Array
): Uint8Array {
  ensureReady();
  assertByteLength("recipientSecretKey", recipientSecretKey, 32);

  if (bundle.length < BOX_MIN_BUNDLE_BYTES) {
    throw new DecryptionError("box bundle too short");
  }

  const version = bundle[BOX_VERSION_OFFSET];
  if (version !== PROTOCOL_VERSION) {
    throw new DecryptionError(`unknown version byte for box bundle: ${String(version)}`);
  }

  const ephemeralPublicKey = sliceBytes(bundle, BOX_EPHEMERAL_PUBLIC_KEY_OFFSET, BOX_NONCE_OFFSET);
  const nonce = sliceBytes(bundle, BOX_NONCE_OFFSET, BOX_CIPHERTEXT_OFFSET);
  const ciphertext = sliceBytes(bundle, BOX_CIPHERTEXT_OFFSET);

  try {
    return sodium.crypto_box_open_easy(ciphertext, nonce, ephemeralPublicKey, recipientSecretKey);
  } catch (error) {
    throw new DecryptionError("box decryption failed");
  }
}
