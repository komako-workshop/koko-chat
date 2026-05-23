#!/usr/bin/env node
/**
 * Local listener that the KokoChat web client POSTs every gateway `chat`
 * event to. Writes one JSON line per event to `tmp-debug/koko-chat-events.jsonl`
 * so we can replay it offline through host-side aggregation logic.
 *
 * Usage:
 *   node scripts/koko-event-dump-server.mjs
 *   # then run the demo in browser; events stream in
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const OUT_DIR = join(process.cwd(), "tmp-debug");
const OUT_FILE = join(OUT_DIR, "koko-chat-events.jsonl");
const PORT = 9999;

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, ""); // truncate at startup
console.log(`[dump] writing to ${OUT_FILE}`);

const server = createServer((req, res) => {
  // Always permit CORS so the web bundle (origin http://localhost:8081) can POST.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "POST" || req.url !== "/event") {
    res.statusCode = 404;
    res.end();
    return;
  }
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    appendFileSync(OUT_FILE, body.endsWith("\n") ? body : body + "\n");
    res.statusCode = 204;
    res.end();
    console.log(`[dump] +${body.length}B`);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[dump] listening on http://127.0.0.1:${PORT}/event`);
});
