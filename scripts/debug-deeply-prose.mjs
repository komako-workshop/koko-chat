#!/usr/bin/env node
/**
 * Debug:从 OpenClaw deeply agent session jsonl 里把所有 assistant
 * text block 抠出来,模拟 KokoChat host 的两种 plausible 累积模型,
 * 输出最终 chat text,直观对比哪种模型符合用户实际看到的 prose 形态。
 *
 * Usage:
 *   node scripts/debug-deeply-prose.mjs                # picks latest session
 *   node scripts/debug-deeply-prose.mjs <session-id>   # specific session
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEEPLY_SESSIONS_DIR = join(homedir(), ".openclaw/agents/deeply/sessions");

function pickSessionFile(argv) {
  const idArg = argv[2];
  const files = readdirSync(DEEPLY_SESSIONS_DIR)
    .filter((f) => f.endsWith(".jsonl") && !f.endsWith(".trajectory.jsonl"))
    .map((f) => ({ name: f, mtime: statSync(join(DEEPLY_SESSIONS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (idArg !== undefined) {
    const hit = files.find((f) => f.name.startsWith(idArg));
    if (hit === undefined) {
      throw new Error(`No session jsonl starting with "${idArg}"`);
    }
    return join(DEEPLY_SESSIONS_DIR, hit.name);
  }
  if (files.length === 0) {
    throw new Error(`No sessions in ${DEEPLY_SESSIONS_DIR}`);
  }
  return join(DEEPLY_SESSIONS_DIR, files[0].name);
}

function readJsonl(path) {
  const text = readFileSync(path, "utf8");
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function previewText(text, max = 120) {
  const collapsed = text.replace(/\n/g, "⏎").replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

const sessionPath = pickSessionFile(process.argv);
console.log(`\n=== Session: ${sessionPath} ===\n`);

const events = readJsonl(sessionPath);

// 1. 列出所有 assistant message 的 content block 结构。
const assistantMessages = events.filter(
  (e) => e.type === "message" && e.message?.role === "assistant"
);
console.log(`Assistant messages in session: ${assistantMessages.length}\n`);

assistantMessages.forEach((msg, idx) => {
  const blocks = Array.isArray(msg.message?.content) ? msg.message.content : [];
  const summary = blocks.map((b) => {
    if (b.type === "text") return `text(len=${b.text?.length ?? 0})`;
    if (b.type === "thinking") return `thinking`;
    if (b.type === "toolCall") return `toolCall(${b.name})`;
    return b.type;
  });
  console.log(`[message ${idx + 1}] id=${msg.id} blocks=[${summary.join(", ")}]`);
  blocks
    .filter((b) => b.type === "text")
    .forEach((tb, i) => {
      console.log(`    text[${i}]: ${previewText(tb.text)}`);
    });
});

// 2. 复刻 KokoChat host 的 extractText(改了 join("\n\n") 之后的版本)。
function extractText(content) {
  return content
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .filter((t) => t.length > 0)
    .join("\n\n");
}

// 3. 三种 plausible wire-format 假设,分别算最终 chat message text:
//
//   model A (cumulative-final):wire 一次性给一个 final event,event 里 content
//       是整个 run 的所有 blocks(包括所有 message 的 text blocks)。
//       extractText 调一次,join("\n\n") 应当把所有 text block 用空行分隔。
//
//   model B (per-message replace):wire 每个 OpenClaw assistant message 推一个
//       chat event,host 用 `text: fullText` replace 整段 message text。
//       这种情况下用户最终只能看到最后一条 message 的 text(synthesis 段),
//       前面的 narration 全部丢失。 → 跟用户实际看到完整 narration 不符。
//
//   model C (per-message append):wire 每个 OpenClaw assistant message 推一个
//       chat event,host 把新 fullText append 到现有 text。
//       这种情况下分隔符是关键:append 时如果直接 concat,prose 都黏成一团;
//       如果 append 时加 "\n\n",段间就有空行。

console.log("\n=== Model A · cumulative-final(将所有 text block 合并成一个 final event)===");
const allBlocks = assistantMessages.flatMap((m) => (Array.isArray(m.message?.content) ? m.message.content : []));
const modelAText = extractText(allBlocks);
console.log(`final chat text (newline counts: \\n=${(modelAText.match(/\n/g) ?? []).length}, \\n\\n blocks=${modelAText.split("\n\n").length}):\n`);
console.log(modelAText.slice(0, 1200));
console.log(modelAText.length > 1200 ? "\n[…truncated…]" : "");

console.log("\n\n=== Model B · per-message replace(只保留最后一条 message text)===");
const lastMsgBlocks = Array.isArray(assistantMessages[assistantMessages.length - 1]?.message?.content)
  ? assistantMessages[assistantMessages.length - 1].message.content
  : [];
const modelBText = extractText(lastMsgBlocks);
console.log(`final chat text:\n`);
console.log(modelBText.slice(0, 1200));
console.log(modelBText.length > 1200 ? "\n[…truncated…]" : "");

console.log("\n\n=== Model C · per-message append with \"\\n\\n\"(每条 message 的 fullText 之间空行)===");
const modelCText = assistantMessages
  .map((m) => extractText(Array.isArray(m.message?.content) ? m.message.content : []))
  .filter((t) => t.length > 0)
  .join("\n\n");
console.log(`final chat text:\n`);
console.log(modelCText.slice(0, 1200));
console.log(modelCText.length > 1200 ? "\n[…truncated…]" : "");

console.log("\n\n=== Model C' · per-message append with empty string(直接 concat,**这是当前 host bug 假设**)===");
const modelCBugText = assistantMessages
  .map((m) => extractText(Array.isArray(m.message?.content) ? m.message.content : []))
  .filter((t) => t.length > 0)
  .join("");
console.log(`final chat text:\n`);
console.log(modelCBugText.slice(0, 1200));
console.log(modelCBugText.length > 1200 ? "\n[…truncated…]" : "");

console.log("\n");
