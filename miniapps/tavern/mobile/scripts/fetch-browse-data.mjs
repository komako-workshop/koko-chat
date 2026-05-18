#!/usr/bin/env node
/**
 * Build a B站-二次元 friendly catalogue from character-tavern.com for the
 * Tavern Browse demo. Output: `assets/browse-data.json`, consumed by
 * BrowseScreen.tsx at bundle time.
 *
 * Strategy:
 *   1. For each Chinese category, run several English queries against the
 *      `/api/search/cards` endpoint (character-tavern has no Chinese search).
 *   2. Score every hit on two axes:
 *        - popularity = log(downloads) + 5*log(likes+1)
 *        - anime-affinity = tag heuristics + name heuristics, hand-picked
 *          to favour cards a B站 / Twitter / Discord 二次元 reader would
 *          recognise (Genshin, BA, anime tags, hiragana/kanji names) and
 *          penalise the western-realistic, horror, medieval-fantasy noise
 *          that character-tavern's catalogue otherwise drags in.
 *   3. Filter out low-effort cards (downloads<30 unless name screams anime).
 *   4. Dedupe across categories (a card "owns" its first chip), take top N
 *      per chip, write everything to JSON.
 *
 * Usage:
 *   node miniapps/tavern/mobile/scripts/fetch-browse-data.mjs
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = resolve(HERE, "..", "assets", "browse-data.json");

const ENDPOINT = "https://character-tavern.com/api/search/cards";
const NSFW_EXCLUDES = ["nsfw", "explicit", "smut", "porn"];
const PER_QUERY = 30; // hit the API for this many per query
const PER_CATEGORY_MAX = 36; // keep at most this many per chip after scoring
const MIN_DOWNLOADS_FALLBACK = 30; // cards below this are dropped unless anime-tier
const SORT = "most_popular";
const TIMEOUT_MS = 20_000;

/**
 * Categories, ordered as they'll appear on the chip bar. Each one ships
 * multiple English queries; the union of their hits becomes the candidate
 * pool for that chip.
 */
const CATEGORIES = [
  {
    id: "anime-ip",
    labelZh: "二次元 IP",
    queries: [
      "genshin impact",
      "honkai star rail",
      "zenless zone zero",
      "blue archive",
      "jujutsu kaisen",
      "chainsaw man",
      "spy family"
    ]
  },
  {
    id: "school",
    labelZh: "校园青春",
    queries: ["schoolgirl anime", "classmate senpai", "high school anime", "club student"]
  },
  {
    id: "yandere",
    labelZh: "病娇黑化",
    queries: ["yandere", "obsessive love", "dark love anime", "yandere girlfriend"]
  },
  {
    id: "tsundere",
    labelZh: "傲娇冰山",
    queries: ["tsundere", "kuudere", "ice queen anime", "cold girlfriend anime"]
  },
  {
    id: "wholesome",
    labelZh: "温柔治愈",
    queries: ["wholesome anime", "gentle kind", "comfort character", "healing slice of life"]
  },
  {
    id: "onee-san",
    labelZh: "御姐姐系",
    queries: ["onee-san", "older sister anime", "mature woman anime", "elder sister"]
  },
  {
    id: "imouto",
    labelZh: "妹系年下",
    queries: ["imouto", "younger sister anime", "kohai", "little sister"]
  },
  {
    id: "maid",
    labelZh: "女仆执事",
    queries: ["maid anime", "butler", "servant anime", "maid cafe"]
  },
  {
    id: "fantasy",
    labelZh: "奇幻冒险",
    queries: ["isekai", "fantasy adventure anime", "magic girl", "rpg party member"]
  },
  {
    id: "ancient",
    labelZh: "古风历史",
    queries: ["shrine maiden miko", "samurai", "ancient japan", "dynasty wuxia"]
  },
  {
    id: "cyberpunk",
    labelZh: "赛博朋克",
    queries: ["cyberpunk anime", "android girlfriend", "dystopian future anime", "sci-fi girlfriend anime"]
  },
  {
    id: "idol",
    labelZh: "偶像音乐",
    queries: ["idol anime", "vtuber", "j-pop idol", "hololive"]
  },
  {
    id: "romance",
    labelZh: "甜美恋爱",
    queries: ["anime girlfriend", "wholesome romance anime", "dere", "dating sim anime"]
  }
];

/** Anime / 二次元 affinity heuristics. */
const ANIME_TAG_WHITELIST = new Set([
  "anime", "japanese", "manga", "otaku", "moe", "kawaii",
  "vtuber", "isekai", "magical girl", "mahou shoujo",
  "tsundere", "yandere", "kuudere", "dandere", "deredere",
  "schoolgirl", "schoolboy", "uniform", "senpai", "kohai",
  "imouto", "onee-san", "loli-protector", "shoujo", "shounen",
  "anime girl", "anime boy", "weeb", "japan", "tokyo",
  "genshin impact", "honkai", "zenless", "blue archive",
  "hololive", "vocaloid", "miko", "miku", "kpop"
]);

