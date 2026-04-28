#!/usr/bin/env node
/**
 * Echo smoke: verify @koko/protocol + @koko/relay end-to-end.
 *
 * What this proves:
 * - CLI + APP can complete pairing over relay HTTP API
 * - relay hands out a roomId
 * - both parties can connect WebSocket /v1/room/:roomId with hello handshake
 * - envelope round-trips through relay
 * - symmetric-encrypted payload (XChaCha20-Poly1305) is opaque to relay
 *
 * What this deliberately does NOT prove:
 * - key exchange protocol (both parties use a hardcoded shared test key; real
 *   flow will have CLI generate machineKey and box-encrypt it to APP's
 *   pubKey — see Task 03b/04)
 * - persistence / reconnect
 * - OpenClaw Gateway integration (next: wire in @koko/openclaw-client in 03c)
 *
 * Run: node scripts/smoke-echo.mjs
 */
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";

import {
  initCrypto,
  generateMasterSecret,
  generateEphemeralBoxKeypair,
  boxEncryptToPublicKey,
  boxDecryptWithSecretKey,
  symmetricEncrypt,
  symmetricDecrypt,
  encodeEnvelope,
  decodeEnvelope,
  encodePairingQrUrl,
  decodePairingQrUrl,
  PROTOCOL_VERSION
} from "@koko/protocol";
import { createRelayServer } from "@koko/relay";

// A minimal logger that satisfies @koko/relay's pino-compatible Logger shape.
// We don't pull in real pino here because this script isn't a workspace package.
function noopMethod() {}
const silentLogger = {
  level: "silent",
  trace: noopMethod, debug: noopMethod, info: noopMethod, warn: noopMethod, error: noopMethod, fatal: noopMethod,
  child() { return silentLogger; },
  isLevelEnabled() { return false; },
  bindings() { return {}; },
  silent: noopMethod
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function base64urlEncode(bytes) {
  return Buffer.from(bytes).toString("base64url");
}
function base64urlDecode(text) {
  return new Uint8Array(Buffer.from(text, "base64url"));
}
function b64Encode(bytes) {
  return Buffer.from(bytes).toString("base64");
}
function b64Decode(text) {
  return new Uint8Array(Buffer.from(text, "base64"));
}

async function httpJson(url, method, body) {
  const init = { method, headers: { "content-type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

/** Waits for a single message matching predicate, with timeout. */
function waitForMessage(ws, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error("waitForMessage timed out"));
    }, timeoutMs);
    const onMessage = (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (predicate(parsed)) {
          clearTimeout(timer);
          ws.off("message", onMessage);
          resolve(parsed);
        }
      } catch {
        // ignore malformed
      }
    };
    ws.on("message", onMessage);
  });
}

function openWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error("ws open timed out")), 2000);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function main() {
  console.log("=== KokoChat echo smoke ===\n");
  await initCrypto();

  // 1. Start relay
  const relay = createRelayServer({
    port: 0,
    host: "127.0.0.1",
    logger: silentLogger,
    pairingTtlMs: 300_000,
    roomTtlMs: 86_400_000,
    roomOfflineQueueMax: 1000,
    roomOfflineQueueTtlMs: 86_400_000
  });
  const { address, port } = await relay.listen();
  const baseUrl = `http://${address}:${port}`;
  const wsBaseUrl = `ws://${address}:${port}`;
  console.log(`[relay]   listening ${baseUrl}`);

  try {
    // 2. APP side setup: master secret + box keypair
    const appMasterSecret = generateMasterSecret();
    const appBoxKeypair = generateEphemeralBoxKeypair();
    console.log(`[app]     generated master secret (${appMasterSecret.length}B) and box keypair`);

    // 3. CLI side setup: ephemeral box keypair for pairing
    const cliEphKeypair = generateEphemeralBoxKeypair();
    console.log(`[cli]     generated ephemeral box keypair for pairing`);

    // 4. CLI publishes pairing request (encodes QR URL for APP)
    const cliEphPubB64url = base64urlEncode(cliEphKeypair.publicKey);
    const qrUrl = encodePairingQrUrl(cliEphKeypair.publicKey);
    console.log(`[cli]     QR URL: ${qrUrl.slice(0, 40)}…`);

    const pairReq1 = await httpJson(`${baseUrl}/v1/pair/request`, "POST", {
      publicKey: cliEphPubB64url,
      supportsProtocol: PROTOCOL_VERSION
    });
    console.log(`[cli]     POST /v1/pair/request -> ${pairReq1.status}`, pairReq1.body);
    if (pairReq1.status !== 200 || pairReq1.body.state !== "pending") throw new Error("pair/request 1 not pending");

    // 5. APP scans QR, builds encrypted bundle (APP's box publicKey encrypted to CLI's ephemeral pubkey),
    //    POSTs to /v1/pair/response. relay issues a roomId.
    const decodedQr = decodePairingQrUrl(qrUrl);
    const bundle = boxEncryptToPublicKey(appBoxKeypair.publicKey, decodedQr.publicKey);
    const bundleB64 = b64Encode(bundle);
    const pairResp = await httpJson(`${baseUrl}/v1/pair/response`, "POST", {
      publicKey: cliEphPubB64url,
      response: bundleB64
    });
    console.log(`[app]     POST /v1/pair/response -> ${pairResp.status}`, pairResp.body);
    if (pairResp.status !== 200 || typeof pairResp.body.roomId !== "string") throw new Error("pair/response failed");
    const roomId = pairResp.body.roomId;
    console.log(`[relay]   assigned roomId ${roomId}`);

    // 6. CLI polls again -> state=authorized, gets response bundle, decrypts APP's pubkey
    const pairReq2 = await httpJson(`${baseUrl}/v1/pair/request`, "POST", {
      publicKey: cliEphPubB64url,
      supportsProtocol: PROTOCOL_VERSION
    });
    if (pairReq2.body.state !== "authorized") throw new Error("pair/request 2 not authorized");
    const recvBundle = b64Decode(pairReq2.body.response);
    const decryptedAppPub = boxDecryptWithSecretKey(recvBundle, cliEphKeypair.secretKey);
    console.log(`[cli]     decrypted APP pubKey, matches: ${Buffer.from(decryptedAppPub).equals(Buffer.from(appBoxKeypair.publicKey))}`);
    if (!Buffer.from(decryptedAppPub).equals(Buffer.from(appBoxKeypair.publicKey))) {
      throw new Error("decrypted pubkey mismatch");
    }

    // 7. Both connect to ws /v1/room/:roomId
    const appWs = await openWs(`${wsBaseUrl}/v1/room/${roomId}`);
    const cliWs = await openWs(`${wsBaseUrl}/v1/room/${roomId}`);

    // hello handshake
    appWs.send(JSON.stringify({ type: "hello", role: "app", roomId, protocolVersion: PROTOCOL_VERSION }));
    const appHelloAck = await waitForMessage(appWs, (m) => m.type === "hello-ok" || m.type === "hello-error");
    if (appHelloAck.type !== "hello-ok") throw new Error(`app hello failed: ${JSON.stringify(appHelloAck)}`);

    cliWs.send(JSON.stringify({ type: "hello", role: "cli", roomId, protocolVersion: PROTOCOL_VERSION }));
    const cliHelloAck = await waitForMessage(cliWs, (m) => m.type === "hello-ok" || m.type === "hello-error");
    if (cliHelloAck.type !== "hello-ok") throw new Error(`cli hello failed: ${JSON.stringify(cliHelloAck)}`);
    console.log(`[ws]      both sides hello-ok`);

    // 8. HARDCODED session key for this smoke (real protocol: CLI generates machineKey
    //    and box-encrypts to APP's pubkey — out of scope here, see DECISIONS.md)
    const sessionKey = new Uint8Array(32);
    sessionKey.fill(42);

    // 9. APP sends an encrypted envelope, CLI decrypts, CLI echoes back
    const userMessage = "Hello from APP! 你好 OpenClaw 🦞";
    const encryptedUser = symmetricEncrypt(textEncoder.encode(userMessage), sessionKey);
    const appEnvelope = {
      v: 1,
      type: "chat.user",
      roomId,
      seq: 1,
      ts: Date.now(),
      payload: b64Encode(encryptedUser),
      encrypted: true
    };

    appWs.send(JSON.stringify({ type: "envelope", envelope: appEnvelope }));
    console.log(`[app]     -> envelope seq=1 payload=<encrypted ${encryptedUser.length}B>`);

    const cliRecv = await waitForMessage(cliWs, (m) => m.type === "envelope");
    const cliRecvEnvelope = decodeEnvelope(JSON.stringify(cliRecv.envelope));
    const cliDecrypted = symmetricDecrypt(b64Decode(cliRecvEnvelope.payload), sessionKey);
    console.log(`[cli]     <- envelope seq=${cliRecvEnvelope.seq} decrypted: "${textDecoder.decode(cliDecrypted)}"`);

    // 10. CLI responds (echo bot)
    const echoMessage = `ECHO: ${textDecoder.decode(cliDecrypted)}`;
    const encryptedEcho = symmetricEncrypt(textEncoder.encode(echoMessage), sessionKey);
    const cliEnvelope = {
      v: 1,
      type: "chat.agent.final",
      roomId,
      seq: 2,
      ts: Date.now(),
      payload: b64Encode(encryptedEcho),
      encrypted: true
    };
    cliWs.send(JSON.stringify({ type: "envelope", envelope: cliEnvelope }));
    console.log(`[cli]     -> envelope seq=2 payload=<encrypted ${encryptedEcho.length}B>`);

    const appRecv = await waitForMessage(appWs, (m) => m.type === "envelope");
    const appRecvEnvelope = decodeEnvelope(JSON.stringify(appRecv.envelope));
    const appDecrypted = symmetricDecrypt(b64Decode(appRecvEnvelope.payload), sessionKey);
    console.log(`[app]     <- envelope seq=${appRecvEnvelope.seq} decrypted: "${textDecoder.decode(appDecrypted)}"`);

    // 11. Verify round-trip
    if (textDecoder.decode(appDecrypted) !== echoMessage) {
      throw new Error("echo round-trip mismatch");
    }
    console.log(`\n✅ Echo smoke passed.`);
    console.log(`   - pairing (QR encode → HTTP request → response → authorize): OK`);
    console.log(`   - WebSocket hello handshake (both roles): OK`);
    console.log(`   - envelope forwarding (APP→CLI, CLI→APP): OK`);
    console.log(`   - XChaCha20-Poly1305 symmetric round-trip: OK`);
    console.log(`   - relay sees only ciphertext (payload is base64 of encrypted bundle): OK`);

    // 12. Cleanup
    appWs.close();
    cliWs.close();
    await delay(100);
  } finally {
    await relay.close();
    console.log(`[relay]   closed`);
  }
}

main().catch((error) => {
  console.error("\n❌ smoke failed:", error);
  process.exitCode = 1;
});
