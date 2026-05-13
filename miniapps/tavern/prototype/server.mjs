#!/usr/bin/env node
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdirSync, readFile, readFileSync, writeFileSync } from "node:fs";
import { join, extname, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { getFirstMessage, getCharacterName } from "../roleplay/prompt.mjs";

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "public");
const FETCH_CARD_BIN = resolve(HERE, "../openclaw/skills/kokochat-tavern-search/bin/fetch-card.mjs");

const gatewayUrl = process.env.KOKO_TEST_GATEWAY_URL ?? "ws://127.0.0.1:18789";
const gatewayToken = process.env.KOKO_TEST_GATEWAY_TOKEN ?? readGatewayToken();
const port = Number(process.env.KOKO_TAVERN_PROTOTYPE_PORT ?? 8787);
const sessions = new Map();
const localizedFirstMessageCache = new Map();
const ROLEPLAY_WORKSPACE = join(process.env.HOME ?? "", ".openclaw/agents/tavern-roleplay/workspace");
const ROLEPLAY_CARDS_DIR = join(ROLEPLAY_WORKSPACE, "cards");

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method === "GET" && url.pathname === "/") return serveFile(res, "index.html");
    if (req.method === "GET" && url.pathname.startsWith("/public/")) {
      return serveFile(res, url.pathname.slice("/public/".length));
    }
    if (req.method === "POST" && url.pathname === "/api/load-card") {
      const body = await readJson(req);
      const card = await fetchCard(body);
      const firstMessage = await getLocalizedFirstMessage(card);
      return json(res, { ok: true, card, firstMessage });
    }
    if (req.method === "POST" && url.pathname === "/api/start") {
      const body = await readJson(req);
      const card = body.card ?? await fetchCard(body);
      const sessionId = `prototype-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const sessionKey = `agent:tavern-roleplay:kokochat:tavern-roleplay:${sessionId}`;
      const cardFile = writeCardFile(card);
      const firstMessage = await getLocalizedFirstMessage(card);
      sessions.set(sessionId, {
        sessionId,
        sessionKey,
        card,
        cardFile,
        messages: [{ role: "assistant", text: firstMessage }]
      });
      await ensureOpenClawSession(sessionKey, card, sessionId);
      const ready = await bootstrapRoleplaySession(sessions.get(sessionId));
      return json(res, { ok: true, sessionId, sessionKey, characterName: getCharacterName(card), firstMessage, ready });
    }
    if (req.method === "POST" && url.pathname === "/api/send") {
      const body = await readJson(req);
      const state = sessions.get(String(body.sessionId ?? ""));
      if (!state) return json(res, { ok: false, error: "unknown session" }, 404);
      const text = String(body.message ?? "").trim();
      if (!text) return json(res, { ok: false, error: "message is empty" }, 400);
      const reply = await sendRoleplayMessage(state, text);
      return json(res, { ok: true, reply, messages: state.messages });
    }
    if (req.method === "POST" && url.pathname === "/api/delete") {
      const body = await readJson(req);
      const state = sessions.get(String(body.sessionId ?? ""));
      if (state) {
        sessions.delete(state.sessionId);
        await gatewayCall("sessions.delete", { key: state.sessionKey }, 30_000);
      }
      return json(res, { ok: true });
    }
    return json(res, { ok: false, error: "not found" }, 404);
  } catch (error) {
    console.error("[prototype] request failed", error);
    return json(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

server.listen(port, () => {
  console.log(`[tavern prototype] http://127.0.0.1:${port}`);
});

async function fetchCard(input) {
  const params = input.path ? { path: input.path } : { pageUrl: input.pageUrl };
  const { stdout } = await execFileAsync("node", [FETCH_CARD_BIN, JSON.stringify(params)], { timeout: 30_000 });
  const parsed = JSON.parse(stdout);
  if (!parsed.ok) throw new Error(parsed.error ?? "fetch-card failed");
  return parsed.card;
}

function writeCardFile(card) {
  mkdirSync(ROLEPLAY_CARDS_DIR, { recursive: true });
  const fileName = `${safeCardId(card.path)}.json`;
  const fullPath = join(ROLEPLAY_CARDS_DIR, fileName);
  writeFileSync(fullPath, JSON.stringify(card, null, 2));
  return `cards/${fileName}`;
}

function safeCardId(path) {
  return String(path ?? "card").replace(/[^a-z0-9_-]+/gi, "__").replace(/^_+|_+$/g, "") || "card";
}

async function getLocalizedFirstMessage(card) {
  const raw = getFirstMessage(card);
  if (!raw.trim()) return raw;
  if (looksMostlyChinese(raw)) return raw;
  const cacheKey = `${card.path}:${raw.length}:${raw.slice(0, 80)}`;
  const cached = localizedFirstMessageCache.get(cacheKey);
  if (cached) return cached;
  const translated = await translateFirstMessage(card, raw).catch((error) => {
    console.warn("[prototype] first message translation failed", error instanceof Error ? error.message : String(error));
    return raw;
  });
  localizedFirstMessageCache.set(cacheKey, translated);
  return translated;
}

