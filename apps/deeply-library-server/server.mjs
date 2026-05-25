#!/usr/bin/env node
/**
 * Deeply 课程库静态数据服务。
 *
 * 目的:把客户端原本打包进 RN bundle 的 `library-pool.json`(~30MB)
 *      搬到服务端,客户端按需 fetch。bundle 体积大幅缩小,真机启动快。
 *
 * 设计:
 *   - 启动时一次性 load JSON 进内存,后续全部 in-memory lookup,
 *     不引入 SQLite / DB(15858 本规模完全够用,后期再上 DB)。
 *   - 列表 API 默认只返回轻量字段(给主页/分类列表用),详情 API 返回
 *     全字段(给单本详情 + 知识谱系 + 关系卡用)。
 *   - 路径前缀 `/library` 而非 `/v1/library`,后续若引入版本/auth 再前缀。
 *   - prod 部署在 Komako exchange 服务器(deeply.plus 同台),systemd 守护
 *     + Caddy 在 :443 反代 `/library/*` 到本地 `127.0.0.1:8788`。详见
 *     `deploy/` 目录 + 包根 `README.md`。
 *
 * Env:
 *   LIBRARY_PORT     默认 8788
 *   LIBRARY_HOST     默认 0.0.0.0(LAN / 容器都能访问);prod 显式设
 *                    127.0.0.1,Caddy 负责暴露公网
 *   LIBRARY_POOL_PATH override 数据文件路径(默认 miniapps/deeply/data/library-pool.json)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_POOL = path.resolve(HERE, "../../miniapps/deeply/data/library-pool.json");
const POOL_PATH = process.env.LIBRARY_POOL_PATH ?? DEFAULT_POOL;
const PORT = Number(process.env.LIBRARY_PORT ?? 8788);
// dev / prod 都默认 bind 0.0.0.0:
//   - dev 期真机要从 LAN IP 访问;
//   - prod 走 cloudflared tunnel 也是从本机 127.0.0.1 反代过去,绑 0.0.0.0
//     不影响安全(防火墙 / cloudflared 才是边界)。
const HOST = process.env.LIBRARY_HOST ?? "0.0.0.0";

const LIST_FIELDS = ["id", "t", "a", "c", "d", "s", "pr", "img", "h"];

function loadPool() {
  if (!fs.existsSync(POOL_PATH)) {
    throw new Error(`pool file not found: ${POOL_PATH}`);
  }
  const raw = fs.readFileSync(POOL_PATH, "utf8");
  const items = JSON.parse(raw);
  if (!Array.isArray(items)) throw new Error("pool root must be an array");
  return items;
}

function buildIndices(pool) {
  const byId = new Map();
  const byCategory = new Map();
  const categoryCounts = new Map();
  for (const b of pool) {
    if (typeof b?.id !== "string") continue;
    byId.set(b.id, b);
    const cat = typeof b.c === "string" ? b.c : "";
    if (cat.length > 0) {
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat).push(b);
      categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
    }
  }
  // 每个分类按 "经典度" 排好(pr desc, score desc),前端拿到就不需要再排。
  for (const arr of byCategory.values()) {
    arr.sort((x, y) => (y.pr ?? 0) - (x.pr ?? 0) || (y.s ?? 0) - (x.s ?? 0));
  }
  return { byId, byCategory, categoryCounts };
}

function slim(book) {
  const out = {};
  for (const key of LIST_FIELDS) {
    if (book[key] !== undefined) out[key] = book[key];
  }
  return out;
}

function makeServer(pool) {
  const { byId, byCategory, categoryCounts } = buildIndices(pool);

  const app = new Hono();
  // dev 期允许任意 origin;生产环境可以收紧到 KokoChat 客户端域名 / Expo Go 等。
  app.use("*", cors({ origin: "*", allowMethods: ["GET", "OPTIONS"] }));

  app.get("/healthz", (c) =>
    c.json({ ok: true, totalBooks: pool.length, categories: categoryCounts.size })
  );

  /** GET /library/categories — 9 个分类及书数,按数量降序。 */
  app.get("/library/categories", (c) => {
    const list = [...categoryCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
    return c.json({ categories: list, total: pool.length });
  });

  /**
   * GET /library/home — 首页一次拿全:9 个分类摘要,每个分类 top N 本(默认 6)
   * 的 list 字段。客户端首屏一个 request 就足以渲染。
   */
  app.get("/library/home", (c) => {
    const topN = Math.max(1, Math.min(20, Number(c.req.query("top") ?? "6") || 6));
    const summaries = [...categoryCounts.entries()]
      .map(([name, count]) => {
        const books = (byCategory.get(name) ?? []).slice(0, topN).map(slim);
        return { name, count, topBooks: books };
      })
      .sort((a, b) => b.count - a.count);
    return c.json({ categories: summaries, total: pool.length });
  });

  /**
   * GET /library/books?cat=xxx&page=N&limit=M&fields=list|full
   * 默认返回 list 字段(适合主页 / 分类列表);fields=full 返回全字段(很贵,谨慎)。
   * 不带 cat 时返回全库分页(按 pr 降序)。
   */
  app.get("/library/books", (c) => {
    const cat = c.req.query("cat") ?? "";
    const fields = c.req.query("fields") ?? "list";
    const page = Math.max(1, Number(c.req.query("page") ?? "1") || 1);
    const limit = Math.max(1, Math.min(500, Number(c.req.query("limit") ?? "60") || 60));

    let source;
    if (cat.length > 0) {
      source = byCategory.get(cat) ?? [];
    } else {
      source = pool;
    }
    const offset = (page - 1) * limit;
    const sliced = source.slice(offset, offset + limit);
    const items = fields === "full" ? sliced : sliced.map(slim);
    return c.json({
      items,
      total: source.length,
      page,
      limit,
      hasMore: offset + limit < source.length
    });
  });

  /**
   * GET /library/books/:id — 单本全字段(含 ue/de 知识谱系)。
   * 知识谱系卡 ue/de 里每条 peer 顺手 inline `img`(从 byId 拿),
   * 客户端就能直接渲染真封面,不需要为每条邻居再发一次 detail 请求。
   */
  app.get("/library/books/:id", (c) => {
    const id = c.req.param("id");
    const book = byId.get(id);
    if (book === undefined) {
      return c.json({ error: "not_found", id }, 404);
    }
    const enrich = (edges) =>
      Array.isArray(edges)
        ? edges.map((e) => {
            const peer = e.pid !== undefined ? byId.get(e.pid) : undefined;
            const img = peer?.img ?? "";
            return img.length > 0 ? { ...e, img } : e;
          })
        : edges;
    const out = {
      ...book,
      ue: enrich(book.ue),
      de: enrich(book.de)
    };
    return c.json({ book: out });
  });

  /**
   * GET /library/search?q=xxx&limit=N — title/author 子串搜索,top N。
   * 简单 substring,后续可换 fuzzy。
   */
  app.get("/library/search", (c) => {
    const q = (c.req.query("q") ?? "").trim().toLowerCase();
    const limit = Math.max(1, Math.min(50, Number(c.req.query("limit") ?? "20") || 20));
    if (q.length === 0) return c.json({ items: [], query: q });
    const out = [];
    for (const b of pool) {
      const hay = `${b.t ?? ""}|${b.a ?? ""}`.toLowerCase();
      if (hay.includes(q)) {
        out.push(slim(b));
        if (out.length >= limit) break;
      }
    }
    return c.json({ items: out, query: q });
  });

  return app;
}

const pool = loadPool();
console.log(`[deeply-library] loaded ${pool.length} books from ${POOL_PATH}`);
const app = makeServer(pool);
serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`[deeply-library] listening on http://${HOST}:${info.port}`);
});
