import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2";

// React Native's Hermes runtime does NOT expose `crypto.subtle`, so the
// async noble/ed25519 entry points (which compute SHA-512 via WebCrypto)
// fail with "crypto.subtle must be defined". The noble v2 sync APIs avoid
// WebCrypto entirely as long as a sync sha512 implementation is provided.
//
// We inject @noble/hashes/sha2's sha512 — already required for sha256 below
// so this adds zero new install size — and use the sync sign / getPublicKey.
// This keeps device.ts working in:
//   - Node (with or without webcrypto)
//   - Browsers (webcrypto present, but we don't need it here either)
//   - React Native Hermes (no webcrypto, the original blocker)
ed.etc.sha512Sync = (...messages: Uint8Array[]) =>
  sha512(messages.length === 1 ? messages[0]! : ed.etc.concatBytes(...messages));


// Cross-platform primitives.
// - randomBytes uses globalThis.crypto which exists in:
//   - Node 19+ (webcrypto)
//   - all modern browsers
//   - React Native Hermes (via react-native-get-random-values polyfill)
//     or RN's own built-in as of 0.76+ / Hermes.
// - base64url uses TextEncoder/TextDecoder + btoa/atob which are everywhere.
// This keeps the package usable from RN Metro without a Node shim.
function getCrypto(): Crypto {
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    return globalThis.crypto;
  }
  throw new Error(
    "Cryptographically secure randomness not available. " +
      "On older React Native, import 'react-native-get-random-values' at app entry."
  );
}

/** Arguments used to build OpenClaw's canonical v2 signature payload. */
export interface SignaturePayloadArgs {
  /** Device id, `hex(sha256(publicKey))`. */
  deviceId: string;
  /** Client id. */
  clientId: string;
  /** Client mode. */
  clientMode: string;
  /** Requested role. */
  role: string;
  /** Requested scopes. */
  scopes: string[];
  /** Signature time in epoch milliseconds. */
  signedAtMs: number;
  /** Operator token, or null for an empty token slot. */
  token: string | null;
  /** Challenge nonce. */
  nonce: string;
}

/** Creates a fresh 32-byte Ed25519 device seed. */
export function generateDeviceSeed(): Uint8Array {
  const bytes = new Uint8Array(32);
  getCrypto().getRandomValues(bytes);
  return bytes;
}

/**
 * v2 signature payload used by OpenClaw Gateway Protocol v3:
 * `v2|<deviceId>|<clientId>|<clientMode>|<role>|<scopes_csv>|<signedAtMs>|<token_or_empty>|<nonce>`.
 */
export function buildSignaturePayload(args: SignaturePayloadArgs): string {
  return [
    "v2",
    args.deviceId,
    args.clientId,
    args.clientMode,
    args.role,
    args.scopes.join(","),
    String(args.signedAtMs),
    args.token ?? "",
    args.nonce
  ].join("|");
}

/** Derives a base64url Ed25519 public key and lowercase hex device id from a 32-byte seed. */
export async function deriveDeviceIdentity(seed: Uint8Array): Promise<{ publicKey: string; deviceId: string }> {
  assertSeed(seed);
  const publicKeyBytes = ed.getPublicKey(seed);
  return {
    publicKey: base64url(publicKeyBytes),
    deviceId: bytesToHex(sha256(publicKeyBytes))
  };
}

/** Signs an arbitrary UTF-8 payload string with a 32-byte Ed25519 seed. */
export async function signDevicePayload(seed: Uint8Array, payload: string): Promise<string> {
  assertSeed(seed);
  const message = new TextEncoder().encode(payload);
  const signature = ed.sign(message, seed);
  return base64url(signature);
}

/** Encodes bytes as base64url without padding (works in browsers, RN, and Node). */
export function base64url(bytes: Uint8Array): string {
  // Use a portable implementation instead of Node's Buffer.
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  // btoa is available in Node 16+, all browsers, and RN Hermes.
  const b64 = typeof btoa === "function" ? btoa(binary) : globalBtoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function globalBtoa(binary: string): string {
  // Node 16+ has btoa as a global; this branch is only for hypothetical runtimes
  // that miss it. Fall back to inline base64 encode.
  const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  let i = 0;
  while (i < binary.length) {
    const c1 = binary.charCodeAt(i++);
    const c2 = i < binary.length ? binary.charCodeAt(i++) : Number.NaN;
    const c3 = i < binary.length ? binary.charCodeAt(i++) : Number.NaN;
    const e1 = c1 >> 2;
    const e2 = ((c1 & 3) << 4) | (c2 >> 4);
    const e3 = Number.isNaN(c2) ? 64 : ((c2 & 15) << 2) | (c3 >> 6);
    const e4 = Number.isNaN(c3) ? 64 : c3 & 63;
    output += CHARS.charAt(e1) + CHARS.charAt(e2) + CHARS.charAt(e3) + CHARS.charAt(e4);
  }
  return output;
}

function assertSeed(seed: Uint8Array): void {
  if (seed.byteLength !== 32) {
    throw new RangeError("device seed must be exactly 32 bytes");
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