const ANIME_TAG_PENALTIES = new Set([
  "realistic", "horror", "western", "crime", "medieval",
  "historical", "biblical", "noir", "true crime", "western fantasy",
  "european", "viking", "cowboy"
]);

const ANIME_KEYWORD_BOOSTS = [
  /原神|genshin/i, /崩坏|崩铁|honkai/i, /鸣潮|wuthering/i,
  /星穹铁道|star rail/i, /绝区零|zenless/i, /碧蓝|blue archive/i,
  /明日方舟|arknights/i, /学姐|学妹|师姐|师妹/i,
  /chan\b|kun\b|senpai|kohai|onee|imouto|niichan|neesan/i,
  /魔法少女|magical girl|mahou/i, /女仆|maid|butler/i,
  /vtuber|hololive|nijisanji/i, /miko|巫女|神社/i,
  /re:zero|konosuba|jjk|jujutsu|chainsaw|spy.?family|frieren/i,
  /persona|atelier|fate.?grand|nasuverse|fgo/i
];

// Strong "this is NOT anime/二次元" signals — these eject a card from
// the chip even if popularity is high.
const NON_ANIME_NAME_BLOCKLIST = [
  /hogwarts|harry.?potter|hermione|gryffindor/i,
  /pokemon|pok[ée]mon/i,
  /\bmlp\b|my little pony|pony rpg/i,
  /minecraft|roblox/i,
  /\bnarnia\b|\blotr\b|lord of the rings/i,
  /game of thrones|witcher/i,
  /star wars|trek/i,
  /marvel|dc comics|batman|spider.?man/i,
  /skyrim|elder scrolls|fallout/i,
  /\bgta\b|grand theft/i,
  /undertale|deltarune/i,
  /\brpg simulator\b|earth rpg|generic rpg|simulation rpg/i
];

function affinity(card) {
  let score = 0;
  const tagsLower = (card.tags || []).map((t) => t.toLowerCase());
  for (const t of tagsLower) {
    if (ANIME_TAG_WHITELIST.has(t)) score += 2;
    if (ANIME_TAG_PENALTIES.has(t)) score -= 2;
  }
  const text = `${card.name || ""} ${card.tagline || ""}`;
  // Hard kills: if the name screams Harry Potter / Pokemon / MLP / etc,
  // never let it into a 二次元 chip even if downloads are huge.
  for (const re of NON_ANIME_NAME_BLOCKLIST) {
    if (re.test(text)) return -1000;
  }
  // Hiragana / katakana / kanji presence is a strong anime signal.
  if (/[\u3040-\u30ff]/.test(text)) score += 4; // kana
  if (/[\u4e00-\u9fff]/.test(text)) score += 3; // han (covers Chinese & kanji)
  for (const re of ANIME_KEYWORD_BOOSTS) {
    if (re.test(text)) score += 2;
  }
  return score;
}

function popularity(card) {
  const dl = Math.max(card.downloads || 0, 0);
  const likes = Math.max(card.likes || 0, 0);
  return Math.log1p(dl) + 5 * Math.log1p(likes);
}

function totalScore(card) {
  // Affinity dominates: a card needs to look二次元 first, popularity is
  // the tiebreaker. We don't want a 4000-download English RPG sitting at
  // the top of "二次元 IP" just because of raw download count.
  return affinity(card) * 4 + popularity(card);
}

