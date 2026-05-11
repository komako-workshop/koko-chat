#!/usr/bin/env node
/**
 * Live smoke test for the OpenClaw Gateway primitives used by
 * sources/runtime/openclaw.ts.
 *
 * This intentionally runs against the local OpenClaw Gateway via the public CLI
 * so it tests the same RPC methods KokoChat will call from the mobile app:
 * chat.send, agent.wait, chat.history, sessions.create, sessions.send, and
 * sessions.delete.
 *
 * Usage:
 *   node scripts/spike-openclaw-runtime.mjs
 *
 * Optional env:
 *   KOKO_TEST_GATEWAY_URL=ws://127.0.0.1:18789
 *   KOKO_TEST_GATEWAY_TOKEN=<token>
 */

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const gatewayUrl = process.env.KOKO_TEST_GATEWAY_URL ?? "ws://127.0.0.1:18789";
const gatewayToken = process.env.KOKO_TEST_GATEWAY_TOKEN ?? readGatewayToken();
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

if (!gatewayToken) {
  throw new Error(
    "No gateway token found. Set KOKO_TEST_GATEWAY_TOKEN or configure ~/.openclaw/openclaw.json."
  );
}

async function main() {
  console.log(`[spike] gateway=${gatewayUrl}`);
  await testInferOnceShape();
  await testAgentSessionShape();
  console.log("[spike] OpenClaw runtime smoke test passed");
}

async function testInferOnceShape() {
  const sessionKey = `agent:main:kokochat:oneshot:spike-${stamp}`;
  const runKey = `koko-runtime-oneshot-${stamp}`;
  console.log(`[spike] inferOnce via temporary session ${sessionKey}`);

  try {
    const send = await gatewayCall("chat.send", {
      sessionKey,
      message: "KokoChat runtime one-shot smoke test. Reply exactly: KOKO_RUNTIME_ONESHOT_OK",
      idempotencyKey: runKey,
      timeoutMs: 60_000
    });
    assert(send.runId === runKey, "chat.send returned unexpected runId");

    const status = await gatewayCall("agent.wait", { runId: runKey, timeoutMs: 60_000 }, 70_000);
    assert(status.status === "ok", `agent.wait status=${status.status}`);

    const history = await gatewayCall("chat.history", {
      sessionKey,
      limit: 6,
      maxChars: 1_000
    });
    const text = lastAssistantText(history.messages ?? []);
    assert(text === "KOKO_RUNTIME_ONESHOT_OK", `unexpected one-shot text: ${text}`);
  } finally {
    await gatewayCall("sessions.delete", { key: sessionKey });
    const described = await gatewayCall("sessions.describe", { key: sessionKey });
    assert(described.session === null, "temporary one-shot session was not deleted");
  }
}

async function testAgentSessionShape() {
  const sessionKey = `agent:main:kokochat:agent-session:spike-${stamp}`;
  const runKey = `koko-runtime-agent-${stamp}`;
  console.log(`[spike] stateful agent session ${sessionKey}`);

  try {
    const created = await gatewayCall("sessions.create", {
      key: sessionKey,
      agentId: "main",
      label: "KokoChat runtime smoke test"
    });
    assert(created.ok === true, "sessions.create did not return ok=true");
    assert(typeof created.sessionId === "string", "sessions.create did not return sessionId");

    const send = await gatewayCall("sessions.send", {
      key: sessionKey,
      message: "KokoChat stateful agent session smoke test. Reply exactly: KOKO_RUNTIME_AGENT_OK",
      idempotencyKey: runKey,
      timeoutMs: 60_000
    });
    assert(send.runId === runKey, "sessions.send returned unexpected runId");

    const status = await gatewayCall("agent.wait", { runId: runKey, timeoutMs: 60_000 }, 70_000);
    assert(status.status === "ok", `agent.wait status=${status.status}`);

    const history = await gatewayCall("chat.history", {
      sessionKey,
      limit: 6,
      maxChars: 1_000
    });
    const text = lastAssistantText(history.messages ?? []);
    assert(text === "KOKO_RUNTIME_AGENT_OK", `unexpected agent text: ${text}`);
  } finally {
    await gatewayCall("sessions.delete", { key: sessionKey });
    const described = await gatewayCall("sessions.describe", { key: sessionKey });
    assert(described.session === null, "stateful test session was not deleted");
  }
}

async function gatewayCall(method, params, timeoutMs = 20_000) {
  const { stdout } = await execFileAsync(
    "openclaw",
    [
      "gateway",
      "call",
      "--url",
      gatewayUrl,
      "--token",
      gatewayToken,
      method,
      "--json",
      "--timeout",
      String(timeoutMs),
      "--params",
      JSON.stringify(params)
    ],
    {
      timeout: timeoutMs + 10_000,
      env: {
        ...process.env,
        PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}`
      }
    }
  );
  return JSON.parse(stdout);
}

function lastAssistantText(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "assistant" && message?.role !== "agent") continue;
    if (typeof message.text === "string") return message.text.trim();
    if (!Array.isArray(message.content)) return "";
    return message.content
      .map((part) => (part?.type === "text" && typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }
  return "";
}

function readGatewayToken() {
  const configPath = join(process.env.HOME ?? "", ".openclaw", "openclaw.json");
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    return typeof parsed?.gateway?.auth?.token === "string" ? parsed.gateway.auth.token : null;
  } catch {
    return null;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

main().catch((error) => {
  console.error("[spike] failed", error);
  process.exit(1);
});
