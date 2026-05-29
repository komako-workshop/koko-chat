#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { WebSocket } from "../packages/koko-openclaw-client/node_modules/ws/wrapper.mjs";
import {
  DEFAULT_ROLE,
  DEFAULT_SCOPES,
  buildConnectParams,
  deriveDeviceIdentity,
  generateDeviceSeed
} from "../packages/koko-openclaw-client/dist/protocol.js";

const DEFAULT_OPENCLAW_HOST = "47.237.5.255";
const DEFAULT_PASSWORD_FILE = "/Users/lijianren/openclaw-aliyun-kokochat/ecs-login-password.txt";
const DEFAULT_KNOWN_HOSTS = "/Users/lijianren/.ssh/known_hosts_openclaw_kokochat";
const DEFAULT_REMOTE_PAIRING_SCRIPT =
  "/root/.kokochat/koko-chat/openclaw/skills/kokochat-pairing/generate-kokochat-code.mjs";
const DEFAULT_RELAY_HEALTH_URL = "http://47.84.141.40:8787/healthz";
const DEFAULT_ALIYUN_REGION = "ap-southeast-1";
const DEFAULT_ALIYUN_INSTANCE_ID = "i-t4n0481v1pkop5imukas";

const args = parseArgs(process.argv.slice(2));
const runId = args.runId ?? randomUUID().slice(0, 8);
const host = args.host ?? DEFAULT_OPENCLAW_HOST;
const passwordFile = args.passwordFile ?? DEFAULT_PASSWORD_FILE;
const knownHosts = args.knownHosts ?? DEFAULT_KNOWN_HOSTS;
const remotePairingScript = args.remotePairingScript ?? DEFAULT_REMOTE_PAIRING_SCRIPT;
const relayHealthUrl = args.relayHealthUrl ?? DEFAULT_RELAY_HEALTH_URL;

const checks = [];

async function main() {
  requireFile(passwordFile, "password file");
  if ((args.pairVia ?? "ssh") === "ssh") {
    requireFile(knownHosts, "known_hosts file");
  }

  await checkRelayHealth();
  const pair = await pairFreshDevice();
  const gateway = new GatewayHarness({
    url: pair.setup.url,
    deviceSeed: pair.deviceSeed,
    deviceToken: pair.setup.deviceToken
  });

  try {
    await gateway.connect();
    pass("device-token gateway handshake");

    await assertAdminDeleteScope(gateway);
    await assertSessionRestore(gateway);
  } finally {
    await gateway.close();
  }

  console.log("");
  console.log(`[ok] ${checks.length} regression checks passed (${checks.join(", ")})`);
}

async function checkRelayHealth() {
  if (relayHealthUrl.length === 0) return;
  const response = await fetch(relayHealthUrl);
  if (!response.ok) {
    throw new Error(`relay health failed: HTTP ${response.status}`);
  }
  const body = await response.json();
  if (body?.ok !== true || body?.status !== "live") {
    throw new Error(`relay health payload not live: ${JSON.stringify(body)}`);
  }
  pass("relay health");
}

async function pairFreshDevice() {
  const deviceSeed = generateDeviceSeed();
  const identity = await deriveDeviceIdentity(deviceSeed);
  const request = {
    type: "kokochat.pairingRequest",
    version: 1,
    deviceId: identity.deviceId,
    publicKey: identity.publicKey,
    role: DEFAULT_ROLE,
    scopes: [...DEFAULT_SCOPES],
    client: {
      id: "openclaw-ios",
      version: "0.0.1-regression",
      platform: "ios",
      mode: "ui",
      displayName: "KokoChat Regression"
    }
  };
  const requestCode = encodeJson(request);
  const setupCode = runRemotePairing(requestCode).trim();
  const setup = decodeJson(setupCode);
  if (!isRecord(setup) || typeof setup.url !== "string" || typeof setup.deviceToken !== "string") {
    throw new Error(`pairing script returned invalid setup code`);
  }
  if (args.allowDirect !== true) {
    if (!isRecord(setup.relay) || setup.relay.mode !== "gateway-tunnel") {
      throw new Error("setup code did not use the KokoChat gateway relay tunnel");
    }
  }
  if (!Array.isArray(request.scopes) || !request.scopes.includes("operator.admin")) {
    throw new Error("regression pairing request did not include operator.admin");
  }
  pass("fresh pairing code");
  return { request, requestCode, setup, setupCode, deviceSeed };
}

