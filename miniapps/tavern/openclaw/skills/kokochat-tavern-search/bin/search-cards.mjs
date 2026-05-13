#!/usr/bin/env node
/**
 * kokochat-tavern-search · search-cards
 *
 * Hits Character Tavern's public catalog endpoint, normalizes the response,
 * and writes a small JSON envelope to stdout. The agent treats this as an
 * opaque tool: input via argv/stdin, output via stdout, no scraping logic
 * leaks into prompt land.
 *
 * Input
 * -----
 * Positional arg or stdin: a JSON object.
 *   {
 *     "query": string,           // required, free-form keywords
 *     "tags": string[]?,         // include filters
 *     "excludeTags": string[]?,  // exclude filters
 *     "limit": number?,          // 1..30, default 20
 *     "sort": string?,           // most_popular | newest | trending
 *     "includeNsfw": boolean?    // default false; when false adds nsfw exclusion
 *   }
 *
 * Output (stdout JSON, one line)
 * ------------------------------
 *   { "ok": true, "query": "...", "totalHits": 1234,
 *     "candidates": [ { ...normalized hit }, ... ] }
 * On failure:
 *   { "ok": false, "error": "human-readable reason" } and exit code 1.
 *
 * The skill keeps the upstream URL shape and field names stable for the
 * agent. If Character Tavern's site changes, only this file needs updating.
 */
import { argv } from "node:process";

const ENDPOINT = "https://character-tavern.com/api/search/cards";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 30;
const DEFAULT_NSFW_EXCLUDES = ["nsfw", "explicit", "smut", "porn"];
const FETCH_TIMEOUT_MS = 15_000;

async function main() {
  let input;
  try {
    input = await readInput();
  } catch (error) {
    return fail(`could not parse input: ${describeError(error)}`);
  }

  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (query.length === 0) {
    return fail("query is required and must be a non-empty string");
  }

  const limit = clampInt(input.limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
  const sort = typeof input.sort === "string" && input.sort.length > 0 ? input.sort : "most_popular";
  const includeNsfw = input.includeNsfw === true;
  const tags = stringArray(input.tags);
  const explicitExcludes = stringArray(input.excludeTags);
  const excludeTags = includeNsfw
    ? explicitExcludes
    : dedupe([...explicitExcludes, ...DEFAULT_NSFW_EXCLUDES]);

  const url = buildUrl({ query, sort, limit, tags, excludeTags });

  let payload;
  try {
    payload = await fetchJson(url, FETCH_TIMEOUT_MS);
  } catch (error) {
    return fail(`character-tavern fetch failed: ${describeError(error)}`);
  }

  const hits = Array.isArray(payload?.hits) ? payload.hits : [];
  const candidates = hits.map(normalizeHit).filter((hit) => hit !== null);

  process.stdout.write(
    JSON.stringify({
      ok: true,
      query,
      sort,
      requestedLimit: limit,
      totalHits: typeof payload?.totalHits === "number" ? payload.totalHits : candidates.length,
      candidates
    }) + "\n"
  );
}

function buildUrl({ query, sort, limit, tags, excludeTags }) {
  const params = new URLSearchParams();
  params.set("query", query);
  params.set("sort", sort);
  params.set("limit", String(limit));
  if (tags.length > 0) params.set("tags", tags.join(","));
  if (excludeTags.length > 0) params.set("exclude_tags", excludeTags.join(","));
  return `${ENDPOINT}?${params.toString()}`;
}

function normalizeHit(raw) {
  if (raw === null || typeof raw !== "object") return null;
  const path = typeof raw.path === "string" ? raw.path.trim() : "";
  if (path.length === 0) return null;
  const pageUrl = `https://character-tavern.com/character/${path}`;
  const imageUrl = `https://cards.character-tavern.com/${path}.png`;
  return {
    id: typeof raw.id === "string" ? raw.id : path,
    path,
    pageUrl,
    imageUrl,
    name: stringOr(raw.name, ""),
    inChatName: stringOr(raw.inChatName, ""),
    tagline: stringOr(raw.tagline, ""),
    pageDescription: truncate(stringOr(raw.pageDescription, ""), 600),
    author: stringOr(raw.author, ""),
    tags: stringArray(raw.tags).slice(0, 24),
    isNSFW: raw.isNSFW === true,
    contentWarnings: stringArray(raw.contentWarnings).slice(0, 12),
    likes: numberOr(raw.likes, 0),
    downloads: numberOr(raw.downloads, 0),
    messages: numberOr(raw.messages, 0),
    totalTokens: numberOr(raw.totalTokens, 0),
    hasLorebook: raw.hasLorebook === true,
    isOC: raw.isOC === true,
    // Light excerpts only. Full character definitions are not needed for
    // recommendation surfaces and would blow up the agent's context budget.
    personalityExcerpt: truncate(stringOr(raw.characterPersonality, ""), 320),
    scenarioExcerpt: truncate(stringOr(raw.characterScenario, ""), 320),
    firstMessageExcerpt: truncate(stringOr(raw.characterFirstMessage, ""), 320)
  };
}

async function readInput() {
  const positional = argv.slice(2).join(" ").trim();
  if (positional.length > 0) return JSON.parse(positional);
  if (process.stdin.isTTY) {
    throw new Error("no input provided; pass JSON via argv or stdin");
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw.length === 0) {
    throw new Error("no input provided; pass JSON via argv or stdin");
  }
  return JSON.parse(raw);
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "user-agent": "kokochat-tavern-search/0.1 (+https://kokochat.app)"
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function clampInt(value, min, max, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const integer = Math.floor(value);
  if (integer < min) return min;
  if (integer > max) return max;
  return integer;
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed.length > 0) out.push(trimmed);
  }
  return out;
}

function dedupe(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function stringOr(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function numberOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function describeError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function fail(message) {
  process.stdout.write(JSON.stringify({ ok: false, error: message }) + "\n");
  process.exit(1);
}

main().catch((error) => fail(describeError(error)));
