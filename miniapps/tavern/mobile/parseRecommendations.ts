/**
 * Validation + extraction for the `koko.tavern.recommendations` fenced block.
 *
 * The Tavern OpenClaw skill (`kokochat-tavern-search`) returns assistant text
 * containing exactly one fenced block:
 *
 *   ```koko.tavern.recommendations
 *   { "version": 2, "query": "...", "items": [ ... ] }
 *   ```
 *
 * v2 (current): items[] is an ordered stream of "text" + "card" entries that
 * KokoChat renders as multiple agent bubbles, IM-style. There is no `reason`
 * field on cards; the prose lives in `kind: "text"` items.
 *
 * v1 (legacy): cards[] only, with a `reason` string per card. We keep v1
 * support so a still-old agent build doesn't break the mini-app — we project
 * v1 into the same items[] shape by synthesising one text bubble per
 * `reason`.
 *
 * KokoChat must never trust assistant text as-is: the model is allowed to
 * drift in tone or invent fields. This module is the only place the host is
 * allowed to convert raw assistant text into a typed value renderable by the
 * chat surface.
 */
import { extractFencedBlock } from "@/runtime/messageBlocks";

const RECOMMENDATIONS_BLOCK_TYPE = "koko.tavern.recommendations";

const PAGE_URL_PREFIX = "https://character-tavern.com/character/";
const IMAGE_URL_PREFIX = "https://cards.character-tavern.com/";

const MIN_CARDS = 3;
const MAX_CARDS = 5;
const MAX_MATCH_TAGS = 4;

export interface TavernRecommendationCard {
  pageUrl: string;
  imageUrl: string;
  name: string;
  nameZh: string;
  tagline: string;
  taglineZh: string;
  tags: string[];
  matchTags: string[];
  safety: "sfw" | "nsfw" | "unknown";
}

export type TavernRecommendationItem =
  | { kind: "text"; text: string }
  | { kind: "card"; card: TavernRecommendationCard };

export interface TavernRecommendations {
  version: 2;
  query: string;
  items: TavernRecommendationItem[];
}

export interface ParseFailure {
  ok: false;
  error: string;
}

export interface ParseSuccess {
  ok: true;
  value: TavernRecommendations;
}

export type ParseResult = ParseSuccess | ParseFailure;

export function parseTavernRecommendations(assistantText: string): ParseResult {
  const fenced = extractFencedBlock(assistantText, RECOMMENDATIONS_BLOCK_TYPE);
  if (fenced === null) {
    return { ok: false, error: "未找到 koko.tavern.recommendations 推荐块" };
  }
  const blockBody = fenced.body.trim();
  const intro = fenced.intro;

  let raw: unknown;
  try {
    raw = JSON.parse(blockBody);
  } catch (error) {
    return {
      ok: false,
      error: `推荐块 JSON 解析失败: ${error instanceof Error ? error.message : String(error)}`
    };
  }

  if (!isRecord(raw)) {
    return { ok: false, error: "推荐块不是 JSON 对象" };
  }

  if (raw.version === 2) {
    return parseV2(raw);
  }
  if (raw.version === 1) {
    return parseV1(raw, intro);
  }
  return { ok: false, error: `推荐块版本号不被支持: ${String(raw.version)}` };
}

export function isTavernRecommendations(data: unknown): data is TavernRecommendations {
  if (!isRecord(data)) return false;
  if (data.version !== 2) return false;
  if (typeof data.query !== "string") return false;
  if (!Array.isArray(data.items)) return false;
  return data.items.every(isTavernRecommendationItem);
}

export function isTavernRecommendationItem(data: unknown): data is TavernRecommendationItem {
  if (!isRecord(data)) return false;
  if (data.kind === "text") {
    return typeof data.text === "string" && data.text.length > 0;
  }
  if (data.kind === "card") {
    return isTavernRecommendationCard(data.card);
  }
  return false;
}