async function translateFirstMessage(card, firstMessage) {
  const charName = getCharacterName(card);
  const sessionKey = `agent:tavern-roleplay:kokochat:tavern-roleplay:translate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const prompt = [
    "把下面的角色开场白翻译成自然中文。",
    "要求：",
    "- 保留角色语气、动作描写、段落结构和 Markdown/斜体标记。",
    "- 人名、乐队名、地名、专有名词可保留原文。",
    "- 只输出译文，不要解释。",
    "",
    `角色名：${charName}`,
    "",
    "原文：",
    firstMessage
  ].join("\n");
  try {
    const send = await gatewayCall("chat.send", {
      sessionKey,
      message: prompt,
      idempotencyKey: `koko-tavern-translate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timeoutMs: 600_000
    }, 610_000);
    const runId = requireString(send.runId, "translation chat.send did not return runId");
    const status = await gatewayCall("agent.wait", { runId, timeoutMs: 600_000 }, 610_000);
    if (status.status !== "ok") throw new Error(status.error ?? `translation status=${status.status}`);
    const history = await gatewayCall("chat.history", { sessionKey, limit: 10, maxChars: 40_000 }, 60_000);
    const text = lastAssistantText(history.messages ?? []);
    return text.trim() || firstMessage;
  } finally {
    await gatewayCall("sessions.delete", { key: sessionKey }, 30_000).catch(() => undefined);
  }
}

async function ensureOpenClawSession(sessionKey, card, sessionId) {
  await gatewayCall("sessions.create", {
    key: sessionKey,
    agentId: "tavern-roleplay",
    label: `${getCharacterName(card)} (${sessionId})`
  }, 30_000);
}

async function bootstrapRoleplaySession(state) {
  const prompt = [
    "KokoChat Tavern roleplay bootstrap.",
    `Read this card file: ${state.cardFile}`,
    "This card file is bound to the current session.",
    "Follow kokochat-tavern-roleplay skill rules for all future replies in this session.",
    "The KokoChat client has already displayed the card's first_mes locally. Do not repeat it.",
    "After reading the file, reply exactly: READY:" + getCharacterName(state.card)
  ].join("\n");
  const idempotencyKey = `koko-tavern-bootstrap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const send = await gatewayCall("sessions.send", {
    key: state.sessionKey,
    message: prompt,
    idempotencyKey,
    timeoutMs: 600_000
  }, 610_000);
  const runId = requireString(send.runId, "bootstrap sessions.send did not return runId");
  const status = await gatewayCall("agent.wait", { runId, timeoutMs: 600_000 }, 610_000);
  if (status.status !== "ok") throw new Error(status.error ?? `bootstrap status=${status.status}`);
  const history = await gatewayCall("chat.history", { sessionKey: state.sessionKey, limit: 10, maxChars: 20_000 }, 60_000);
  const ready = lastAssistantText(history.messages ?? []);
  if (!ready.startsWith("READY:")) {
    console.warn("[prototype] bootstrap did not return READY", ready);
  }
  return ready;
}

async function sendRoleplayMessage(state, visibleText) {
  state.messages.push({ role: "user", text: visibleText });

  const idempotencyKey = `koko-tavern-roleplay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const send = await gatewayCall("sessions.send", {
    key: state.sessionKey,
    message: visibleText,
    idempotencyKey,
    timeoutMs: 600_000
  }, 610_000);
  const runId = requireString(send.runId, "sessions.send did not return runId");
  const status = await gatewayCall("agent.wait", { runId, timeoutMs: 600_000 }, 610_000);
  if (status.status !== "ok") throw new Error(status.error ?? `agent.wait status=${status.status}`);
  const history = await gatewayCall("chat.history", { sessionKey: state.sessionKey, limit: 20, maxChars: 60_000 }, 60_000);
  const reply = lastAssistantText(history.messages ?? []);
  state.messages.push({ role: "assistant", text: reply });
  return reply;
}

async function gatewayCall(method, params, timeoutMs = 30_000) {
  if (!gatewayToken) throw new Error("No gateway token found in ~/.openclaw/openclaw.json");
  const { stdout } = await execFileAsync("openclaw", [
    "gateway", "call",
    "--url", gatewayUrl,
    "--token", gatewayToken,
    method,
    "--json",
    "--timeout", String(timeoutMs),
    "--params", JSON.stringify(params)
  ], { timeout: timeoutMs + 15_000, env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}` } });
  return JSON.parse(stdout);
}

function lastAssistantText(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "assistant" && message?.role !== "agent") continue;
    if (typeof message.text === "string") return message.text.trim();
    if (Array.isArray(message.content)) {
      return message.content.map((part) => part?.type === "text" && typeof part.text === "string" ? part.text : "").join("").trim();
    }
  }
  return "";
}

function readGatewayToken() {
  try {
    const parsed = JSON.parse(readFileSync(join(process.env.HOME ?? "", ".openclaw/openclaw.json"), "utf8"));
    return typeof parsed?.gateway?.auth?.token === "string" ? parsed.gateway.auth.token : null;
  } catch {
    return null;
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("error", reject);
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function serveFile(res, file) {
  const safe = file.replace(/^\/+/, "");
  const path = join(PUBLIC, safe);
  readFile(path, (error, data) => {
    if (error) return json(res, { ok: false, error: "not found" }, 404);
    res.writeHead(200, { "content-type": contentType(path) });
    res.end(data);
  });
}

function json(res, value, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

function contentType(path) {
  switch (extname(path)) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    default: return "application/octet-stream";
  }
}

function requireString(value, message) {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(message);
}

function looksMostlyChinese(text) {
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length;
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  return cjk > 0 && cjk >= letters * 0.2;
}
