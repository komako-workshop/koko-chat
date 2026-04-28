import { mkdtemp, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadOrCreateDeviceSeed } from "../src/identity";

describe("identity", () => {
  it("generates, persists, and reloads a 32-byte device seed with 0600 permissions", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "koko-cli-identity-"));
    const keyPath = path.join(dir, "device.key");

    const first = await loadOrCreateDeviceSeed(keyPath);
    expect(first.created).toBe(true);
    expect(first.seed.byteLength).toBe(32);

    const keyStat = await stat(keyPath);
    expect(keyStat.mode & 0o777).toBe(0o600);

    const second = await loadOrCreateDeviceSeed(keyPath);
    expect(second.created).toBe(false);
    expect(Buffer.from(second.seed).equals(Buffer.from(first.seed))).toBe(true);
  });

  it("throws when the seed file is not valid base64url", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "koko-cli-identity-invalid-"));
    const keyPath = path.join(dir, "device.key");
    await writeFile(keyPath, "not@@base64url\n");

    await expect(loadOrCreateDeviceSeed(keyPath)).rejects.toThrow(/base64url/);
  });
});
