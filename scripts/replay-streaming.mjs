#!/usr/bin/env node
/**
 * Replay 一轮 streaming chat events,模拟 host 在每个 delta 时刻
 * 写到 chat message 里的 text,直观看用户在 UI 上看到的演化。
 *
 * 输出每个有"显著新内容"的 delta(避免逐 token 噪音),展示:
 *   - 当前 wire fullText 长度 / fenced block 是否出现 / 出现位置
 *   - host 当前会写到 message.text 的 displayText
 *
 * 用法:
 *   node scripts/replay-streaming.mjs            # 用最新一个 final 之前的 delta 序列
 */
import { readFileSync } from "node:fs";

const FILE = process.argv[2] ?? "tmp-debug/koko-chat-events.jsonl";
const lines = readFileSync(FILE, "utf8").split("\n").filter(Boolean);
const events = lines.map((l) => JSON.parse(l)).filter((e) => e.kind === "wire");

// Find latest run: collect events between earliest delta of last runId and its final.
const runIdsInOrder = [];
const runIdSeen = new Set();
for (const ev of events) {
  const rid = ev.payload?.runId;
  if (typeof rid === "string" && !runIdSeen.has(rid)) {
    runIdSeen.add(rid);
    runIdsInOrder.push(rid);
  }
}
const lastRunId = runIdsInOrder[runIdsInOrder.length - 1];
console.log(`Latest runId: ${lastRunId}`);
const runEvents = events.filter((e) => e.payload?.runId === lastRunId);
console.log(`Events in this run: ${runEvents.length}`);

// dedup duplicate POSTs (双 tab):key = seq + state + textLen
const seenKey = new Set();
const deduped = [];
for (const ev of runEvents) {
  const content = ev.payload?.message?.content ?? [];
  const textLen = content
    .filter((b) => b?.type === "text")
    .reduce((acc, b) => acc + (b.text?.length ?? 0), 0);
  const key = `${ev.payload?.seq}-${ev.payload?.state}-${textLen}`;
  if (seenKey.has(key)) continue;
  seenKey.add(key);
  deduped.push(ev);
}
deduped.sort((a, b) => (a.payload?.seq ?? 0) - (b.payload?.seq ?? 0));
console.log(`After dedup: ${deduped.length}`);

const FENCE_OPEN = "```koko.deeply.research.outline";
const KP_RE = /\s*〔KP〕\s*/g;

function extractTextFromContent(content) {
  return content
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .filter((t) => t.length > 0)
    .join("\n\n")
    .replace(KP_RE, "\n\n")
    .trim();
}

function preview(text, max = 220) {
  const tail = text.slice(-max);
  return tail.replace(/\n/g, "⏎");
}

console.log("\n========== STREAMING TIMELINE ==========\n");
let lastFenceState = "none";
let lastReportedLen = 0;
for (let i = 0; i < deduped.length; i += 1) {
  const ev = deduped[i];
  const content = ev.payload?.message?.content ?? [];
  const text = extractTextFromContent(content);
  const fenceIdx = text.indexOf(FENCE_OPEN);
  const fenceState = fenceIdx < 0 ? "none" : "open";

  // Only print events where:
  //   - fenceState transitions
  //   - text length grew by >= 50 chars since last report
  //   - state is final
  const stateChanged = fenceState !== lastFenceState;
  const lenJump = text.length - lastReportedLen >= 50;
  const isFinal = ev.payload?.state === "final";
  if (!stateChanged && !lenJump && !isFinal) continue;

  console.log(
    `[seq=${String(ev.payload?.seq).padStart(4, " ")}] state=${ev.payload?.state.padEnd(6)} ` +
    `textLen=${text.length}  fence=${fenceState}${fenceIdx >= 0 ? ` @${fenceIdx}` : ""}`
  );
  console.log(`  tail: ${preview(text)}`);
  console.log("");

  lastFenceState = fenceState;
  lastReportedLen = text.length;
}

// Also dump final's full
const finalEv = deduped.findLast((e) => e.payload?.state === "final");
if (finalEv !== undefined) {
  const text = extractTextFromContent(finalEv.payload.message.content);
  const fenceIdx = text.indexOf(FENCE_OPEN);
  console.log("========== FINAL ==========");
  console.log(`textLen=${text.length}, fence opens @${fenceIdx}`);
  if (fenceIdx > 0) {
    console.log("\nprose-only portion (what user should see after transformer strips fenced):");
    console.log("---");
    console.log(text.slice(0, fenceIdx).trimEnd());
    console.log("---");
  }
}
