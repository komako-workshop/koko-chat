#!/usr/bin/env node
/**
 * 读 tmp-debug/koko-chat-events.jsonl,找最后一条 history 事件,
 * 打印每条 message 的 role + text(裁短)。再尝试用 deeply 的
 * parseDeeplyResearchOutline 解析最后一条 agent message 的 outline。
 */
import fs from "node:fs";
import path from "node:path";

const file = path.resolve("tmp-debug/koko-chat-events.jsonl");
const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);

// 找最后一条 history
let lastHistory = null;
for (let i = lines.length - 1; i >= 0; i -= 1) {
  try {
    const o = JSON.parse(lines[i]);
    if (o.kind === "history") {
      lastHistory = o;
      break;
    }
  } catch {}
}
if (lastHistory === null) {
  console.log("no history event in dump");
  process.exit(1);
}

console.log("history at", new Date(lastHistory.receivedAt).toISOString());

// payload shape:OpenClaw chat.history 返回 { messages: [...] } 或者 直接是 array
const payload = lastHistory.payload ?? {};
const messages = Array.isArray(payload.messages)
  ? payload.messages
  : Array.isArray(payload)
    ? payload
    : Array.isArray(payload.history)
      ? payload.history
      : null;

if (messages === null) {
  console.log("payload not recognized:", JSON.stringify(payload).slice(0, 500));
  process.exit(1);
}

console.log(`messages: ${messages.length}`);

let lastAgentText = "";
for (const m of messages) {
  const role = m.role ?? m.author ?? "?";
  const text = typeof m.text === "string"
    ? m.text
    : Array.isArray(m.parts)
      ? m.parts.map((p) => p.text ?? "").join("")
      : "";
  const preview = text.slice(0, 200).replace(/\n/g, "\\n");
  console.log(`---[${role}] len=${text.length}---`);
  console.log(preview);
  if (role === "agent" || role === "assistant") lastAgentText = text;
}

console.log("\n=== last agent text full length:", lastAgentText.length);
console.log("=== first 800 chars ===");
console.log(lastAgentText.slice(0, 800));
console.log("\n=== last 800 chars ===");
console.log(lastAgentText.slice(-800));

const fenceMatch = lastAgentText.match(/```koko\.deeply\.research\.outline\s*\n([\s\S]*?)\n```/);
if (fenceMatch === null) {
  console.log("\n!!! no koko.deeply.research.outline fenced block found");
} else {
  const body = fenceMatch[1];
  console.log("\n=== fenced block body (len " + body.length + ") first 1500 chars ===");
  console.log(body.slice(0, 1500));
  try {
    const parsed = JSON.parse(body);
    console.log("\n=== parsed JSON ok ===");
    console.log("courseTitle:", parsed.courseTitle);
    console.log("introduction len:", (parsed.introduction ?? "").length);
    console.log("sections count:", (parsed.sections ?? []).length);
    if (Array.isArray(parsed.sections)) {
      for (const s of parsed.sections) {
        const sources = Array.isArray(s.sources) ? s.sources : [];
        console.log(`  - [${s.index}] ${s.title} - sources=${sources.length}`);
        for (const src of sources) {
          console.log(`      [${src.stance}] ${src.title} - ${src.url}`);
          console.log(`        ${(src.snippet ?? "").slice(0, 80)}`);
        }
      }
    }
  } catch (err) {
    console.log("\n!!! JSON parse failed:", err.message);
  }
}
