import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readMainSession } from "../src/openclaw";

async function writeNodeExecutable(script: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "koko-openclaw-bin-"));
  const filePath = path.join(dir, "openclaw");
  await writeFile(filePath, `#!/usr/bin/env node\n${script}\n`, "utf8");
  await chmod(filePath, 0o700);
  return filePath;
}

describe("OpenClaw session lookup", () => {
  it("returns the agent:main:main session from openclaw sessions JSON", async () => {
    const openclawBinary = await writeNodeExecutable(`
process.stderr.write("Config warnings\\n");
console.log(JSON.stringify({
  sessions: [
    { key: "agent:other:main", sessionId: "ignored" },
    { key: "agent:main:main", sessionId: "bdb0f457-0000-4000-8000-000000000000", model: "claude" }
  ]
}));
`);

    await expect(readMainSession({ openclawBinary })).resolves.toEqual({
      sessionKey: "agent:main:main",
      sessionId: "bdb0f457-0000-4000-8000-000000000000",
      model: "claude"
    });
  });

  it("throws when stdout does not include agent:main:main", async () => {
    const openclawBinary = await writeNodeExecutable(`
console.log(JSON.stringify({ sessions: [{ key: "agent:other:main", sessionId: "ignored" }] }));
`);

    await expect(readMainSession({ openclawBinary })).rejects.toThrow(/no agent:main:main session found/);
  });

  it("throws when the sessions command times out", async () => {
    const openclawBinary = await writeNodeExecutable(`
setTimeout(() => undefined, 1_000);
`);

    await expect(readMainSession({ openclawBinary, timeoutMs: 20 })).rejects.toThrow(/timed out/);
  });

  it("throws when stdout is not valid JSON", async () => {
    const openclawBinary = await writeNodeExecutable(`
console.log("not-json");
`);

    await expect(readMainSession({ openclawBinary })).rejects.toThrow(/invalid JSON/);
  });
});
