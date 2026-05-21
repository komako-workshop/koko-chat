/**
 * Persistent device identity storage for the OpenClaw Gateway client.
 *
 * We store the 32-byte Ed25519 seed + the deviceToken issued by Gateway at
 * hello-ok time. On the next launch we can:
 *   1. Load the seed from MMKV
 *   2. Pass deviceToken to BrowserGatewayClient so Gateway recognises us
 *      without needing a fresh pairing approval.
 *
 * If either piece is missing, fall back to a fresh pairing (generateDeviceSeed).
 */

import { generateDeviceSeed } from "@koko/openclaw-client/protocol";
import { mmkv } from "@/storage/mmkv";

const SEED_KEY = "koko.gateway.deviceSeed.v1";
const DEVICE_TOKEN_KEY = "koko.gateway.deviceToken.v1";
const GATEWAY_URL_KEY = "koko.gateway.url.v1";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0) {
    return null;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      return null;
    }
    bytes[i] = byte;
  }
  return bytes;
}

/** Load the persisted device seed, or generate + persist a fresh one. */
export function loadOrCreateDeviceSeed(): Uint8Array {
  const stored = mmkv.getString(SEED_KEY);
  if (typeof stored === "string" && stored.length > 0) {
    const bytes = hexToBytes(stored);
    if (bytes !== null && bytes.byteLength === 32) {
      return bytes;
    }
  }
  const fresh = generateDeviceSeed();
  mmkv.set(SEED_KEY, bytesToHex(fresh));
  return fresh;
}

/** Load the persisted deviceToken, if any. */
export function loadDeviceToken(): string | undefined {
  const stored = mmkv.getString(DEVICE_TOKEN_KEY);
  return typeof stored === "string" && stored.length > 0 ? stored : undefined;
}

/** Persist the deviceToken issued by Gateway. */
export function saveDeviceToken(deviceToken: string): void {
  mmkv.set(DEVICE_TOKEN_KEY, deviceToken);
}

/** Clear all persisted device identity (used for "forget this device"). */
export function clearDeviceIdentity(): void {
  mmkv.delete(SEED_KEY);
  mmkv.delete(DEVICE_TOKEN_KEY);
  mmkv.delete(GATEWAY_URL_KEY);
}

/** Persist the last gateway URL we successfully connected to. */
export function saveGatewayUrl(url: string): void {
  mmkv.set(GATEWAY_URL_KEY, url);
}

/** Load the last gateway URL. */
export function loadGatewayUrl(): string | undefined {
  const stored = mmkv.getString(GATEWAY_URL_KEY);
  return typeof stored === "string" && stored.length > 0 ? stored : undefined;
}

/**
 * Whether this app has a previously approved Gateway device pairing.
 *
 * A stored URL alone is not enough: dev shared-token auto-connect also stores
 * the URL. A stored deviceToken means the phone has been approved by OpenClaw
 * and can reconnect without asking the user to pair again.
 */
export function hasStoredGatewayPairing(): boolean {
  return loadGatewayUrl() !== undefined && loadDeviceToken() !== undefined;
}
