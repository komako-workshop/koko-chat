import { Buffer } from "node:buffer";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ED25519_PKCS8_PRIVATE_KEY_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const ED25519_PUBLIC_KEY_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** Default OpenClaw device identity path used by the local Gateway. */
export const DEFAULT_OPENCLAW_IDENTITY_PATH = path.join(os.homedir(), ".openclaw", "identity", "device.json");

/** Default OpenClaw paired devices path used by the local Gateway. */
export const DEFAULT_OPENCLAW_PAIRED_PATH = path.join(os.homedir(), ".openclaw", "devices", "paired.json");

/** OpenClaw device identity material needed for Gateway challenge-response auth. */
export interface OpenClawDeviceIdentity {
  /** 32-byte Ed25519 private key seed extracted from the PKCS8 private key. */
  seed: Uint8Array;
  /** Hex OpenClaw device id stored in device.json. */
  deviceId: string;
  /** PEM-encoded Ed25519 public key from device.json. */
  publicKeyPem: string;
  /** Base64url raw Ed25519 public key derived from publicKeyPem. */
  publicKey: string;
}

type IdentityJson = {
  deviceId?: unknown;
  privateKeyPem?: unknown;
  publicKeyPem?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function assertReadable(filePath: string, label: string): Promise<void> {
  try {
    await access(filePath, constants.R_OK);
  } catch {
    throw new Error(`${label} file not found: ${filePath}`);
  }
}

async function readJsonFile(filePath: string, label: string): Promise<unknown> {
  await assertReadable(filePath, label);
  const text = await readFile(filePath, "utf8");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} file is not valid JSON: ${filePath}`);
  }
}

function pemToDer(pem: string, label: "PRIVATE KEY" | "PUBLIC KEY"): Buffer {
  const base64 = pem
    .replace(new RegExp(`-----BEGIN ${label}-----`, "g"), "")
    .replace(new RegExp(`-----END ${label}-----`, "g"), "")
    .replace(/\s/g, "");
  return Buffer.from(base64, "base64");
}

function extractSeedFromPkcs8(privateKeyPem: string): Uint8Array {
  const der = pemToDer(privateKeyPem, "PRIVATE KEY");
  if (der.length !== 48) {
    throw new Error(`unexpected PKCS8 length ${der.length}, expected 48`);
  }
  if (!der.subarray(0, ED25519_PKCS8_PRIVATE_KEY_PREFIX.length).equals(ED25519_PKCS8_PRIVATE_KEY_PREFIX)) {
    throw new Error("unexpected PKCS8 Ed25519 private key header");
  }
  return new Uint8Array(der.subarray(16, 48));
}

function extractPublicKeyFromPem(publicKeyPem: string): string {
  const der = pemToDer(publicKeyPem, "PUBLIC KEY");
  if (der.length !== 44) {
    throw new Error(`unexpected Ed25519 public key length ${der.length}, expected 44`);
  }
  if (!der.subarray(0, ED25519_PUBLIC_KEY_PREFIX.length).equals(ED25519_PUBLIC_KEY_PREFIX)) {
    throw new Error("unexpected Ed25519 public key header");
  }
  return der.subarray(ED25519_PUBLIC_KEY_PREFIX.length).toString("base64url");
}

/** Loads OpenClaw's persisted Ed25519 device seed and public identity metadata. */
export async function loadOpenClawDeviceSeed(identityJsonPath = DEFAULT_OPENCLAW_IDENTITY_PATH): Promise<OpenClawDeviceIdentity> {
  const parsed = await readJsonFile(identityJsonPath, "OpenClaw identity");
  if (!isRecord(parsed)) {
    throw new Error("OpenClaw identity file must contain a JSON object");
  }

  const raw = parsed as IdentityJson;
  if (typeof raw.deviceId !== "string") {
    throw new Error("OpenClaw identity file missing deviceId");
  }
  if (typeof raw.publicKeyPem !== "string") {
    throw new Error("OpenClaw identity file missing publicKeyPem");
  }
  if (typeof raw.privateKeyPem !== "string") {
    throw new Error("OpenClaw identity file missing privateKeyPem");
  }

  return {
    seed: extractSeedFromPkcs8(raw.privateKeyPem),
    deviceId: raw.deviceId,
    publicKeyPem: raw.publicKeyPem,
    publicKey: extractPublicKeyFromPem(raw.publicKeyPem)
  };
}

/** Operator token + client metadata for a paired OpenClaw device. */
export interface OpenClawPairedDeviceInfo {
  /** Operator-role bearer token. */
  token: string;
  /** OpenClaw-assigned client identifier (one of an internal allow-list, e.g. "cli"). */
  clientId: string;
  /** OpenClaw client mode (e.g. "probe" / "ui"). */
  clientMode: string;
}

/** Loads the operator token and client metadata for a specific OpenClaw device id from paired.json. */
export async function loadOpenClawPairedDevice(
  deviceId: string,
  pairedJsonPath = DEFAULT_OPENCLAW_PAIRED_PATH
): Promise<OpenClawPairedDeviceInfo> {
  const parsed = await readJsonFile(pairedJsonPath, "OpenClaw paired devices");
  if (!isRecord(parsed)) {
    throw new Error("OpenClaw paired devices file must contain a JSON object");
  }

  const entry = parsed[deviceId];
  if (!isRecord(entry)) {
    throw new Error(`paired.json has no entry for deviceId ${deviceId}`);
  }

  const tokens = entry.tokens;
  const operator = isRecord(tokens) && isRecord(tokens.operator) ? tokens.operator : undefined;
  const token = operator?.token;
  if (typeof token !== "string") {
    throw new Error(`paired.json has no operator.token for deviceId ${deviceId}`);
  }

  const clientId = typeof entry.clientId === "string" && entry.clientId.length > 0 ? entry.clientId : "cli";
  const clientMode = typeof entry.clientMode === "string" && entry.clientMode.length > 0 ? entry.clientMode : "probe";

  return { token, clientId, clientMode };
}

/**
 * Backwards-compatible alias: returns just the operator token.
 * New code should prefer {@link loadOpenClawPairedDevice} so that Gateway-approved
 * clientId / clientMode are passed through to the handshake (OpenClaw enforces
 * an allow-list and rejects unknown values with "invalid connect params").
 */
export async function loadOpenClawOperatorToken(
  deviceId: string,
  pairedJsonPath = DEFAULT_OPENCLAW_PAIRED_PATH
): Promise<string> {
  const info = await loadOpenClawPairedDevice(deviceId, pairedJsonPath);
  return info.token;
}
