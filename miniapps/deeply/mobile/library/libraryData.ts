/**
 * Deeply 课程库的数据访问层 — 客户端走 HTTP 拿数据。
 *
 * 数据源:`@koko/deeply-library-server`(默认 dev 跑在 127.0.0.1:8788)。
 * API base 从 `Constants.expoConfig.extra.deeplyLibraryApiBase` 读;
 * 真机走 LAN(`dev-start.mjs` 注入)、生产走线上域名。
 *
 * 设计:
 *   - 首页 / 分类页 / 详情页都是 async,导出函数都返回 Promise。
 *   - 内存 memo:同一 category / book id 只 fetch 一次,后续从 cache 拿。
 *   - **不再把 library-pool.json 打进 RN bundle**(从 ~30MB → 0)。
 */
import Constants from "expo-constants";

export interface LibraryBook {
  id: string;
  t: string;
  a: string;
  c: string;
  d: string;
  s: number;
  pr: number;
  img: string;
  /** Hook 副标题(详情页才填,列表 API 也带)。 */
  h: string;
  /** Pitch 长文(只详情 API 返回)。 */
  p?: string;
  /** TODAY's ECHO(只详情 API)。 */
  e?: string;
  /** Legacy upstream / downstream 字符串(只详情 API)。 */
  u?: string[];
  dw?: string[];
  /**
   * upstream edges — 从图谱 join 出的真实邻居,带 pid 可直接跳。
   * 只在详情 API 返回。
   */
  ue?: LibraryEdge[];
  /** downstream edges — 同上反向。 */
  de?: LibraryEdge[];
}

export interface LibraryEdge {
  rel: "inherit" | "inspire" | "respond" | "critique" | "transform" | "synthesize";
  t: string;
  a: string;
  y?: number;
  /** peer 在 deeply pool 里的 id;有就可点跳。 */
  pid?: string;
  /** peer 封面 URL(server 端 inline,客户端直接渲染)。 */
  img?: string;
}

export interface LibraryCategorySummary {
  name: string;
  count: number;
  /** Top N(server 端按 pr+score 排好;客户端只拿来横滚展示)。 */
  topBooks: LibraryBook[];
}

// ─────────── Config / fetch base ───────────

function getApiBase(): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as { deeplyLibraryApiBase?: string };
  const base = extra.deeplyLibraryApiBase;
  if (typeof base === "string" && base.length > 0) return base.replace(/\/+$/, "");
  return "http://127.0.0.1:8788";
}

