import { randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";
import { getPublicKeyAsync, signAsync } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha2";

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
  return randomBytes(32);
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
  const publicKeyBytes = await getPublicKeyAsync(seed);
  return {
    publicKey: base64url(publicKeyBytes),
    deviceId: bytesToHex(sha256(publicKeyBytes))
  };
}

/** Signs an arbitrary UTF-8 payload string with a 32-byte Ed25519 seed. */
export async function signDevicePayload(seed: Uint8Array, payload: string): Promise<string> {
  assertSeed(seed);
  const message = new TextEncoder().encode(payload);
  const signature = await signAsync(message, seed);
  return base64url(signature);
}

/** Encodes bytes as base64url without padding. */
export function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function assertSeed(seed: Uint8Array): void {
  if (seed.byteLength !== 32) {
    throw new RangeError("device seed must be exactly 32 bytes");
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
