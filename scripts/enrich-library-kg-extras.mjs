#!/usr/bin/env node
/**
 * Batch-enrich KG neighbor books that are not in Deeply's 5569-book pool.
 *
 * Why this exists:
 * - `discover-pool.json` has rich Deeply metadata for 5569 books.
 * - `book-knowledge-graph` has 34,819 books + 147,753 edges.
 * - A detail page's knowledge graph should show clickable neighbor cards.
 * - Many top neighbors are in KG but not in the Deeply pool, so they lack
 *   `h`/`p`/`e` and cannot be opened as a Deeply book detail.
 *
 * This script:
 * 1. Computes the top-N upstream/downstream neighbor closure from the 5569 seed books.
 * 2. Finds missing KG nodes outside the Deeply pool.
 * 3. Calls OpenRouter (DeepSeek V4 Pro by default) to generate:
 *    - category (`c`)
 *    - domain (`d`)
 *    - hook (`h`)
 *    - pitch (`p`)
 *    - echo (`e`)
 * 4. Writes `miniapps/deeply/data/library-extra-books.generated.json`.
 *
 * The normal `scripts/build-library-pool.mjs` then merges this generated file
 * with the base discover pool and re-joins graph edges.
 *
 * Usage:
 *   OPENROUTER_API_KEY=... node scripts/enrich-library-kg-extras.mjs --limit=20 --concurrency=8
 *   node scripts/enrich-library-kg-extras.mjs --concurrency=48
 *
 * Useful flags:
 *   --limit=N       only process first N missing nodes (smoke test)
 *   --concurrency=N default 32
 *   --model=...     default deepseek/deepseek-v4-pro
 *   --max-depth=N   closure iterations; default 7 (enough to converge for current graph)
 *   --dry-run       print target stats without calling LLM
 *   --force         re-generate even if an item already exists
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SRC_DEEPLY = "/Users/lijianren/workspace/deeply/public/data/discover-pool.json";
const SRC_KG = "/Users/lijianren/workspace/demo/book-knowledge-graph/graph-data/books_merged.json";
const SRC_EDGES = "/Users/lijianren/workspace/demo/book-knowledge-graph/graph-data/edges_merged.json";
const OUT = "/Users/lijianren/Desktop/workspace/koko-chat/miniapps/deeply/data/library-extra-books.generated.json";

const MAX_NEIGHBORS_PER_DIR = 6;
const CATEGORY_NAMES = [
  "历史的镜像",
  "文明的逻辑",
  "心智理论",
  "财富的逻辑",
  "思想的深渊",
  "创造与表达",
  "重读经典",
  "科学的边界",
  "人类群星"
];

function parseArgs(argv) {
  const args = {
    concurrency: 32,
    limit: null,
    model: "deepseek/deepseek-v4-pro",
    maxDepth: 7,
    dryRun: false,
    force: false
  };
  for (const raw of argv.slice(2)) {
    if (raw === "--dry-run") args.dryRun = true;
    else if (raw === "--force") args.force = true;
    else if (raw.startsWith("--concurrency=")) args.concurrency = Number(raw.slice("--concurrency=".length));
    else if (raw.startsWith("--limit=")) args.limit = Number(raw.slice("--limit=".length));
    else if (raw.startsWith("--model=")) args.model = raw.slice("--model=".length);
    else if (raw.startsWith("--max-depth=")) args.maxDepth = Number(raw.slice("--max-depth=".length));
  }
  args.concurrency = Number.isFinite(args.concurrency) && args.concurrency > 0 ? Math.trunc(args.concurrency) : 32;
  args.maxDepth = Number.isFinite(args.maxDepth) && args.maxDepth > 0 ? Math.trunc(args.maxDepth) : 7;
  if (args.limit !== null) {
    args.limit = Number.isFinite(args.limit) && args.limit > 0 ? Math.trunc(args.limit) : null;
  }
  return args;
}

function normalize(s) {
  if (typeof s !== "string") return "";
  return s
    .toLowerCase()
    .trim()
    .replace(/[《》「」『』【】（）()【】〈〉<>"'·•‧:：,，.。!!??；;\-\s—–]+/g, "");
}

function stableId(kgid) {
  const h = crypto.createHash("sha1").update(kgid).digest("hex").slice(0, 12);
  return `kgx_${h}`;
}

function atomicWriteJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 0));
  fs.renameSync(tmp, file);
}

function buildKgLookup(kg) {
  const kgBookById = new Map();
  const kgIdByKey = new Map();
  for (const b of kg) {
    kgBookById.set(b.id, b);
    const pr = typeof b.pr === "number" ? b.pr : 0;
    const titles = [b.title, b.titleEn].filter((t) => typeof t === "string" && t.length > 0);
    const authors = [b.author, b.authorEn].filter((t) => typeof t === "string" && t.length > 0);
    for (const t of titles) {
      for (const a of authors) {
        const key = `${normalize(t)}|${normalize(a)}`;
        const existingId = kgIdByKey.get(key);
        if (existingId === undefined || (kgBookById.get(existingId)?.pr ?? 0) < pr) {
          kgIdByKey.set(key, b.id);
        }
      }
      const titleKey = `${normalize(t)}|`;
      const existingId = kgIdByKey.get(titleKey);
      if (existingId === undefined || (kgBookById.get(existingId)?.pr ?? 0) < pr) {
        kgIdByKey.set(titleKey, b.id);
      }
    }
  }
  const lookupKgId = (t, a) => {
    const tNorm = normalize(t);
    const aNorm = normalize(a);
    if (tNorm.length === 0) return null;
    return kgIdByKey.get(`${tNorm}|${aNorm}`) ?? kgIdByKey.get(`${tNorm}|`) ?? null;
  };
  return { kgBookById, lookupKgId };
}

function buildAdjacency(edges) {
  const inEdgesByKg = new Map();
  const outEdgesByKg = new Map();
  for (const e of edges) {
    if (!inEdgesByKg.has(e.to)) inEdgesByKg.set(e.to, []);
    inEdgesByKg.get(e.to).push(e);
    if (!outEdgesByKg.has(e.from)) outEdgesByKg.set(e.from, []);
    outEdgesByKg.get(e.from).push(e);
  }
  return { inEdgesByKg, outEdgesByKg };
}

function topPeers(kgId, dir, adjacency, kgBookById) {
  const list = dir === "up"
    ? (adjacency.inEdgesByKg.get(kgId) ?? [])
    : (adjacency.outEdgesByKg.get(kgId) ?? []);
  return list
    .map((e) => (dir === "up" ? e.from : e.to))
    .filter((id) => kgBookById.has(id))
    .sort((a, b) => (kgBookById.get(b)?.pr ?? 0) - (kgBookById.get(a)?.pr ?? 0))
    .slice(0, MAX_NEIGHBORS_PER_DIR);
}

function computeClosureTargets(deeply, kg, edges, maxDepth) {
  const { kgBookById, lookupKgId } = buildKgLookup(kg);
  const adjacency = buildAdjacency(edges);
  const seedIds = new Set(deeply.map((b) => lookupKgId(b.t, b.a)).filter(Boolean));
  const closure = new Set(seedIds);
  // 目标排序用:一个 missing node 被原始 5569 seed 的 top 邻居引用了多少次。
  // 只需要 seed 层频次,不需要对最终 closure 做 O(target*seed) 二次扫描。
  const seedRefCount = new Map();
  for (const seed of seedIds) {
    for (const p of [
      ...topPeers(seed, "up", adjacency, kgBookById),
      ...topPeers(seed, "down", adjacency, kgBookById)
    ]) {
      seedRefCount.set(p, (seedRefCount.get(p) ?? 0) + 1);
    }
  }

  for (let iter = 1; iter <= maxDepth; iter += 1) {
    let added = 0;
    const snapshot = [...closure];
    for (const id of snapshot) {
      for (const p of [
        ...topPeers(id, "up", adjacency, kgBookById),
        ...topPeers(id, "down", adjacency, kgBookById)
      ]) {
        if (!closure.has(p)) {
          closure.add(p);
          added += 1;
        }
      }
    }
    console.log(`[closure] iter=${iter} total=${closure.size} added=${added}`);
    if (added === 0) break;
  }

  const targets = [...closure]
    .filter((id) => !seedIds.has(id))
    .map((id) => {
      const b = kgBookById.get(id);
      return { kgid: id, book: b, referencedBySeeds: seedRefCount.get(id) ?? 0 };
    })
    .filter((x) => x.book !== undefined)
    .sort((a, b) =>
      b.referencedBySeeds - a.referencedBySeeds ||
      (b.book.pr ?? 0) - (a.book.pr ?? 0)
    );

  return { targets, seedCount: seedIds.size, closureCount: closure.size };
}

function loadExisting() {
  if (!fs.existsSync(OUT)) return [];
  const raw = JSON.parse(fs.readFileSync(OUT, "utf8"));
  return Array.isArray(raw) ? raw : [];
}

function cleanJsonText(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }
  return trimmed;
}

function buildPrompt({ book, referencedBySeeds }) {
  const meta = {
    title: book.title ?? "",
    titleEn: book.titleEn ?? "",
    author: book.author ?? "",
    authorEn: book.authorEn ?? "",
    year: book.year ?? null,
    country: book.country ?? "",
    kgCategory: book.category ?? "",
    pagerank: book.pr ?? 0,
    referencedBySeeds
  };
  return [
    {
      role: "system",
      content: [
        "你是 Deeply 课程库的中文编辑。",
        "任务: 为一本即将补入课程库的书生成元数据。",
        "必须只输出 JSON,不能输出 markdown,不能输出解释。",
        "字段:",
        "- c: 必须从给定九个中文分类中选一个",
        "- d: 8-18 字中文子领域",
        "- h: 12-28 字中文 hook/副标题,像出版编辑写的定位语",
        "- p: 180-260 字中文推荐文案,克制、具体,说明这本书讲什么、为什么值得精读、读者会获得什么",
        "- e: 20-45 字中文 TODAY'S ECHO,说明这本书为什么今天仍重要,不要写成营销语",
        "九个分类: " + CATEGORY_NAMES.join(" / "),
        "如果书名或作者是英文,输出中文常用译名;没有通行译名时保留英文。"
      ].join("\n")
    },
    {
      role: "user",
      content: `请为这本书生成 Deeply metadata:\n${JSON.stringify(meta, null, 2)}`
    }
  ];
}

function validateGenerated(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("response is not object");
  }
  const c = typeof value.c === "string" ? value.c.trim() : "";
  const d = typeof value.d === "string" ? value.d.trim() : "";
  const h = typeof value.h === "string" ? value.h.trim() : "";
  const p = typeof value.p === "string" ? value.p.trim() : "";
  const e = typeof value.e === "string" ? value.e.trim() : "";
  if (!CATEGORY_NAMES.includes(c)) throw new Error(`bad category: ${c}`);
  if (d.length === 0 || h.length === 0 || p.length < 50 || e.length === 0) {
    throw new Error("missing/too-short fields");
  }
  return {
    c,
    d: d.slice(0, 24),
    // UI 上 hook 是标题下方 1-2 行,太长会压版面。模型偶尔不听长度,
    // 这里硬裁一刀。
    h: h.slice(0, 44),
    p: p.slice(0, 320),
    e: e.slice(0, 72)
  };
}

async function callOpenRouter({ model, messages, signal }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is missing");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://koko-chat.local",
      "X-Title": "KokoChat Deeply Library Enricher"
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.25,
      max_tokens: 900,
      response_format: { type: "json_object" }
    }),
    signal
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 240)}`);
  }
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("missing choices[0].message.content");
  return JSON.parse(cleanJsonText(content));
}

async function generateOne(target, { model }) {
  const { book, kgid, referencedBySeeds } = target;
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 90_000);
      try {
        const raw = await callOpenRouter({
          model,
          messages: buildPrompt({ book, referencedBySeeds }),
          signal: controller.signal
        });
        const generated = validateGenerated(raw);
        return {
          id: stableId(kgid),
          kgid,
          ext: 1,
          t: book.title ?? "",
          a: book.author ?? "",
          c: generated.c,
          d: generated.d,
          s: 85,
          pr: Math.round((book.pr ?? 0) * 100) / 100,
          img: "",
          h: generated.h,
          p: generated.p,
          e: generated.e,
          u: [],
          dw: []
        };
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      lastErr = err;
      const wait = 750 * attempt * attempt + Math.floor(Math.random() * 250);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr ?? new Error("unknown generation error");
}

async function main() {
  const args = parseArgs(process.argv);
  const deeply = JSON.parse(fs.readFileSync(SRC_DEEPLY, "utf8"));
  const kg = JSON.parse(fs.readFileSync(SRC_KG, "utf8"));
  const edges = JSON.parse(fs.readFileSync(SRC_EDGES, "utf8"));
  const { targets, seedCount, closureCount } = computeClosureTargets(deeply, kg, edges, args.maxDepth);

  const existing = loadExisting();
  const existingByKgid = new Map(existing.map((x) => [x.kgid, x]));
  let todo = targets.filter((t) => args.force || !existingByKgid.has(t.kgid));
  if (args.limit !== null) todo = todo.slice(0, args.limit);

  console.log("\n=== target stats ===");
  console.log(`seed books in KG: ${seedCount}`);
  console.log(`closure books: ${closureCount}`);
  console.log(`extra target total: ${targets.length}`);
  console.log(`existing generated: ${existing.length}`);
  console.log(`todo this run: ${todo.length}`);
  console.log(`model: ${args.model}`);
  console.log(`concurrency: ${args.concurrency}`);
  console.log(`out: ${OUT}`);

  if (args.dryRun) {
    console.log("\nTop 30 todo:");
    for (const t of todo.slice(0, 30)) {
      console.log(`${String(t.referencedBySeeds).padStart(4)} ${String((t.book.pr ?? 0).toFixed(1)).padStart(8)} ${t.book.title} / ${t.book.author} (${t.kgid})`);
    }
    return;
  }

  const results = args.force ? [] : [...existing];
  const resultKgids = new Set(results.map((x) => x.kgid));
  let done = 0;
  let failed = 0;
  let cursor = 0;
  const startedAt = Date.now();

  function save() {
    const dedup = [];
    const seen = new Set();
    for (const item of results) {
      if (seen.has(item.kgid)) continue;
      seen.add(item.kgid);
      dedup.push(item);
    }
    dedup.sort((a, b) => (b.pr ?? 0) - (a.pr ?? 0));
    atomicWriteJson(OUT, dedup);
  }

  async function worker(workerId) {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= todo.length) return;
      const target = todo[i];
      if (resultKgids.has(target.kgid)) continue;
      try {
        const item = await generateOne(target, { model: args.model });
        results.push(item);
        resultKgids.add(item.kgid);
        done += 1;
        if (done % 10 === 0 || done <= 5) {
          const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
          console.log(`[ok] ${done}/${todo.length} failed=${failed} elapsed=${elapsed}s :: ${item.t} / ${item.a}`);
          save();
        }
      } catch (err) {
        failed += 1;
        console.error(`[fail] worker=${workerId} ${target.book.title} / ${target.book.author}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  await Promise.all(Array.from({ length: args.concurrency }, (_, i) => worker(i + 1)));
  save();
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`\nDone. generated this run=${done}, failed=${failed}, total file=${loadExisting().length}, elapsed=${elapsed}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