async function fetchJson<T>(path: string): Promise<T> {
  const url = `${getApiBase()}${path}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`fetch ${path} failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// ─────────── Memo caches ───────────
//
// 这些 cache 是模块级单例。在 dev hot reload / 真机后台→前台返回 时也会
// 保留(直到 JS context 重启)。后续如果想强制刷新可以加 invalidate API,
// MVP 先不做。

interface HomePayload {
  categories: LibraryCategorySummary[];
  total: number;
}

let homeCache: HomePayload | null = null;
let homeInflight: Promise<HomePayload> | null = null;

const booksByCategoryCache = new Map<string, LibraryBook[]>();
const booksByCategoryInflight = new Map<string, Promise<LibraryBook[]>>();

const bookByIdCache = new Map<string, LibraryBook>();
const bookByIdInflight = new Map<string, Promise<LibraryBook | null>>();

async function ensureHome(): Promise<HomePayload> {
  if (homeCache !== null) return homeCache;
  if (homeInflight !== null) return homeInflight;
  homeInflight = (async () => {
    const data = await fetchJson<HomePayload>("/library/home?top=6");
    homeCache = data;
    return data;
  })();
  try {
    return await homeInflight;
  } finally {
    homeInflight = null;
  }
}

/** 9 个分类摘要(name + count + top 6 books)。 */
export async function listCategories(): Promise<LibraryCategorySummary[]> {
  const home = await ensureHome();
  return home.categories;
}

/** 总书数(供首页 hero 显示)。 */
export async function getTotalBookCount(): Promise<number> {
  const home = await ensureHome();
  return home.total;
}

/**
 * 取某分类内**全部**书(server 端已按 pr+s 排好)。第一次 fetch 后内存缓存。
 * 客户端不再做排序。
 */
export async function listBooksByCategory(categoryName: string): Promise<LibraryBook[]> {
  const cached = booksByCategoryCache.get(categoryName);
  if (cached !== undefined) return cached;
  const inflight = booksByCategoryInflight.get(categoryName);
  if (inflight !== undefined) return inflight;
  // server 默认 limit 60,这里给 5000 把分类全部拉回(单个分类几百-几千本)。
  const promise = (async () => {
    const out: LibraryBook[] = [];
    let page = 1;
    for (;;) {
      const data = await fetchJson<{
        items: LibraryBook[];
        total: number;
        hasMore: boolean;
      }>(
        `/library/books?cat=${encodeURIComponent(categoryName)}&page=${page}&limit=500&fields=list`
      );
      out.push(...data.items);
      if (!data.hasMore) break;
      page += 1;
      if (page > 50) break; // 安全阀:不太可能某个分类超过 2.5w 本
    }
    booksByCategoryCache.set(categoryName, out);
    // 顺手把它们灌进 bookByIdCache(列表字段;详情字段还得专门 fetch)
    for (const b of out) {
      if (!bookByIdCache.has(b.id)) bookByIdCache.set(b.id, b);
    }
    return out;
  })();
  booksByCategoryInflight.set(categoryName, promise);
  try {
    return await promise;
  } finally {
    booksByCategoryInflight.delete(categoryName);
  }
}

/** 按 id 取单本(全字段:h/p/e/u/dw/ue/de 都带)。 */
export async function getBookById(id: string): Promise<LibraryBook | null> {
  const cached = bookByIdCache.get(id);
  // 列表 API 也会塞进 cache,但只有 list 字段;详情页必须保证有 p/e/ue/de,
  // 用 `p` 是否存在判定 cache 是否"详情完整"。
  if (cached !== undefined && cached.p !== undefined) return cached;
  const inflight = bookByIdInflight.get(id);
  if (inflight !== undefined) return inflight;
  const promise = (async () => {
    try {
      const data = await fetchJson<{ book: LibraryBook }>(
        `/library/books/${encodeURIComponent(id)}`
      );
      bookByIdCache.set(id, data.book);
      return data.book;
    } catch (err) {
      // 404 → null;其它真错误才向上抛
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes(" 404 ")) return null;
      throw err;
    }
  })();
  bookByIdInflight.set(id, promise);
  try {
    return await promise;
  } finally {
    bookByIdInflight.delete(id);
  }
}

/** 简单 substring 搜索(走 server)。 */
export async function searchBooks(query: string): Promise<LibraryBook[]> {
  const q = query.trim();
  if (q.length === 0) return [];
  const data = await fetchJson<{ items: LibraryBook[] }>(
    `/library/search?q=${encodeURIComponent(q)}&limit=20`
  );
  return data.items;
}

// ─────────── 关系字符串解析(legacy fallback)───────────
//
// 现在 ue/de 都带 pid,RelatedCard 主路径根本不调 findBookByRelationString。
// 这两个 helper 保留以防某些 book 没 ue/de 时还能 fallback 显示原始 u/dw,
// 但没有 client-side fuzzy lookup —— 直接返回 null。

export function parseRelationString(text: string): { title: string; author: string } {
  const t = text.trim();
  const dotMatch = t.split(/\s+·\s+/);
  if (dotMatch.length >= 2) {
    return { author: dotMatch[0] ?? "", title: dotMatch.slice(1).join(" · ") };
  }
  const slashMatch = t.split(/\s+\/\s+/);
  if (slashMatch.length >= 2) {
    return { title: slashMatch[0] ?? "", author: slashMatch.slice(1).join(" / ") };
  }
  return { title: t, author: "" };
}

/**
 * 关系字符串 → pool 里的书。client 端没有全量 pool,这里直接返回 null。
 * 真正可跳关系都走 ue/de 的 pid。
 */
export function findBookByRelationString(_text: string): LibraryBook | null {
  return null;
}
