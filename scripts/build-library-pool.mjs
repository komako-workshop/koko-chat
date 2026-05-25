#!/usr/bin/env node
/**
 * Build `miniapps/deeply/data/library-pool.json`:
 *   - 读 deeply discover-pool.json(5569 本带 metadata)
 *   - 读 book-knowledge-graph books_merged.json(34819 本带 PageRank)
 *   - 按 normalize(title)+normalize(author) join,给每条 deeply book 加 `pr` 字段
 *   - 没 match 的 pr=0(列表排序时落到 explain_score 兜底)
 *
 * 这只是 build 期一次性脚本,跑出来的 JSON 直接 import 进 RN bundle。
 * 跑法:`node scripts/build-library-pool.mjs`
 */
import fs from "node:fs";
import path from "node:path";

const SRC_DEEPLY = "/Users/lijianren/workspace/deeply/public/data/discover-pool.json";
const SRC_KG = "/Users/lijianren/workspace/demo/book-knowledge-graph/graph-data/books_merged.json";
const SRC_EDGES = "/Users/lijianren/workspace/demo/book-knowledge-graph/graph-data/edges_merged.json";
const SRC_EXTRA = "/Users/lijianren/Desktop/workspace/koko-chat/miniapps/deeply/data/library-extra-books.generated.json";
const OUT = "/Users/lijianren/Desktop/workspace/koko-chat/miniapps/deeply/data/library-pool.json";
const COVERS_PATH = "/Users/lijianren/Desktop/workspace/koko-chat/miniapps/deeply/data/library-covers.generated.json";
const LIBRARY_COVERS_PUBLIC_BASE = (process.env.LIBRARY_COVERS_PUBLIC_BASE ?? "https://deeply.plus/covers").replace(/\/+$/, "");

// 每本书 upstream / downstream 各保留多少邻居(top by peer PageRank)
const MAX_NEIGHBORS_PER_DIR = 6;