function isTavernRecommendationCard(data: unknown): data is TavernRecommendationCard {
  if (!isRecord(data)) return false;
  return (
    typeof data.pageUrl === "string" &&
    typeof data.imageUrl === "string" &&
    typeof data.name === "string" &&
    typeof data.nameZh === "string" &&
    typeof data.tagline === "string" &&
    typeof data.taglineZh === "string" &&
    Array.isArray(data.tags) &&
    data.tags.every((tag) => typeof tag === "string") &&
    Array.isArray(data.matchTags) &&
    data.matchTags.every((tag) => typeof tag === "string") &&
    (data.safety === "sfw" || data.safety === "nsfw" || data.safety === "unknown")
  );
}

function parseV2(raw: Record<string, unknown>): ParseResult {
  const query = readNonEmptyString(raw.query, "query");
  if (query.error !== undefined) return { ok: false, error: query.error };

  if (!Array.isArray(raw.items)) {
    return { ok: false, error: "推荐块缺少 items 数组" };
  }
  if (raw.items.length === 0) {
    return { ok: false, error: "推荐块的 items 为空" };
  }

  const items: TavernRecommendationItem[] = [];
  let cardCount = 0;
  for (let i = 0; i < raw.items.length; i += 1) {
    const result = parseItem(raw.items[i], i);
    if (result.error !== undefined) return { ok: false, error: result.error };
    items.push(result.value);
    if (result.value.kind === "card") cardCount += 1;
  }

  if (cardCount < MIN_CARDS || cardCount > MAX_CARDS) {
    return {
      ok: false,
      error: `卡片数量异常: 期望 ${MIN_CARDS}-${MAX_CARDS} 张，得到 ${cardCount} 张`
    };
  }

  return {
    ok: true,
    value: { version: 2, query: query.value, items }
  };
}

function parseItem(value: unknown, index: number): ReadResult<TavernRecommendationItem> | ReadError {
  const where = `items[${index}]`;
  if (!isRecord(value)) {
    return { error: `${where} 不是对象` };
  }
  if (value.kind === "text") {
    const text = readNonEmptyString(value.text, `${where}.text`);
    if (text.error !== undefined) return { error: text.error };
    return { value: { kind: "text", text: text.value } };
  }
  if (value.kind === "card") {
    const card = parseCard(value.card, index);
    if (card.error !== undefined) return { error: card.error };
    return { value: { kind: "card", card: card.value } };
  }
  return { error: `${where}.kind 期望 "text" 或 "card"，得到 ${String(value.kind)}` };
}

/**
 * Project a v1 payload onto the v2 items[] shape so the renderer never sees
 * the legacy schema. The agent's intro prose (if any) becomes the opening
 * text bubble, and each card's `reason` becomes the per-card lead-in bubble.
 * This is intentionally generous — it's a transitional shim, not a long-term
 * contract.
 */
function parseV1(raw: Record<string, unknown>, intro: string): ParseResult {
  const query = readNonEmptyString(raw.query, "query");
  if (query.error !== undefined) return { ok: false, error: query.error };

  if (!Array.isArray(raw.cards)) {
    return { ok: false, error: "推荐块缺少 cards 数组" };
  }
  if (raw.cards.length < MIN_CARDS || raw.cards.length > MAX_CARDS) {
    return {
      ok: false,
      error: `推荐数量异常: 期望 ${MIN_CARDS}-${MAX_CARDS} 张，得到 ${raw.cards.length} 张`
    };
  }

  const items: TavernRecommendationItem[] = [];
  if (intro.length > 0) {
    items.push({ kind: "text", text: intro });
  }

  for (let i = 0; i < raw.cards.length; i += 1) {
    const v1Card = raw.cards[i];
    if (!isRecord(v1Card)) {
      return { ok: false, error: `cards[${i}] 不是对象` };
    }
    const reason = typeof v1Card.reason === "string" ? v1Card.reason.trim() : "";
    if (reason.length > 0) {
      items.push({ kind: "text", text: reason });
    }
    const cardResult = parseCard(v1Card, i);
    if (cardResult.error !== undefined) return { ok: false, error: cardResult.error };
    items.push({ kind: "card", card: cardResult.value });
  }

  return {
    ok: true,
    value: { version: 2, query: query.value, items }
  };
}

