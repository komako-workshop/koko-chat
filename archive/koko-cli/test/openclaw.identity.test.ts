import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadOpenClawDeviceSeed, loadOpenClawOperatorToken } from "../src/openclaw";

const PRIVATE_KEY_PEM = "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIILVF0/EzaS6zzMhz0Z85amQFrjBrlSe+8EcVAs9b4sf\n-----END PRIVATE KEY-----\n";
const PUBLIC_KEY_PEM = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAm5DaiOBU8Wk/iW7Tz2BTW1ne1YeD0p0j/SnHwD2Uc+c=\n-----END PUBLIC KEY-----\n";
const DEVICE_ID = "27edfbe83a819252501d93c7de5a9f4818c9b0a0b4d3e6e43dc7c290ce9faf56";
const SEED_HEX = "82d5174fc4cda4bacf3321cf467ce5a99016b8c1ae549efbc11c540b3d6f8b1f";
const PUBLIC_KEY = "m5DaiOBU8Wk_iW7Tz2BTW1ne1YeD0p0j_SnHwD2Uc-c";

async function tempFile(prefix: string, fileName: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  return path.join(dir, fileName);
}

async function writeIdentityJson(value: unknown): Promise<string> {
  const filePath = await tempFile("koko-openclaw-identity-", "device.json");
  await writeFile(filePath, JSON.stringify(value), "utf8");
  return filePath;
}

describe("OpenClaw identity loading", () => {
  it("extracts the verified 32-byte Ed25519 seed from OpenClaw's PKCS8 PEM", async () => {
    const identityPath = await writeIdentityJson({
      version: 1,
      deviceId: DEVICE_ID,
      publicKeyPem: PUBLIC_KEY_PEM,
      privateKeyPem: PRIVATE_KEY_PEM,
      createdAtMs: 1773720321374
    });

    const identity = await loadOpenClawDeviceSeed(identityPath);
    expect(Buffer.from(identity.seed).toString("hex")).toBe(SEED_HEX);
    expect(identity.deviceId).toBe(DEVICE_ID);
    expect(identity.publicKeyPem).toBe(PUBLIC_KEY_PEM);
    expect(identity.publicKey).toBe(PUBLIC_KEY);
  });

  it("throws a clear error when the identity file is missing", async () => {
    const missingPath = path.join(os.tmpdir(), "koko-openclaw-missing-device.json");
    await expect(loadOpenClawDeviceSeed(missingPath)).rejects.toThrow(/OpenClaw identity file not found/);
  });

  it("throws when the identity file is not valid JSON", async () => {
    const identityPath = await tempFile("koko-openclaw-invalid-json-", "device.json");
    await writeFile(identityPath, "{", "utf8");

    await expect(loadOpenClawDeviceSeed(identityPath)).rejects.toThrow(/not valid JSON/);
  });

  it("throws when privateKeyPem is missing", async () => {
    const identityPath = await writeIdentityJson({
      deviceId: DEVICE_ID,
      publicKeyPem: PUBLIC_KEY_PEM
    });

    await expect(loadOpenClawDeviceSeed(identityPath)).rejects.toThrow(/missing privateKeyPem/);
  });

  it("throws when the PKCS8 DER length is not 48 bytes", async () => {
    const identityPath = await writeIdentityJson({
      deviceId: DEVICE_ID,
      publicKeyPem: PUBLIC_KEY_PEM,
      privateKeyPem: "-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----\n"
    });

    await expect(loadOpenClawDeviceSeed(identityPath)).rejects.toThrow(/unexpected PKCS8 length/);
  });
});

describe("OpenClaw paired token loading", () => {
  it("loads the operator token for the exact device id", async () => {
    const pairedPath = await tempFile("koko-openclaw-paired-", "paired.json");
    await writeFile(pairedPath, JSON.stringify({
      [DEVICE_ID]: {
        tokens: {
          operator: {
            token: "operator-token"
          }
        }
      }
    }), "utf8");

    await expect(loadOpenClawOperatorToken(DEVICE_ID, pairedPath)).resolves.toBe("operator-token");
  });

  it("throws when paired.json has no entry for the device id", async () => {
    const pairedPath = await tempFile("koko-openclaw-paired-missing-", "paired.json");
    await writeFile(pairedPath, JSON.stringify({ other: {} }), "utf8");

    await expect(loadOpenClawOperatorToken(DEVICE_ID, pairedPath)).rejects.toThrow(/no entry for deviceId/);
  });

  it("throws when the paired entry has no operator token", async () => {
    const pairedPath = await tempFile("koko-openclaw-paired-no-token-", "paired.json");
    await writeFile(pairedPath, JSON.stringify({ [DEVICE_ID]: { tokens: { operator: {} } } }), "utf8");

    await expect(loadOpenClawOperatorToken(DEVICE_ID, pairedPath)).rejects.toThrow(/no operator\.token/);
  });
});
