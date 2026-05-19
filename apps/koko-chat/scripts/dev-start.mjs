#!/usr/bin/env node
/**
 * Dev convenience launcher.
 *
 * Wraps `expo start` so the running APP can auto-connect to the local
 * OpenClaw Gateway without making the user paste a setup code each time.
 *
 * Steps:
 *   1. Detect the local machine's LAN IP (so the phone can reach Gateway).
 *   2. Run `openclaw qr --json --no-ascii --url ws://<lan-ip>:18789` to get
 *      a fresh setupCode (TTL ~10 minutes).
 *   3. Inject the setupCode into the APP via env var
 *      KOKO_DEV_SETUP_CODE — read by app.config.js -> extra.devSetupCode.
 *   4. Exec `expo start --host lan --clear`.
 *
 * Production / TestFlight builds never see KOKO_DEV_SETUP_CODE since this
 * script is only run by `pnpm dev`.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { networkInterfaces } from "node:os";

function detectLanIp() {
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    const list = ifaces[name];
    if (!list) continue;
    for (const addr of list) {
      if (addr.family === "IPv4" && !addr.internal) {
        // Prefer 192.168.* / 10.* / 172.16-31 (private ranges).
        if (addr.address.startsWith("192.168.") || addr.address.startsWith("10.")) {
          return addr.address;
        }
      }
    }
  }
  // Fall back to first non-loopback IPv4 even if not in private range.
  for (const name of Object.keys(ifaces)) {
    const list = ifaces[name];
    if (!list) continue;
    for (const addr of list) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }
  return null;
}

function readGatewayToken() {
  const configPath = join(process.env.HOME ?? "", ".openclaw", "openclaw.json");
  try {
    const raw = readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    const token = parsed?.gateway?.auth?.token;
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch (err) {
    console.warn(`[koko-dev] failed to read ${configPath}: ${err.message}`);
    return null;
  }
}

function main() {
  const lanIp = detectLanIp();
  if (lanIp === null) {
    console.warn("[koko-dev] could not detect LAN IP; expo will use defaults");
  } else {
    console.log(`[koko-dev] detected LAN IP: ${lanIp}`);
  }

  const env = { ...process.env };
  if (lanIp !== null) {
    env.KOKO_DEV_GATEWAY_URL = `ws://${lanIp}:18789`;
    const gatewayToken = readGatewayToken();
    if (gatewayToken !== null) {
      env.KOKO_DEV_GATEWAY_TOKEN = gatewayToken;
      console.log(
        `[koko-dev] using local gateway token (${gatewayToken.slice(0, 6)}...), gateway=${env.KOKO_DEV_GATEWAY_URL}`
      );
    } else {
      console.warn("[koko-dev] no gateway token found; APP will start without auto-connect");
    }
  }

  // Pass through any extra args after `--`.
  const passthrough = process.argv.slice(2);
  const args = ["expo", "start", "--host", "lan", "--clear", ...passthrough];

  console.log(`[koko-dev] exec: pnpm exec ${args.join(" ")}`);
  const child = spawn("pnpm", ["exec", ...args], {
    stdio: "inherit",
    env
  });

  child.on("exit", (code) => process.exit(code ?? 0));
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
}

main();
