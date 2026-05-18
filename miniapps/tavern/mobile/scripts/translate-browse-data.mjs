#!/usr/bin/env node
/**
 * Batch-translate the browse catalogue (name / tagline / tags) into Chinese
 * and write the result back into `assets/browse-data.json`. The original
 * English fields stay in place; the translated ones are added alongside as
 * `nameZh / taglineZh / tagsZh`. BrowseScreen.tsx is expected to prefer the
 * Chinese fields when present and fall back to English otherwise.
 *
 * Why this exists:
 *   - character-tavern.com's catalogue is English first; Chinese users on
 *     the Tavern browse page need to *recognise* a card from the chip + name
 *     + tagline alone, without scanning a wall of English.
 *   - We translate at build time, once. The bundle ships pre-localised so
 *     the device does zero network/LLM work to render the grid.
 *
 * Configuration (env):
 *   OPENAI_API_KEY     (required) — any OpenAI-compatible key works.
 *   OPENAI_BASE_URL    (optional) — defaults to OpenAI; override to
 *                                   https://api.deepseek.com/v1 or any
 *                                   OpenAI-shape endpoint.
 *   TRANSLATE_MODEL    (optional) — defaults to "gpt-4o-mini".
 *   BATCH_SIZE         (optional) — defaults to 8.
 *   CONCURRENCY        (optional) — defaults to 4 (parallel LLM calls).
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... \
 *     node miniapps/tavern/mobile/scripts/translate-browse-data.mjs
 *
 * Idempotent: re-running skips cards that already have all three Chinese
 * fields, so adding new cards to browse-data.json and re-running the script
 * only translates the deltas.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = resolve(HERE, "..", "assets", "browse-data.json");

const API_KEY = process.env.OPENAI_API_KEY;
const API_BASE = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
const MODEL = process.env.TRANSLATE_MODEL ?? "gpt-4o-mini";
const BATCH_SIZE = clampInt(process.env.BATCH_SIZE, 1, 24, 8);
const CONCURRENCY = clampInt(process.env.CONCURRENCY, 1, 16, 4);
const REQUEST_TIMEOUT_MS = 90_000;

if (!API_KEY) {
  console.error("OPENAI_API_KEY is required.");
  console.error("");
  console.error("Examples:");
  console.error("  OPENAI_API_KEY=sk-... node miniapps/tavern/mobile/scripts/translate-browse-data.mjs");
  console.error("  OPENAI_API_KEY=... OPENAI_BASE_URL=https://api.deepseek.com/v1 TRANSLATE_MODEL=deepseek-chat ...");
  process.exit(1);
}

const SYSTEM_PROMPT = [
  "你是一个 AI 角色卡翻译助手。",
  "用户会给你一批角色卡，每张卡有英文 name、tagline、tags、description、firstMessage。",
  "请把它们翻译成自然、易读的简体中文。",
  "",
  "输出严格遵守以下 JSON Schema，外层必须是一个 object，包含 items 数组：",
  '  {"items": [{"idx": <int>, "nameZh": "...", "taglineZh": "...", "tagsZh": ["..."], "descriptionZh": "...", "firstMessageZh": "..."}, ...]}',
  "items 数组里的元素数量必须跟输入卡片数量一致。",
  "",
  "翻译规则：",
  "",
  "- nameZh：动漫/游戏角色用官方中文译名（Yae Miko=八重神子、Raiden Ei=雷电将军、Ram=拉姆、Megumin=惠惠、Kobeni=小红、Ai Hoshino=星野爱、Frieren=弗里伦、Kokushibo=黑死牟、Kikyō=桔梗）。",
  "  对原创角色，音译人名（Marin=玛琳，Asaki=朝樱）；如果名字本身是一个描述短语（如 Tsundere Maid），整段意译（傲娇女仆）。",
  "  普通英文名也可以保留罗马字（Evelyn / Aya），看哪种更自然。",
  "",
  "- taglineZh：把英文 tagline 翻译成 1-2 句口语化中文，最多 50 个字。不要逐字翻译，要保留卡片的 vibe。",
  "  示例：'Your tsundere classmate who actually likes you' → '嘴硬心软的同班同学，其实超喜欢你'。",
  "",
  "- tagsZh：tag 一律 1-3 字短词。常见 tag 映射：",
  "  anime→二次元；japanese→日系；schoolgirl→校园；tsundere→傲娇；yandere→病娇；kuudere→冷酷；",
  "  isekai→异世界；maid→女仆；vtuber→VTuber；wholesome→治愈；mature→御姐；mystery→悬疑；",
  "  fantasy→奇幻；scifi→科幻；cyberpunk→赛博朋克；romance→恋爱；roleplay→角色扮演；rpg→RPG；",
  "  female→女性；male→男性；assistant→助手；adventure→冒险。",
  "  如果 tag 没法用中文短词表达，丢掉它。",
  "",
  "- descriptionZh：把英文 description 翻译成自然中文。这是角色卡详情页要展示的角色简介，",
  "  长度大致跟原文相当（不要刻意压缩，也不要扩写）。保留段落分行。",
  "  保留卡作者写的语气和细节，但表达要通顺（不要翻译腔）。",
  "  专有名词、人物名、地名按 nameZh 规则处理。",
  "  '{{user}}' 和 '{{char}}' 这两个占位符**原样保留**，不要翻译或替换。",
  "",
  "- firstMessageZh：把英文 firstMessage（角色开场白）翻译成自然中文。",
  "  这是角色对玩家说的第一段话，要保留角色的语气、动作描写、Markdown 斜体（*...*）、情绪标点。",
  "  '{{user}}' 和 '{{char}}' 原样保留。",
  "  名字按 nameZh 规则；术语保留原文则保留。长度跟原文相当。",
  "  不要 escape 引号或换行；按原文结构换行。",
  "",
  "如果某个字段原文为空字符串，对应的中文字段也输出空字符串。",
  "",
  "只输出符合 schema 的 JSON object，不要 markdown 代码块，不要其他说明文字。"
].join("\n");

function clampInt(value, min, max, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = parseInt(String(value), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function cardNeedsTranslation(card) {
  // A card is "fully translated" when all five Chinese fields are present.
  // descriptionZh / firstMessageZh may be empty strings when the source
  // field was empty — that still counts as translated.
  if (typeof card.nameZh !== "string" || card.nameZh.length === 0) return true;
  if (typeof card.taglineZh !== "string") return true;
  if (!Array.isArray(card.tagsZh)) return true;
  if (typeof card.descriptionZh !== "string") return true;
  if (typeof card.firstMessageZh !== "string") return true;
  // If source has content but the translation is empty, retranslate.
  if ((card.description || "").length > 0 && card.descriptionZh.length === 0) return true;
  if ((card.firstMessage || "").length > 0 && card.firstMessageZh.length === 0) return true;
  return false;
}

async function translateBatch(batch) {
  const userPayload = batch.map((c, idx) => ({
    idx,
    name: c.inChatName?.length ? c.inChatName : c.name,
    tagline: c.tagline,
    tags: c.tags,
    description: c.description ?? "",
    firstMessage: c.firstMessage ?? ""
  }));

  const body = {
    model: MODEL,
    temperature: 0.3,
    // Each card carries up to ~4KB of description+firstMessage. A small
    // max_tokens (4o-mini's default ~1k) silently truncates the JSON,
    // leaving descriptionZh / firstMessageZh as empty strings or making
    // the whole response unparseable. 8K leaves comfortable headroom for
    // a 3-card batch.
    max_tokens: 8192,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(userPayload, null, 2) }
    ],
    response_format: { type: "json_object" }
  };

  // Some providers (DeepSeek, older OpenAI deployments) don't yet accept
  // json_object for arrays; fall back to a JSON-in-string approach by
  // catching that specific 400 below.
  const url = `${API_BASE}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${API_KEY}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const text = await resp.text();
    if (resp.status === 400 && /json_object/.test(text)) {
      // Retry without response_format.
      delete body.response_format;
      const retry = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${API_KEY}`
        },
        body: JSON.stringify(body)
      });
      if (!retry.ok) {
        throw new Error(`HTTP ${retry.status}: ${(await retry.text()).slice(0, 200)}`);
      }
      const j = await retry.json();
      return parseLlmJson(j?.choices?.[0]?.message?.content ?? "");
    }
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }

  const json = await resp.json();
  return parseLlmJson(json?.choices?.[0]?.message?.content ?? "");
}

function parseLlmJson(raw) {
  // LLM output shapes seen in the wild:
  //   1) {"items":[...]} or {"data":[...]} — what the prompt asks for
  //   2) bare array [...]
  //   3) a single {idx, nameZh, ...} object (single-card batch)
  //   4) multiple {idx, ...} objects concatenated without an array wrapper,
  //      sometimes with stray text/commentary in between
  //   5) {"0": {...}, "1": {...}} keyed-by-idx
  const trimmed = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");

  // Try a clean JSON parse first.
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.items)) return parsed.items;
    if (Array.isArray(parsed.data)) return parsed.data;
    if (Array.isArray(parsed.cards)) return parsed.cards;
    if (Array.isArray(parsed.translations)) return parsed.translations;
    if (Array.isArray(parsed.results)) return parsed.results;
    if (typeof parsed === "object" && parsed !== null) {
      if (typeof parsed.idx === "number") return [parsed];
      const indexed = Object.entries(parsed)
        .filter(([k]) => /^\d+$/.test(k))
        .map(([k, v]) => ({ idx: Number(k), ...v }));
      if (indexed.length > 0) return indexed;
    }
  } catch {
    // Fall through to the salvage path below.
  }

  // Salvage path: extract every top-level {...} block that contains an
  // "idx" key and parse them individually. Useful when the LLM emits
  // multiple JSON objects without a wrapping array, or sprinkles prose
  // around them.
  const salvaged = [];
  const regex = /\{[^{}]*"idx"\s*:\s*\d+[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
  let match;
  while ((match = regex.exec(trimmed)) !== null) {
    try {
      const obj = JSON.parse(match[0]);
      if (typeof obj.idx === "number") salvaged.push(obj);
    } catch {
      // Skip malformed fragment.
    }
  }
  if (salvaged.length > 0) return salvaged;

  throw new Error(`LLM returned unexpected shape: ${trimmed.slice(0, 200)}`);
}

async function main() {
  console.log(`[translate] model=${MODEL}  base=${API_BASE}  batch=${BATCH_SIZE}  concurrency=${CONCURRENCY}`);

  const raw = await readFile(DATA_FILE, "utf8");
  const data = JSON.parse(raw);

  // Build a flat list of cards needing translation, keyed by (catId, cardIdx)
  // so we can patch them back into the original structure later.
  const todo = [];
  for (const cat of data.categories) {
    for (let i = 0; i < cat.cards.length; i += 1) {
      const card = cat.cards[i];
      if (cardNeedsTranslation(card)) {
        todo.push({ cat, idx: i, card });
      }
    }
  }

  const totalCards = data.categories.reduce((s, c) => s + c.cards.length, 0);
  console.log(`[translate] total=${totalCards}  todo=${todo.length}  skipped (already translated)=${totalCards - todo.length}`);

  if (todo.length === 0) {
    console.log("[translate] nothing to do.");
    return;
  }

  // Chunk todo into batches.
  const batches = [];
  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    batches.push(todo.slice(i, i + BATCH_SIZE));
  }
  console.log(`[translate] ${batches.length} batches`);

  let completed = 0;
  let failed = 0;
  const startedAt = Date.now();

  async function runBatch(batch, batchIndex) {
    try {
      const result = await translateBatch(batch.map((b) => b.card));
      for (const r of result) {
        if (typeof r?.idx !== "number") continue;
        const entry = batch[r.idx];
        if (entry === undefined) continue;
        const card = entry.card;
        if (typeof r.nameZh === "string" && r.nameZh.length > 0) card.nameZh = r.nameZh;
        if (typeof r.taglineZh === "string") card.taglineZh = r.taglineZh;
        if (Array.isArray(r.tagsZh)) {
          card.tagsZh = r.tagsZh.filter((t) => typeof t === "string" && t.trim().length > 0).slice(0, 8);
        }
        if (typeof r.descriptionZh === "string") card.descriptionZh = r.descriptionZh;
        if (typeof r.firstMessageZh === "string") card.firstMessageZh = r.firstMessageZh;
      }
      completed += 1;
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      process.stdout.write(
        `\r  ✓ batch ${completed}/${batches.length}   failed=${failed}   ${elapsed}s   `
      );
    } catch (error) {
      failed += 1;
      console.error(`\n  ✗ batch ${batchIndex + 1} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Simple bounded-concurrency runner.
  let next = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (true) {
      const i = next++;
      if (i >= batches.length) return;
      await runBatch(batches[i], i);
    }
  });
  await Promise.all(workers);
  process.stdout.write("\n");

  await writeFile(DATA_FILE, JSON.stringify(data, null, 2) + "\n");

  const stillNeeded = data.categories
    .flatMap((c) => c.cards)
    .filter((c) => cardNeedsTranslation(c)).length;
  console.log(
    `[translate] done. completed=${completed} batches, failed=${failed} batches, still-untranslated cards=${stillNeeded}`
  );
  console.log(`→ ${DATA_FILE}`);
}

main().catch((error) => {
  console.error("[translate] fatal:", error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
