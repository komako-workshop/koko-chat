#!/usr/bin/env node
/**
 * Manual smoke helper: given a pairing QR URL (printed by `koko-cli start`
 * to stdout), simulate an APP that finishes pairing, connects to the same
 * relay as koko-cli, sends one encrypted chat.user envelope, and prints the
 * decrypted ECHO response.
 *
 * This script is intentionally separate from scripts/smoke-echo.mjs because
 * that one spins its own relay; this one attaches to a relay + cli that a
 * human already started.
 *
 * Usage:
 *   node scripts/smoke-attach-as-app.mjs \
 *     --relay http://localhost:8080 \
 *     --qr-url 'koko://pair?k=...' \
 *     --message 'hi'
 */
import { argv } from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import {
  initCrypto,
  generateEphemeralBoxKeypair,
  boxEncryptToPublicKey,
  symmetricEncrypt,
  symmetricDecrypt,
  decodePairingQrUrl,
  decodeEnvelope,
  PROTOCOL_VERSION
} from "@koko/protocol";

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      out[a.slice(2)] = args[i + 1];
      i++;
    }
  }
  return out;
}

function b64(bytes) { return Buffer.from(bytes).toString("base64"); }
function b64d(text) { return new Uint8Array(Buffer.from(text, "base64")); }
function b64url(bytes) { return Buffer.from(bytes).toString("base64url"); }
async function postJson(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
function openWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}
function waitFor(ws, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off("message", on); reject(new Error("timeout")); }, timeoutMs);
    const on = (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (predicate(parsed)) { clearTimeout(timer); ws.off("message", on); resolve(parsed); }
      } catch {}
    };
    ws.on("message", on);
  });
}

const SESSION_KEY = new Uint8Array(32).fill(42); // ⚠️ matches PLACEHOLDER in @koko/cli

async function main() {
  const args = parseArgs(argv.slice(2));
  const relayHttp = args.relay ?? "http://localhost:8080";
  const qrUrl = args["qr-url"];
  const message = args.message ?? "Hello from attached APP";
  if (!qrUrl) throw new Error("--qr-url <koko://pair?k=...> required");

  await initCrypto();
  const decodedQr = decodePairingQrUrl(qrUrl);
  const appBox = generateEphemeralBoxKeypair();
  console.log(`[app] relay=${relayHttp} qr k=${qrUrl.slice(-10)}... message="${message}"`);

  const pairResp = await postJson(`${relayHttp}/v1/pair/response`, {
    publicKey: b64url(decodedQr.publicKey),
    response: b64(boxEncryptToPublicKey(appBox.publicKey, decodedQr.publicKey))
  });
  if (pairResp.status !== 200) throw new Error(`pair/response HTTP ${pairResp.status}: ${JSON.stringify(pairResp.body)}`);
  const roomId = pairResp.body.roomId;
  console.log(`[app] paired, roomId=${roomId}`);

  const relayWs = relayHttp.replace(/^http/, "ws");
  const ws = await openWs(`${relayWs}/v1/room/${roomId}`);
  ws.send(JSON.stringify({ type: "hello", role: "app", roomId, protocolVersion: PROTOCOL_VERSION }));
  const hello = await waitFor(ws, (m) => m.type === "hello-ok" || m.type === "hello-error");
  if (hello.type !== "hello-ok") throw new Error(`hello failed: ${JSON.stringify(hello)}`);
  console.log(`[app] hello-ok, waiting for CLI to join...`);

  // Wait until CLI also joins (peer-joined event)
  await waitFor(ws, (m) => m.type === "peer-joined" && m.role === "cli", 5000);
  console.log(`[app] CLI joined`);

  // Send encrypted message
  const envelope = {
    v: PROTOCOL_VERSION,
    type: "chat.user",
    roomId,
    seq: 1,
    ts: Date.now(),
    payload: b64(symmetricEncrypt(new TextEncoder().encode(message), SESSION_KEY)),
    encrypted: true
  };
  ws.send(JSON.stringify({ type: "envelope", envelope }));
  console.log(`[app] -> envelope "${message}"`);

  // Collect delta chunks until final/error, or the legacy ECHO single message.
  const deltas = [];
  let finalText = null;
  let errorText = null;
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline && finalText === null && errorText === null) {
    const reply = await waitFor(ws, (m) => m.type === "envelope", 60_000);
    const decoded = decodeEnvelope(JSON.stringify(reply.envelope));
    const plainBytes = symmetricDecrypt(b64d(decoded.payload), SESSION_KEY);
    const plain = new TextDecoder().decode(plainBytes);

    // Try JSON first (OpenClaw mode), fall back to raw text (legacy ECHO mode).
    let parsed = null;
    try { parsed = JSON.parse(plain); } catch {}

    if (parsed && typeof parsed === "object" && "openclawMessage" in parsed) {
      const content = parsed.openclawMessage?.content;
      const text = Array.isArray(content)
        ? content.filter((b) => b && b.type === "text").map((b) => b.text ?? "").join("")
        : (parsed.openclawMessage?.text ?? "");
      if (decoded.type === "chat.agent.delta") {
        deltas.push(text);
        process.stdout.write(`[app] ∆ ${text.slice(deltas.slice(0,-1).join("").length)}`);
      } else if (decoded.type === "chat.agent.final") {
        finalText = text;
        console.log(`\n[app] ✓ final: "${text}"`);
      } else if (decoded.type === "chat.agent.error") {
        errorText = parsed.errorMessage ?? "(no message)";
        console.log(`\n[app] ✗ error: ${errorText}`);
      }
    } else {
      // Legacy ECHO bot output
      console.log(`[app] <- envelope "${plain}"`);
      finalText = plain;
      break;
    }
  }

  if (errorText !== null) throw new Error(`OpenClaw error: ${errorText}`);
  if (finalText === null) throw new Error("no final response received within 60s");

  console.log(`\n✅ Final text received from OpenClaw.`);

  ws.close();
  await delay(100);
}

main().catch((e) => {
  console.error("❌", e);
  process.exitCode = 1;
});
