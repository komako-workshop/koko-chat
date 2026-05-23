#!/usr/bin/env node
/**
 * Analyze the captured chat-event jsonl dumped from KokoChat web bundle.
 * Prints a summary timeline + the final aggregated message text to verify
 * how OpenClaw streams across multiple assistant messages.
 */
import { readFileSync } from "node:fs";

const FILE = process.argv[2] ?? "tmp-debug/koko-chat-events.jsonl";
const lines = readFileSync(FILE, "utf8").split("\n").filter((l) => l.trim().length > 0);

// Each line is JSON: { receivedAt, payload: { runId, sessionKey, seq, state, message: { content } } }
const parsed = lines
  .map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  })
  .filter((p) => p !== null);

console.log(`Captured ${parsed.length} raw events (lines)\n`);

// 去重(浏览器双 tab 会导致 events 重复 dump):用 receivedAt+seq+content[0].text-prefix 当 key。
const seen = new Set();
const events = [];
for (const e of parsed) {
  const seq = e.payload?.seq;
  const state = e.payload?.state;
  const contentLen = (e.payload?.message?.content ?? []).reduce(
    (acc, b) => acc + (b?.text?.length ?? 0),
    0
  );
  const key = `${seq}-${state}-${contentLen}`;
  if (seen.has(key)) continue;
  seen.add(key);
  events.push(e);
}
console.log(`After dedup (seq+state+contentLen): ${events.length}\n`);

function previewText(text, max = 100) {
  const collapsed = text.replace(/\n/g, "⏎").replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

// 按 seq 排序
events.sort((a, b) => (a.payload?.seq ?? 0) - (b.payload?.seq ?? 0));

console.log("========== TIMELINE ==========\n");
for (let i = 0; i < events.length; i += 1) {
  const e = events[i];
  const seq = e.payload?.seq;
  const state = e.payload?.state;
  const content = e.payload?.message?.content ?? [];
  const summary = content.map((b) => {
    if (b?.type === "text") return `text(len=${b.text?.length ?? 0})`;
    if (b?.type === "toolCall") return `toolCall(${b.name})`;
    if (b?.type === "toolResult") return `toolResult`;
    if (b?.type === "thinking") return `thinking`;
    return b?.type ?? "?";
  });
  console.log(`[seq=${String(seq).padStart(3, " ")}] state=${state.padEnd(6)} blocks=[${summary.join(", ")}]`);
  content
    .filter((b) => b?.type === "text")
    .forEach((b, idx) => {
      console.log(`         text[${idx}]: ${previewText(b.text ?? "")}`);
    });
}

// Final event 的完整 content
const finalEvent = events.findLast((e) => e.payload?.state === "final");
if (finalEvent !== undefined) {
  console.log("\n========== FINAL EVENT FULL CONTENT ==========\n");
  console.log(`seq=${finalEvent.payload?.seq}`);
  const content = finalEvent.payload?.message?.content ?? [];
  console.log(`Total blocks: ${content.length}`);
  content.forEach((b, idx) => {
    if (b?.type === "text") {
      console.log(`\n--- block[${idx}] type=text len=${(b.text ?? "").length} ---`);
      console.log(b.text);
    } else {
      console.log(`\n--- block[${idx}] type=${b?.type} ---`);
    }
  });
}
