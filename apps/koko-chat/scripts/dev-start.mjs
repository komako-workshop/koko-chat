#!/usr/bin/env node
/**
 * Dev launcher: a thin wrapper around `expo start` so `pnpm dev` /
 * `pnpm deeply:web` have a single stable entry point.
 *
 * KokoChat connects to OpenClaw exclusively through the relay tunnel — the
 * exact same path real users take. Pair once from the in-app "配对 OpenClaw"
 * screen and the device token persists across reloads; there is no LAN
 * shared-token auto-connect anymore. (Metro still serves the JS bundle over
 * the LAN via `--host lan`; that's unrelated to the Gateway connection.)
 */

import { spawn } from "node:child_process";

function main() {
  // Pass through any extra args after `--` (e.g. `-- --web`).
  const passthrough = process.argv.slice(2);

  if (process.env.KOKO_DEMO_APP) {
    console.log(`[koko-dev] demo mode: ${process.env.KOKO_DEMO_APP} (skips launcher)`);
  }

  const args = ["expo", "start", "--host", "lan", "--clear", ...passthrough];

  console.log(`[koko-dev] exec: pnpm exec ${args.join(" ")}`);
  const child = spawn("pnpm", ["exec", ...args], {
    stdio: "inherit",
    env: process.env
  });

  child.on("exit", (code) => process.exit(code ?? 0));
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
}

main();
