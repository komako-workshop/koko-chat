import { randomBytes } from "node:crypto";
import { mkdir, readFile, chmod, writeFile } from "node:fs/promises";
import path from "node:path";

const base64UrlPattern = /^[A-Za-z0-9_-]+$/;

/** Result returned when loading or generating the device seed. */
export interface DeviceSeedResult {
  /** 32-byte seed. */
  seed: Uint8Array;
  /** True when the seed did not exist and was generated now. */
  created: boolean;
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function decodeSeed(text: string): Uint8Array {
  const trimmed = text.trim();
  if (!base64UrlPattern.test(trimmed)) {
    throw new Error("device seed file must contain base64url text");
  }
  const decoded = Buffer.from(trimmed, "base64url");
  if (decoded.byteLength !== 32) {
    throw new Error("device seed must decode to 32 bytes");
  }
  return new Uint8Array(decoded);
}

function generateDeviceSeed(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}

/** Save seed to disk as a single base64url line with 0600 permissions. */
export async function saveDeviceSeed(keyPath: string, seed: Uint8Array): Promise<void> {
  if (seed.byteLength !== 32) {
    throw new Error("device seed must be 32 bytes");
  }
  await mkdir(path.dirname(keyPath), { recursive: true });
  await writeFile(keyPath, `${Buffer.from(seed).toString("base64url")}\n`, { mode: 0o600 });
  await chmod(keyPath, 0o600);
}

/** Load or generate the 32-byte device Ed25519 seed. */
export async function loadOrCreateDeviceSeed(keyPath: string): Promise<DeviceSeedResult> {
  try {
    const text = await readFile(keyPath, "utf8");
    return {
      seed: decodeSeed(text),
      created: false
    };
  } catch (error) {
    if (!isNodeErrorWithCode(error, "ENOENT")) {
      throw error;
    }
    const seed = generateDeviceSeed();
    await saveDeviceSeed(keyPath, seed);
    return {
      seed,
      created: true
    };
  }
}