async function main() {
  const startedAt = new Date();
  console.log(`[fetch-browse-data] start ${startedAt.toISOString()}`);

  const claimed = new Map(); // path -> the category id that took it
  const out = [];
  let totalApiCalls = 0;
  let totalHitsSeen = 0;

  for (const cat of CATEGORIES) {
    console.log(`\n· ${cat.id} (${cat.labelZh})`);

    // Pool every hit across this category's queries, keyed by path.
    const pool = new Map();
    for (const query of cat.queries) {
      totalApiCalls += 1;
      const url = buildUrl(query);
      let payload;
      try {
        payload = await fetchJson(url, TIMEOUT_MS);
      } catch (error) {
        console.log(`    ⚠ ${query} failed: ${describeError(error)}`);
        continue;
      }
      const hits = Array.isArray(payload?.hits) ? payload.hits : [];
      totalHitsSeen += hits.length;
      for (const raw of hits) {
        const card = normalize(raw);
        if (card === null) continue;
        if (!pool.has(card.path)) pool.set(card.path, card);
      }
    }

    const candidates = [...pool.values()]
      .map((c) => ({ ...c, _score: totalScore(c), _affinity: affinity(c) }))
      .filter((c) => {
        if (c._affinity <= -100) return false; // hard-blocked names
        // Drop deep-noise cards unless the anime heuristic clearly fires.
        if ((c.downloads || 0) < MIN_DOWNLOADS_FALLBACK && c._affinity < 4) return false;
        return true;
      })
      .sort((a, b) => b._score - a._score);

    // Apply cross-category dedup + a "top-4 must be visibly anime" gate.
    // The first four cards a user sees on each chip are the showcase
    // slots; we reject anything with affinity < 4 there to avoid a
    // generic-fantasy or western RPG sitting at the top.
    const kept = [];
    const overflow = []; // affinity-failed entries we'll backfill with
    for (const c of candidates) {
      if (claimed.has(c.path)) continue;
      const isTopSlot = kept.length < 4;
      if (isTopSlot && c._affinity < 4) {
        overflow.push(c);
        continue;
      }
      claimed.set(c.path, cat.id);
      kept.push(c);
      if (kept.length >= PER_CATEGORY_MAX) break;
    }
    // Backfill remaining slots from the overflow list once the top-4
    // anime gate has been satisfied (or exhausted).
    for (const c of overflow) {
      if (kept.length >= PER_CATEGORY_MAX) break;
      if (claimed.has(c.path)) continue;
      claimed.set(c.path, cat.id);
      kept.push(c);
    }

    console.log(
      `    pool=${pool.size}  after-filter=${candidates.length}  kept=${kept.length}` +
        (kept[0]
          ? `  top=\"${(kept[0].inChatName || kept[0].name).slice(0, 30)}\" dl=${kept[0].downloads} aff=${kept[0]._affinity} score=${kept[0]._score.toFixed(2)}`
          : "")
    );

    out.push({
      id: cat.id,
      labelZh: cat.labelZh,
      cards: kept.map((c) => stripInternalFields(c))
    });
  }

  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(
    OUT_FILE,
    JSON.stringify(
      {
        version: 1,
        fetchedAt: startedAt.toISOString(),
        categories: out
      },
      null,
      2
    ) + "\n"
  );

  const totalCards = out.reduce((sum, cat) => sum + cat.cards.length, 0);
  console.log(
    `\n[fetch-browse-data] done. apiCalls=${totalApiCalls} rawHits=${totalHitsSeen} kept=${totalCards} categories=${out.length}`
  );
  console.log(`→ ${OUT_FILE}`);
}

function buildUrl(query) {
  const params = new URLSearchParams();
  params.set("query", query);
  params.set("sort", SORT);
  params.set("limit", String(PER_QUERY));
  params.set("exclude_tags", NSFW_EXCLUDES.join(","));
  return `${ENDPOINT}?${params.toString()}`;
}

// Long-form SillyTavern V2 fields character-tavern's search API returns
// inline with every hit. We trim them so a single browse-data.json stays
// in the low-MB range even with 440+ cards bundled into the app.
const MAX_DESCRIPTION_CHARS = 1600;
const MAX_FIRST_MES_CHARS = 2400;
const MAX_PERSONALITY_CHARS = 800;
const MAX_SCENARIO_CHARS = 1200;

function normalize(raw) {
  if (raw === null || typeof raw !== "object") return null;
  const path = typeof raw.path === "string" ? raw.path.trim() : "";
  if (path.length === 0) return null;
  return {
    path,
    pageUrl: `https://character-tavern.com/character/${path}`,
    imageUrl: `https://cards.character-tavern.com/${path}.png`,
    name: stringOr(raw.name, ""),
    inChatName: stringOr(raw.inChatName, ""),
    tagline: stringOr(raw.tagline, ""),
    tags: stringArray(raw.tags).slice(0, 12),
    isNSFW: raw.isNSFW === true,
    likes: numberOr(raw.likes, 0),
    downloads: numberOr(raw.downloads, 0),
    // Long-form fields used by the detail page (description + first_mes
    // preview) and by the fast-path "skip remote fetchFullCard" route in
    // tavern-roleplay. They're allowed to be empty strings; the renderer
    // hides those sections.
    description: truncate(stringOr(raw.pageDescription, ""), MAX_DESCRIPTION_CHARS),
    personality: truncate(stringOr(raw.characterPersonality, ""), MAX_PERSONALITY_CHARS),
    scenario: truncate(stringOr(raw.characterScenario, ""), MAX_SCENARIO_CHARS),
    firstMessage: truncate(stringOr(raw.characterFirstMessage, ""), MAX_FIRST_MES_CHARS)
  };
}

function truncate(s, max) {
  if (typeof s !== "string") return "";
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

function stripInternalFields(card) {
  const { _score, _affinity, ...rest } = card;
  return rest;
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "user-agent": "kokochat-tavern-browse/0.2 (+https://kokochat.app)"
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function stringOr(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function numberOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error) => {
  console.error("[fetch-browse-data] failed:", describeError(error));
  process.exit(1);
});