interface ReadResult<T> {
  value: T;
  error?: undefined;
}
interface ReadError {
  value?: undefined;
  error: string;
}

function parseCard(value: unknown, index: number): ReadResult<TavernRecommendationCard> | ReadError {
  const where = `cards[${index}]`;
  if (!isRecord(value)) {
    return { error: `${where} 不是对象` };
  }
  const pageUrl = readNonEmptyString(value.pageUrl, `${where}.pageUrl`);
  if (pageUrl.error !== undefined) return { error: pageUrl.error };
  if (!pageUrl.value.startsWith(PAGE_URL_PREFIX)) {
    return { error: `${where}.pageUrl 不是 Character Tavern 详情页 URL` };
  }
  const imageUrl = readNonEmptyString(value.imageUrl, `${where}.imageUrl`);
  if (imageUrl.error !== undefined) return { error: imageUrl.error };
  if (!imageUrl.value.startsWith(IMAGE_URL_PREFIX)) {
    return { error: `${where}.imageUrl 不是 Character Tavern 卡片图 URL` };
  }
  const name = readNonEmptyString(value.name, `${where}.name`);
  if (name.error !== undefined) return { error: name.error };
  const nameZh = readNonEmptyString(value.nameZh, `${where}.nameZh`);
  if (nameZh.error !== undefined) return { error: nameZh.error };
  const tagline = readString(value.tagline, `${where}.tagline`);
  if (tagline.error !== undefined) return { error: tagline.error };
  const taglineZh = readNonEmptyString(value.taglineZh, `${where}.taglineZh`);
  if (taglineZh.error !== undefined) return { error: taglineZh.error };

  const tags = readStringArray(value.tags, `${where}.tags`);
  if (tags.error !== undefined) return { error: tags.error };
  const matchTags = readStringArray(value.matchTags, `${where}.matchTags`);
  if (matchTags.error !== undefined) return { error: matchTags.error };

  const safety = readSafety(value.safety, `${where}.safety`);
  if (safety.error !== undefined) return { error: safety.error };

  return {
    value: {
      pageUrl: pageUrl.value,
      imageUrl: imageUrl.value,
      name: name.value,
      nameZh: nameZh.value,
      tagline: tagline.value,
      taglineZh: taglineZh.value,
      tags: tags.value.slice(0, 24),
      matchTags: matchTags.value.slice(0, MAX_MATCH_TAGS),
      safety: safety.value
    }
  };
}

function readNonEmptyString(value: unknown, name: string): ReadResult<string> | ReadError {
  if (typeof value !== "string") return { error: `${name} 不是字符串` };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { error: `${name} 不能为空` };
  return { value: trimmed };
}

function readString(value: unknown, name: string): ReadResult<string> | ReadError {
  if (typeof value !== "string") return { error: `${name} 不是字符串` };
  return { value: value.trim() };
}

function readStringArray(value: unknown, name: string): ReadResult<string[]> | ReadError {
  if (!Array.isArray(value)) return { error: `${name} 不是数组` };
  const out: string[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const entry = value[i];
    if (typeof entry !== "string") return { error: `${name}[${i}] 不是字符串` };
    const trimmed = entry.trim();
    if (trimmed.length > 0) out.push(trimmed);
  }
  return { value: out };
}

function readSafety(
  value: unknown,
  name: string
): ReadResult<TavernRecommendationCard["safety"]> | ReadError {
  if (value === "sfw" || value === "nsfw" || value === "unknown") {
    return { value };
  }
  return { error: `${name} 期望 sfw / nsfw / unknown，得到 ${String(value)}` };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