function runRemotePairing(requestCode) {
  if (args.pairVia === "aliyun") {
    return runRemotePairingViaAliyun(requestCode);
  }
  const script = [
    "log_user 0",
    "set timeout 180",
    `set pass [exec cat ${quoteTcl(passwordFile)}]`,
    `set request ${quoteTcl(requestCode)}`,
    `set remote_script ${quoteTcl(remotePairingScript)}`,
    "set code \"\"",
    "set cmd \"KOKOCHAT_PAIRING_REQUEST='$request' node $remote_script\"",
    [
      "spawn ssh",
      "-o StrictHostKeyChecking=no",
      "-o PubkeyAuthentication=no",
      "-o PreferredAuthentications=password",
      `-o UserKnownHostsFile=${knownHosts}`,
      `root@${host}`,
      "$cmd"
    ].join(" "),
    "expect {",
    "  -re \"Are you sure you want to continue connecting\" { send \"yes\\r\"; exp_continue }",
    "  -re \"assword:\" { send \"$pass\\r\"; exp_continue }",
    "  -re {([A-Za-z0-9_-]{80,})} { set code $expect_out(1,string); exp_continue }",
    "  eof",
    "}",
    "puts $code"
  ].join("\n");
  return execFileSync("expect", ["-c", script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function runRemotePairingViaAliyun(requestCode) {
  const region = args.aliyunRegion ?? DEFAULT_ALIYUN_REGION;
  const instanceId = args.aliyunInstanceId ?? DEFAULT_ALIYUN_INSTANCE_ID;
  const command = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `KOKOCHAT_PAIRING_REQUEST='${requestCode}' node ${shellQuote(remotePairingScript)}`
  ].join("\n");
  const run = JSON.parse(execFileSync("aliyun", [
    "ecs",
    "RunCommand",
    "--RegionId",
    region,
    "--Type",
    "RunShellScript",
    "--InstanceId.1",
    instanceId,
    "--ContentEncoding",
    "Base64",
    "--CommandContent",
    Buffer.from(command, "utf8").toString("base64"),
    "--KeepCommand",
    "false"
  ], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024
  }));
  const invokeId = run.InvokeId;
  if (typeof invokeId !== "string" || invokeId.length === 0) {
    throw new Error(`Aliyun RunCommand did not return InvokeId: ${JSON.stringify(run)}`);
  }

  for (let i = 0; i < 60; i += 1) {
    const result = JSON.parse(execFileSync("aliyun", [
      "ecs",
      "DescribeInvocationResults",
      "--RegionId",
      region,
      "--InvokeId",
      invokeId,
      "--ContentEncoding",
      "PlainText"
    ], {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024
    }));
    const item = result?.Invocation?.InvocationResults?.InvocationResult?.[0];
    if (item?.InvokeRecordStatus === "Finished") {
      if (Number(item.ExitCode) !== 0) {
        throw new Error(`Aliyun pairing command failed exit=${item.ExitCode}: ${item.Output ?? item.ErrorInfo ?? ""}`);
      }
      return String(item.Output ?? "");
    }
    sleepSync(1000);
  }
  throw new Error(`timed out waiting for Aliyun pairing command ${invokeId}`);
}

async function assertAdminDeleteScope(gateway) {
  const key = `agent:koko:kokochat:koko:regression-delete-${runId}`;
  const payload = await gateway.call("sessions.delete", { key }, 30_000);
  if (payload.ok !== true) {
    throw new Error(`sessions.delete did not return ok=true: ${JSON.stringify(payload)}`);
  }
  pass("operator.admin sessions.delete");
}

async function assertSessionRestore(gateway) {
  const phrase = `KOKO_RESTORE_${runId.toUpperCase()}`;
  const sessionKey = `agent:koko:kokochat:koko:regression-restore-${runId}`;
  await gateway.call("sessions.delete", { key: sessionKey }, 30_000).catch(() => undefined);

  const restoreMessage = [
    "KokoChat session restore.",
    "The phone has local conversation history, but this OpenClaw session is empty or missing.",
    "Use the transcript below as prior context. Do not mention this restoration to the user.",
    "Continue naturally and answer only the current turn that follows this restore block.",
    "",
    "<recent_transcript>",
    `User: Please remember this exact secret code: ${phrase}`,
    "Assistant: Got it.",
    "</recent_transcript>",
    "",
    "<current_kokochat_turn>",
    "What exact secret code did I ask you to remember? Reply with only that code.",
    "</current_kokochat_turn>"
  ].join("\n");

  const send = await gateway.call("chat.send", {
    sessionKey,
    message: restoreMessage,
    idempotencyKey: `koko-regression-${runId}`,
    timeoutMs: 180_000
  }, 240_000);
  if (typeof send.runId !== "string" || send.runId.length === 0) {
    throw new Error(`chat.send did not return runId: ${JSON.stringify(send)}`);
  }

  const status = await gateway.call("agent.wait", {
    runId: send.runId,
    timeoutMs: 180_000
  }, 240_000);
  if (status.status !== "ok") {
    throw new Error(`agent.wait did not finish ok: ${JSON.stringify(status)}`);
  }

  const history = await gateway.call("chat.history", {
    sessionKey,
    limit: 6,
    maxChars: 8_000
  }, 60_000);
  const text = extractLastAssistantText(history.messages);
  if (!text.includes(phrase)) {
    throw new Error(`restored session response missed phrase ${phrase}; got: ${text}`);
  }

  const cleanup = await gateway.call("sessions.delete", { key: sessionKey }, 60_000);
  if (cleanup.ok !== true) {
    throw new Error(`restore session cleanup failed: ${JSON.stringify(cleanup)}`);
  }
  pass("empty session restore");
}

class GatewayHarness {
  constructor({ url, deviceSeed, deviceToken }) {
    this.url = url;
    this.deviceSeed = deviceSeed;
    this.deviceToken = deviceToken;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.challenge = null;
    this.challengeWaiter = null;
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    this.ws.on("message", (data, isBinary) => {
      if (!isBinary) this.handleFrame(String(data));
    });
    await new Promise((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
    });

    const challenge = await this.waitForChallenge();
    const built = await buildConnectParams({
      deviceToken: this.deviceToken,
      deviceSeed: this.deviceSeed,
      nonce: challenge.nonce,
      client: {
        id: "openclaw-ios",
        version: "0.0.1-regression",
        platform: "ios",
        mode: "ui"
      },
      role: DEFAULT_ROLE,
      scopes: [...DEFAULT_SCOPES]
    });
    const hello = await this.call("connect", built.params, 30_000);
    if (hello.type !== "hello-ok") {
      throw new Error(`connect did not return hello-ok: ${JSON.stringify(hello)}`);
    }
  }

  call(method, params, timeoutMs = 60_000) {
    if (this.ws === null || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("gateway websocket is not open"));
    }
    const id = `reg-${this.nextId++}`;
    const frame = params === undefined ? { type: "req", id, method } : { type: "req", id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`request ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.ws.send(JSON.stringify(frame));
    });
  }

  waitForChallenge() {
    if (this.challenge !== null) return Promise.resolve(this.challenge);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for connect.challenge")), 30_000);
      this.challengeWaiter = {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        }
      };
    });
  }

  handleFrame(text) {
    const frame = JSON.parse(text);
    if (frame.type === "event" && frame.event === "connect.challenge") {
      this.challenge = frame.payload;
      if (this.challengeWaiter !== null) {
        this.challengeWaiter.resolve(frame.payload);
        this.challengeWaiter = null;
      }
      return;
    }
    if (frame.type !== "res") return;
    const pending = this.pending.get(frame.id);
    if (pending === undefined) return;
    clearTimeout(pending.timer);
    this.pending.delete(frame.id);
    if (frame.ok === true) {
      pending.resolve(frame.payload ?? {});
    } else {
      const err = new Error(frame.error?.message ?? `${pending.method} failed`);
      err.code = frame.error?.code;
      pending.reject(err);
    }
  }

  async close() {
    if (this.ws === null) return;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 200);
      this.ws.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      this.ws.close(1000, "regression done");
    });
    this.ws = null;
  }
}

function extractLastAssistantText(messages) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!isRecord(message)) continue;
    if (message.role !== "assistant" && message.role !== "agent") continue;
    if (typeof message.text === "string") return message.text;
    const content = message.content;
    if (!Array.isArray(content)) return "";
    return content
      .map((part) => (isRecord(part) && part.type === "text" && typeof part.text === "string" ? part.text : ""))
      .join("");
  }
  return "";
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeJson(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pass(name) {
  checks.push(name);
  console.log(`[ok] ${name}`);
}

function requireFile(path, label) {
  if (!existsSync(path)) throw new Error(`${label} not found: ${path}`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_m, ch) => ch.toUpperCase());
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  if (typeof out.passwordFile === "string") out.passwordFile = resolve(out.passwordFile);
  if (typeof out.knownHosts === "string") out.knownHosts = resolve(out.knownHosts);
  return out;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function sleepSync(ms) {
  spawnSync("sh", ["-c", `sleep ${Math.max(0, ms) / 1000}`], { stdio: "ignore" });
}

function quoteTcl(value) {
  return `{${String(value).replace(/\\/g, "\\\\").replace(/}/g, "\\}")}}`;
}

await main().catch((error) => {
  console.error(`[fail] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