function normalize(s) {
  if (typeof s !== "string") return "";
  return s
    .toLowerCase()
    .trim()
    // 去标点 / 书名号 / 括号 / 空格
    .replace(/[《》「」『』【】（）()【】〈〉<>"'·•‧:：,，.。!!??；;\-\s—–]+/g, "");
}

const deeplyBase = JSON.parse(fs.readFileSync(SRC_DEEPLY, "utf8"));
const deeplyExtraRaw = fs.existsSync(SRC_EXTRA)
  ? JSON.parse(fs.readFileSync(SRC_EXTRA, "utf8"))
  : [];
const libraryCovers = fs.existsSync(COVERS_PATH)
  ? JSON.parse(fs.readFileSync(COVERS_PATH, "utf8"))
  : { items: {} };
// Extra 池由 KG 邻居扩展生成,可能和 base pool 里的书是同一本但标题写法
// 略不同(例如 "奥德赛" vs "《奥德赛》")。合并时先按 normalized(title+author)
// 去重,base 优先保留。
const baseBookByExactKey = new Map(deeplyBase.map((b) => [`${normalize(b.t)}|${normalize(b.a)}`, b]));
const duplicateExtraKgToBaseId = new Map();
const deeplyExtra = deeplyExtraRaw.filter((b) => {
  const key = `${normalize(b.t)}|${normalize(b.a)}`;
  const base = baseBookByExactKey.get(key);
  if (base !== undefined) {
    if (typeof b.kgid === "string" && b.kgid.length > 0) {
      duplicateExtraKgToBaseId.set(b.kgid, base.id);
    }
    return false;
  }
  return true;
});
const deeply = [...deeplyBase, ...deeplyExtra];
const kg = JSON.parse(fs.readFileSync(SRC_KG, "utf8"));
const edges = JSON.parse(fs.readFileSync(SRC_EDGES, "utf8"));
console.log(`deeply base pool: ${deeplyBase.length} 本`);
console.log(`deeply generated extra pool: ${deeplyExtraRaw.length} 本`);
console.log(`deeply generated extra after base de-dupe: ${deeplyExtra.length} 本`);
console.log(`deeply combined pool: ${deeply.length} 本`);
console.log(`kg books: ${kg.length} 本`);
console.log(`kg edges: ${edges.length} 条`);

// 建 kg 的 (title|titleEn × author|authorEn) lookup
//   - kgPrByKey: key → pr(用于给 deeply pool 加 pr 字段)
//   - kgIdByKey: key → kg_id(用于把 deeply 书 → kg id,然后查邻居)
//   - kgBookById: kg_id → book(查邻居完整 metadata)
const kgPrByKey = new Map();
const kgIdByKey = new Map();
const kgBookById = new Map();
for (const b of kg) {
  kgBookById.set(b.id, b);
  const pr = typeof b.pr === "number" ? b.pr : 0;
  const titles = [b.title, b.titleEn].filter((t) => typeof t === "string" && t.length > 0);
  const authors = [b.author, b.authorEn].filter((t) => typeof t === "string" && t.length > 0);
  for (const t of titles) {
    for (const a of authors) {
      const key = `${normalize(t)}|${normalize(a)}`;
      if (pr > 0) {
        const existing = kgPrByKey.get(key);
        if (existing === undefined || existing < pr) kgPrByKey.set(key, pr);
      }
      // id mapping:同 key 撞多个 kg 节点时,保留 pr 更高的(经典版本优先)
      const existingId = kgIdByKey.get(key);
      if (
        existingId === undefined ||
        (kgBookById.get(existingId)?.pr ?? 0) < pr
      ) {
        kgIdByKey.set(key, b.id);
      }
    }
    const titleKey = `${normalize(t)}|`;
    if (pr > 0) {
      const existing = kgPrByKey.get(titleKey);
      if (existing === undefined || existing < pr) kgPrByKey.set(titleKey, pr);
    }
    const existingId = kgIdByKey.get(titleKey);
    if (
      existingId === undefined ||
      (kgBookById.get(existingId)?.pr ?? 0) < pr
    ) {
      kgIdByKey.set(titleKey, b.id);
    }
  }
}
console.log(`kg lookup keys: ${kgPrByKey.size}`);

// 建 edges 的 in/out adjacency by kg_id。in = 该节点作为 to(被影响),out = 作为 from(影响后人)。
const inEdgesByKg = new Map();
const outEdgesByKg = new Map();
for (const e of edges) {
  if (!inEdgesByKg.has(e.to)) inEdgesByKg.set(e.to, []);
  inEdgesByKg.get(e.to).push(e);
  if (!outEdgesByKg.has(e.from)) outEdgesByKg.set(e.from, []);
  outEdgesByKg.get(e.from).push(e);
}
console.log(`adjacency:in-edges 节点 ${inEdgesByKg.size}, out-edges 节点 ${outEdgesByKg.size}`);

// 第一遍:给每本 deeply book 找到 kg_id(用于查邻居)。先 collect 所有 pool-to-kg mapping。
function lookupKgId(t, a, knownKgId) {
  if (typeof knownKgId === "string" && knownKgId.length > 0) return knownKgId;
  const tNorm = normalize(t);
  const aNorm = normalize(a);
  if (tNorm.length === 0) return null;
  return kgIdByKey.get(`${tNorm}|${aNorm}`) ?? kgIdByKey.get(`${tNorm}|`) ?? null;
}

const poolKgIds = deeply.map((b) => lookupKgId(b.t, b.a, b.kgid));
const kgIdToPoolId = new Map();
deeply.forEach((b, i) => {
  const kgId = poolKgIds[i];
  if (kgId !== null && !kgIdToPoolId.has(kgId)) kgIdToPoolId.set(kgId, b.id);
});
// 被 de-dupe 掉的 extra 仍然要保留 kgid → base pool id 的别名,否则其它书
// 指向这个 kg 节点时会失去 pid,导致卡片不可点。
for (const [kgid, baseId] of duplicateExtraKgToBaseId.entries()) {
  if (!kgIdToPoolId.has(kgid)) kgIdToPoolId.set(kgid, baseId);
}
console.log(`pool → kg id mapping: ${poolKgIds.filter((x) => x !== null).length}/${deeply.length}`);

function neighborsFor(kgId, dir) {
  // dir = 'up'(本书的 source,即 in-edges,peer = edge.from)
  // dir = 'down'(本书的后人,即 out-edges,peer = edge.to)
  if (kgId === null) return [];
  const list = dir === "up" ? (inEdgesByKg.get(kgId) ?? []) : (outEdgesByKg.get(kgId) ?? []);
  const out = [];
  for (const e of list) {
    const peerId = dir === "up" ? e.from : e.to;
    const peer = kgBookById.get(peerId);
    if (peer === undefined) continue;
    out.push({
      rel: e.type,
      t: peer.title ?? "",
      a: peer.author ?? "",
      y: typeof peer.year === "number" ? peer.year : null,
      pr: typeof peer.pr === "number" ? peer.pr : 0,
      pid: kgIdToPoolId.get(peerId) ?? null
    });
  }
  // 按 peer pagerank 排,top N
  out.sort((x, y) => y.pr - x.pr);
  return out.slice(0, MAX_NEIGHBORS_PER_DIR).map((n) => {
    const r = { rel: n.rel, t: n.t, a: n.a };
    if (n.y !== null) r.y = n.y;
    if (n.pid !== null) r.pid = n.pid;
    return r;
  });
}

// Join + slim:keep deeply 全字段,加 `pr` / `ue` / `de` 字段
let matched = 0, fallbackTitle = 0, unmatched = 0;
let upTotal = 0, downTotal = 0, edgeBooks = 0;
const out = deeply.map((b, i) => {
  const tNorm = normalize(b.t);
  const aNorm = normalize(b.a);
  let pr = 0;
  if (tNorm.length > 0) {
    pr = kgPrByKey.get(`${tNorm}|${aNorm}`) ?? 0;
    if (pr > 0) matched += 1;
    else {
      pr = kgPrByKey.get(`${tNorm}|`) ?? 0;
      if (pr > 0) fallbackTitle += 1;
      else unmatched += 1;
    }
  } else {
    unmatched += 1;
  }
  let img = b.img ?? "";
  if (img.includes("?")) img = img.split("?")[0];
  const kgId = poolKgIds[i];
  const ue = neighborsFor(kgId, "up");
  const de = neighborsFor(kgId, "down");
  if (ue.length + de.length > 0) edgeBooks += 1;
  upTotal += ue.length;
  downTotal += de.length;
  return {
    id: b.id,
    ...(b.kgid !== undefined ? { kgid: b.kgid } : {}),
    ...(b.ext !== undefined ? { ext: b.ext } : {}),
    t: b.t,
    a: b.a,
    c: b.c,
    d: b.d ?? "",
    s: b.s ?? 0,
    pr: Math.round(pr * 100) / 100,
    img,
    h: b.h ?? "",
    p: b.p ?? "",
    e: b.e ?? "",
    // 原 LLM 生成的字符串保留作 fallback / 调试用,但客户端优先用 ue/de
    u: Array.isArray(b.u) ? b.u : [],
    dw: Array.isArray(b.dw) ? b.dw : [],
    // ↓ 新增:从 kg edges_merged.json join 出来的真实邻居,每条带 pool id(如果在 deeply pool 里就可点)
    ue,
    de
  };
});

let coverMapped = 0;
for (const book of out) {
  if (typeof book.img === "string" && book.img.length > 0) continue;
  const meta = libraryCovers.items?.[book.id];
  if (meta?.filename) {
    book.img = `${LIBRARY_COVERS_PUBLIC_BASE}/${meta.filename}`;
    coverMapped += 1;
  }
}

console.log(`\n=== match 统计 ===`);
console.log(`  title+author 精确:${matched}`);
console.log(`  title only fallback:${fallbackTitle}`);
console.log(`  完全没 match(pr=0):${unmatched}`);
console.log(`  match rate: ${((matched + fallbackTitle) / deeply.length * 100).toFixed(1)}%`);

console.log(`\n=== 邻居 join 统计 ===`);
console.log(`  有邻居的 deeply book: ${edgeBooks}/${deeply.length}`);
console.log(`  总 upstream 边: ${upTotal}, 总 downstream 边: ${downTotal}`);
console.log(`  平均 upstream: ${(upTotal/deeply.length).toFixed(1)}, downstream: ${(downTotal/deeply.length).toFixed(1)}`);

// 邻居能跳到 pool 里的比例
const upPidHit = out.reduce((acc, b) => acc + (b.ue ?? []).filter((n) => n.pid !== undefined).length, 0);
const downPidHit = out.reduce((acc, b) => acc + (b.de ?? []).filter((n) => n.pid !== undefined).length, 0);
console.log(`  邻居中能跳 pool 的: up ${upPidHit}/${upTotal} (${(100*upPidHit/upTotal).toFixed(1)}%), down ${downPidHit}/${downTotal} (${(100*downPidHit/downTotal).toFixed(1)}%)`);

console.log(`\n=== cover mapping 统计 ===`);
console.log(`  mapping items: ${Object.keys(libraryCovers.items ?? {}).length}`);
console.log(`  filled empty img from mapping: ${coverMapped}`);
console.log(`  img coverage: ${out.filter((b) => typeof b.img === "string" && b.img.length > 0).length}/${out.length} (${(100*out.filter((b) => typeof b.img === "string" && b.img.length > 0).length/out.length).toFixed(1)}%)`);

// PR top 20 sanity check
const withPr = out.filter((b) => b.pr > 0);
withPr.sort((a, b) => b.pr - a.pr);
console.log(`\n=== top 20 PageRank ===`);
for (const b of withPr.slice(0, 20)) {
  console.log(`  ${b.pr.toFixed(1).padStart(8)}  ${b.t} / ${b.a}  [${b.c}]`);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 0));
console.log(`\nwrote ${OUT}`);
console.log(`size: ${(fs.statSync(OUT).size / 1024 / 1024).toFixed(2)} MB`);
