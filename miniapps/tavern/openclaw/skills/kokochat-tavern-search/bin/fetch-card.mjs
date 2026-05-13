#!/usr/bin/env node
/**
 * kokochat-tavern-search · fetch-card
 *
 * Fetches a single Character Tavern detail record and normalizes it into the
 * SillyTavern-ish shape used by KokoChat's roleplay prototype.
 *
 * Input (argv JSON or stdin JSON):
 *   { "path": "author/slug" }
 * or:
 *   { "pageUrl": "https://character-tavern.com/character/author/slug" }
 *
 * Output:
 *   { "ok": true, "card": { ...normalized full card... } }
 */
import { argv } from "node:process";

const FETCH_TIMEOUT_MS = 15_000;

async function main() {
  let input;
  try {
    input = await readInput();
  } catch (error) {
    return fail(`could not parse input: ${describeError(error)}`);
  }

  const path = normalizePath(input.path ?? pathFromPageUrl(input.pageUrl));
  if (path.length === 0) return fail("path or pageUrl is required");

  let payload;
  try {
    payload = await fetchJson(`https://character-tavern.com/api/character/${path}`, FETCH_TIMEOUT_MS);
  } catch (error) {
    return fail(`character-tavern detail fetch failed: ${describeError(error)}`);
  }

  const card = normalizeCard(payload?.card);
  if (card === null) return fail("character detail response did not contain a usable card");

  process.stdout.write(JSON.stringify({ ok: true, card }) + "\n");
}

function normalizeCard(raw) {
  if (raw === null || typeof raw !== "object") return null;
  const path = normalizePath(raw.path);
  if (path.length === 0) return null;

  return {
    source: "character_tavern",
    id: stringOr(raw.id, path),
    path,
    pageUrl: `https://character-tavern.com/character/${path}`,
    imageUrl: `https://cards.character-tavern.com/${path}.png`,
    name: stringOr(raw.name, ""),
    inChatName: stringOr(raw.inChatName, "") || stringOr(raw.name, ""),
    tagline: stringOr(raw.tagline, ""),
    pageDescription: stringOr(raw.description, ""),
    isNSFW: raw.isNSFW === true,
    isOC: raw.isOC === true,
    createdAt: stringOr(raw.createdAt, ""),
    lastUpdatedAt: stringOr(raw.lastUpdatedAt, ""),
    versionId: numberOr(raw.versionId, 0),
    tokenTotal: numberOr(raw.tokenTotal, 0),
    tokenDescription: numberOr(raw.tokenDescription, 0),
    tokenPersonality: numberOr(raw.tokenPersonality, 0),
    tokenScenario: numberOr(raw.tokenScenario, 0),
    tokenMesExample: numberOr(raw.tokenMesExample, 0),
    tokenFirstMes: numberOr(raw.tokenFirstMes, 0),
    tokenSystemPrompt: numberOr(raw.tokenSystemPrompt, 0),
    tokenPostHistoryInstructions: numberOr(raw.tokenPostHistoryInstructions, 0),
    analytics: {
      views: numberOr(raw.analytics_views, 0),
      downloads: numberOr(raw.analytics_downloads, 0),
      messages: numberOr(raw.analytics_messages, 0)
    },
    data: {
      name: stringOr(raw.inChatName, "") || stringOr(raw.name, ""),
      description: stringOr(raw.definition_character_description, ""),
      personality: stringOr(raw.definition_personality, ""),
      scenario: stringOr(raw.definition_scenario, ""),
      first_mes: stringOr(raw.definition_first_message, ""),
      mes_example: stringOr(raw.definition_example_messages, ""),
      system_prompt: stringOr(raw.definition_system_prompt, ""),
      post_history_instructions: stringOr(raw.definition_post_history_prompt, ""),
      alternate_greetings: arrayOfStrings(raw.alternate_greetings),
      character_book: isRecord(raw.character_book) ? raw.character_book : null,
      creator_notes: stringOr(raw.creator_notes, ""),
      tags: arrayOfStrings(raw.tags)
    },
    raw
  };
}

async function readInput() {
  const positional = argv.slice(2).join(" ").trim();
  if (positional.length > 0) return JSON.parse(positional);
  if (process.stdin.isTTY) throw new Error("no input provided; pass JSON via argv or stdin");
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw.length === 0) throw new Error("no input provided; pass JSON via argv or stdin");
  return JSON.parse(raw);
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "kokochat-tavern-fetch-card/0.1 (+https://kokochat.app)"
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function pathFromPageUrl(value) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    if (url.hostname !== "character-tavern.com") return "";
    const prefix = "/character/";
    if (!url.pathname.startsWith(prefix)) return "";
    return decodeURIComponent(url.pathname.slice(prefix.length));
  } catch {
    return "";
  }
}

function normalizePath(value) {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .replace(/^https:\/\/character-tavern\.com\/character\//, "")
    .replace(/^\/+|\/+$/g, "");
}

function arrayOfStrings(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function stringOr(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function numberOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function fail(message) {
  process.stdout.write(JSON.stringify({ ok: false, error: message }) + "\n");
  process.exit(1);
}

main().catch((error) => fail(describeError(error)));
