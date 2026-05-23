#!/usr/bin/env node
/**
 * Debug:standalone gateway client。直接跟本地 OpenClaw gateway 通信,
 * 发一条 research kickoff message 给 deeply agent,把所有 chat events
 * 的 wire JSON 打到 stdout。
 *
 * 这样可以**完全脱离 KokoChat 客户端 / 浏览器**,在 Node 里端到端
 * reproduce streaming 行为,看 host runtime 实际收到什么。
 *
 * Usage:
 *   node scripts/debug-gateway-stream.mjs "你的主题"
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

import { GatewayClient } from "../packages/koko-openclaw-client/dist/index.js";

const topic = process.argv[2] ?? "测试主题";

const config = JSON.parse(
  readFileSync(join(homedir(), ".openclaw/openclaw.json"), "utf8")
);
const token = config?.gateway?.auth?.token;
if (typeof token !== "string" || token.length === 0) {
  throw new Error("no gateway token in ~/.openclaw/openclaw.json");
}

const sessionScope = `debug-stream-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
const sessionKey = `agent:deeply:kokochat:deeply-course:research:${sessionScope}`;
const kickoff = [
  "[系统注入 · 深度调研课程 debug stream]",
  "",
  "按 kokochat-deeply-research skill 的流程办,最后输出一个 koko.deeply.research.outline fenced block。",
  "",
  "[用户消息]",
  `请围绕「${topic}」做一份 8 节的深度调研课程`
].join("\n");

const client = new GatewayClient({
  url: "ws://127.0.0.1:18789",
  token,
  client: { id: "webchat", version: "0.0.1", platform: "node", mode: "webchat" }
});

const events = [];
let runFinished = false;

client.on("chat", (payload) => {
  events.push({
    receivedAt: Date.now(),
    state: payload.state,
    runId: payload.runId,
    sessionKey: payload.sessionKey,
    content: Array.isArray(payload.message?.content)
      ? payload.message.content.map((b) => {
          if (b && b.type === "text") {
            return {
              type: "text",
              len: (b.text ?? "").length,
              preview: previewText(b.text ?? "")
            };
          }
          if (b && b.type === "toolCall") {
            return { type: "toolCall", name: b.name };
          }
          if (b && b.type === "toolResult") {
            return { type: "toolResult" };
          }
          if (b && b.type === "thinking") {
            return { type: "thinking" };
          }
          return { type: typeof b?.type === "string" ? b.type : "unknown" };
        })
      : null
  });
  if (payload.state === "final" || payload.state === "error") {
    runFinished = true;
  }
});

function previewText(text) {
  const collapsed = text.replace(/\n/g, "⏎").replace(/\s+/g, " ").trim();
  return collapsed.length <= 80 ? collapsed : `${collapsed.slice(0, 79)}…`;
}

console.log("[debug] connecting to ws://127.0.0.1:18789 ...");
await client.connect();
console.log("[debug] connected. creating session", sessionKey);

await client.call("sessions.create", {
  key: sessionKey,
  agentId: "deeply",
  label: "Koko debug research stream"
});

console.log("[debug] session created. sending kickoff...");
const sendResult = await client.call("chat.send", {
  sessionKey,
  message: kickoff,
  idempotencyKey: `debug-${Date.now()}`,
  timeoutMs: 300000
});
console.log("[debug] chat.send returned runId=", sendResult.runId);

console.log("[debug] waiting for events (max 4 min)...");
const startedAt = Date.now();
while (!runFinished && Date.now() - startedAt < 240_000) {
  await new Promise((r) => setTimeout(r, 500));
}

console.log("\n========== EVENT TIMELINE ==========\n");
for (let i = 0; i < events.length; i += 1) {
  const e = events[i];
  const dt = i === 0 ? 0 : e.receivedAt - events[i - 1].receivedAt;
  console.log(`[${String(i).padStart(3, "0")}] +${dt}ms  state=${e.state}  blocks=${e.content === null ? "null" : e.content.length}`);
  if (e.content !== null) {
    for (const b of e.content) {
      if (b.type === "text") {
        console.log(`        text(len=${b.len}): ${b.preview}`);
      } else if (b.type === "toolCall") {
        console.log(`        toolCall(${b.name})`);
      } else {
        console.log(`        ${b.type}`);
      }
    }
  }
}

console.log(`\n[debug] received ${events.length} chat events. cleaning up session...`);
try {
  await client.call("sessions.delete", { key: sessionKey });
} catch (err) {
  console.warn("[debug] sessions.delete failed:", err.message);
}

await client.disconnect();
process.exit(0);
