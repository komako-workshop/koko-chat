#!/usr/bin/env node
/**
 * Backfill Deeply library cover images.
 *
 * Usage:
 *   node scripts/fetch-library-covers.mjs
 *   node scripts/fetch-library-covers.mjs --only kgx_
 *   node scripts/fetch-library-covers.mjs --limit 100 --skip-douban
 *   node scripts/fetch-library-covers.mjs --skip-google
 *   node scripts/fetch-library-covers.mjs --retry-misses --llm-select
 *   node scripts/fetch-library-covers.mjs --force
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(REPO_ROOT, "miniapps/deeply/data");
const LIBRARY_POOL_PATH = path.join(DATA_DIR, "library-pool.json");
const COVERS_DIR = path.join(DATA_DIR, "covers");
const OUT = path.join(DATA_DIR, "library-covers.generated.json");
const SRC_KG = "/Users/lijianren/workspace/demo/book-knowledge-graph/graph-data/books_merged.json";
const PUBLIC_COVERS_BASE = (process.env.LIBRARY_COVERS_PUBLIC_BASE ?? "https://deeply.plus/covers").replace(/\/+$/, "");

const MIN_BYTES = 5 * 1024;
const MIN_WIDTH = 80;
const MIN_HEIGHT = 100;
const MIN_RATIO = 0.5;
const MAX_RATIO = 0.9;

const USER_AGENT = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  "AppleWebKit/537.36 (KHTML, like Gecko)",
  "Chrome/125.0.0.0 Safari/537.36"
].join(" ");

let kgBookById = new Map();
let kgBookByKey = new Map();

function parseArgs(argv) {
  const args = {
    only: null,
    limit: null,
    force: false,
    skipDouban: false,
    skipGoogle: false,
    skipOpenLibrary: false,
    skipImageSearch: false,
    retryMisses: false,
    llmSelect: false,
    llmModel: "deepseek/deepseek-v4-pro",
    concurrency: 6,
    googleIntervalMs: 1000,
    openLibraryIntervalMs: 120,
    imageSearchIntervalMs: 900,
    doubanIntervalMs: 450
  };
  for (let i = 2; i < argv.length; i += 1) {
    const raw = argv[i];
    if (raw === "--force") args.force = true;
    else if (raw === "--skip-douban") args.skipDouban = true;
    else if (raw === "--skip-google") args.skipGoogle = true;
    else if (raw === "--skip-openlibrary") args.skipOpenLibrary = true;
    else if (raw === "--skip-image-search") args.skipImageSearch = true;
    else if (raw === "--retry-misses") args.retryMisses = true;
    else if (raw === "--llm-select") args.llmSelect = true;
    else if (raw === "--llm-model") args.llmModel = argv[++i] ?? args.llmModel;
    else if (raw.startsWith("--llm-model=")) args.llmModel = raw.slice("--llm-model=".length);
    else if (raw === "--only") args.only = argv[++i] ?? null;
    else if (raw.startsWith("--only=")) args.only = raw.slice("--only=".length);
    else if (raw === "--limit") args.limit = Number(argv[++i]);
    else if (raw.startsWith("--limit=")) args.limit = Number(raw.slice("--limit=".length));
    else if (raw === "--concurrency") args.concurrency = Number(argv[++i]);
    else if (raw.startsWith("--concurrency=")) args.concurrency = Number(raw.slice("--concurrency=".length));
    else if (raw.startsWith("--google-interval-ms=")) args.googleIntervalMs = Number(raw.slice("--google-interval-ms=".length));
    else if (raw.startsWith("--openlibrary-interval-ms=")) args.openLibraryIntervalMs = Number(raw.slice("--openlibrary-interval-ms=".length));
    else if (raw.startsWith("--image-search-interval-ms=")) args.imageSearchIntervalMs = Number(raw.slice("--image-search-interval-ms=".length));
    else if (raw.startsWith("--douban-interval-ms=")) args.doubanIntervalMs = Number(raw.slice("--douban-interval-ms=".length));
    else {
      throw new Error(`Unknown argument: ${raw}`);
    }
  }
  args.only = typeof args.only === "string" && args.only.length > 0 ? args.only : null;
  args.limit = Number.isFinite(args.limit) && args.limit > 0 ? Math.trunc(args.limit) : null;
  args.concurrency = Number.isFinite(args.concurrency) && args.concurrency > 0 ? Math.trunc(args.concurrency) : 6;
  args.googleIntervalMs = positiveInteger(args.googleIntervalMs, 1000);
  args.openLibraryIntervalMs = positiveInteger(args.openLibraryIntervalMs, 120);
  args.imageSearchIntervalMs = positiveInteger(args.imageSearchIntervalMs, 900);
  args.doubanIntervalMs = positiveInteger(args.doubanIntervalMs, 450);
  return args;
}

function positiveInteger(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : fallback;
}

function normalizeText(s) {
  if (typeof s !== "string") return "";
  return s
    .toLowerCase()
    .trim()
    .replace(/[《》「」『』【】（）()〈〉<>"'“”‘’·•‧:：,，.。!?！？；;\-\s—–_/\\]+/g, "");
}

function tokenSet(s) {
  if (typeof s !== "string") return new Set();
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((x) => x.length >= 3)
  );
}

function overlapScore(a, b) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (left.size === 0 || right.size === 0) return 0;
  let hits = 0;
  for (const item of left) {
    if (right.has(item)) hits += 1;
  }
  return hits / Math.max(left.size, right.size);
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const s = typeof value === "string" ? value.trim() : "";
    if (s.length === 0) continue;
    const key = normalizeText(s);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function bookAliases(book) {
  const kg = typeof book.kgid === "string"
    ? kgBookById.get(book.kgid)
    : (
        kgBookByKey.get(`${normalizeText(book.t)}|${normalizeText(book.a)}`) ??
        kgBookByKey.get(`${normalizeText(book.t)}|`) ??
        null
      );
  return {
    titles: uniqueStrings([book.t, kg?.title, kg?.titleEn]),
    authors: uniqueStrings([book.a, kg?.author, kg?.authorEn])
  };
}

function textMatchScore(want, got, gotSecondary = "") {
  const wantNorm = normalizeText(want);
  const gotNorm = normalizeText(got);
  const gotCombined = `${gotNorm}${normalizeText(gotSecondary)}`;
  if (wantNorm && gotNorm === wantNorm) return 12;
  if (wantNorm && gotNorm && (gotNorm.includes(wantNorm) || wantNorm.includes(gotNorm))) return 9;
  if (wantNorm && gotCombined.includes(wantNorm)) return 7;
  const latinScore = overlapScore(want, `${got} ${gotSecondary}`);
  if (latinScore >= 0.6) return 6;
  if (latinScore >= 0.35) return 3;
  return 0;
}

function authorMatchScore(want, got) {
  const wantNorm = normalizeText(want);
  const gotNorm = normalizeText(got);
  if (wantNorm && gotNorm === wantNorm) return 8;
  if (wantNorm && gotNorm && (gotNorm.includes(wantNorm) || wantNorm.includes(gotNorm))) return 6;
  const latinScore = overlapScore(want, got);
  if (latinScore >= 0.6) return 4;
  if (latinScore >= 0.35) return 2;
  return 0;
}

function scoreCandidate(book, info) {
  const aliases = bookAliases(book);
  const gotAuthors = Array.isArray(info.authors) ? info.authors : [];
  const titleScore = Math.max(
    0,
    ...aliases.titles.map((title) => textMatchScore(title, info.title ?? "", info.subtitle ?? ""))
  );
  const authorScore = Math.max(
    0,
    ...aliases.authors.map((author) => authorMatchScore(author, gotAuthors.join(" ")))
  );
  let score = titleScore + authorScore;

  // Google/OpenLibrary searches are already constrained by title/author. A cover
  // result with a strong title match but translated author metadata can still be
  // the best available edition.
  if (score >= 7 && gotAuthors.length > 0) score += 1;
  return score;
}

function searchVariants(book) {
  const aliases = bookAliases(book);
  const variants = [];
  for (const title of aliases.titles) {
    for (const author of aliases.authors) {
      variants.push({ title, author });
    }
  }
  variants.sort((a, b) => {
    const aPrimary = Number(a.title === book.t) + Number(a.author === book.a);
    const bPrimary = Number(b.title === book.t) + Number(b.author === book.a);
    return bPrimary - aPrimary;
  });
  const out = [];
  const seen = new Set();
  for (const variant of variants) {
    const key = `${normalizeText(variant.title)}|${normalizeText(variant.author)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(variant);
    if (out.length >= 4) break;
  }
  return out.length > 0 ? out : [{ title: book.t, author: book.a }];
}

function bestImageLink(imageLinks) {
  if (imageLinks === null || typeof imageLinks !== "object") return null;
  for (const key of ["extraLarge", "large", "medium", "small", "thumbnail", "smallThumbnail"]) {
    const url = imageLinks[key];
    if (typeof url === "string" && url.length > 0) {
      return url.replace(/^http:/i, "https:");
    }
  }
  return null;
}

function collectIsbns(items) {
  const out = [];
  for (const item of items) {
    const identifiers = item?.volumeInfo?.industryIdentifiers;
    if (!Array.isArray(identifiers)) continue;
    for (const ident of identifiers) {
      const raw = typeof ident?.identifier === "string" ? ident.identifier : "";
      const cleaned = raw.replace(/[^0-9Xx]/g, "").toUpperCase();
      if ((cleaned.length === 10 || cleaned.length === 13) && !out.includes(cleaned)) {
        out.push(cleaned);
      }
    }
  }
  return out;
}

function createRateLimiter(minIntervalMs) {
  let tail = Promise.resolve();
  return async function waitTurn() {
    const prev = tail;
    let release;
    tail = new Promise((resolve) => {
      release = resolve;
    });
    await prev;
    if (minIntervalMs > 0) await sleep(minIntervalMs);
    release();
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer)
  };
}

function sanitizeHeaderValue(value) {
  const s = String(value);
  return /[^\x00-\xff]/.test(s) ? encodeURI(s) : s;
}

function sanitizeHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || value === null) continue;
    out[key] = sanitizeHeaderValue(value);
  }
  return out;
}

async function fetchWithRetry(url, options = {}, retry = {}) {
  const attempts = retry.attempts ?? 3;
  const timeoutMs = retry.timeoutMs ?? 30_000;
  let lastErr = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const timeout = withTimeout(timeoutMs);
    try {
      const res = await fetch(url, {
        ...options,
        headers: sanitizeHeaders({
          "User-Agent": USER_AGENT,
          "Accept": options.accept ?? "*/*",
          ...(options.headers ?? {})
        }),
        signal: timeout.signal
      });
      if (res.ok) return res;
      const text = await res.text().catch(() => "");
      const err = new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 160)}`);
      err.status = res.status;
      if (res.status === 429 && /quota exceeded/i.test(text)) {
        err.permanent = true;
        throw err;
      }
      if (![408, 425, 429, 500, 502, 503, 504].includes(res.status)) throw err;
      lastErr = err;
    } catch (err) {
      lastErr = err;
      if (err?.permanent) throw err;
      if (err?.status !== undefined && ![408, 425, 429, 500, 502, 503, 504].includes(err.status)) {
        throw err;
      }
    } finally {
      timeout.clear();
    }
    if (attempt < attempts) {
      const wait = 600 * attempt * attempt + Math.floor(Math.random() * 350);
      await sleep(wait);
    }
  }
  throw lastErr ?? new Error(`fetch failed: ${url}`);
}

async function fetchJson(url, limiter) {
  await limiter();
  const res = await fetchWithRetry(url, {
    headers: { "Accept": "application/json" }
  });
  return res.json();
}

function detectImage(buffer, contentType = "") {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer.toString("ascii", 1, 4) === "PNG") {
    return { ext: "png", mime: "image/png" };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return { ext: "webp", mime: "image/webp" };
  }
  if (contentType.includes("png")) return { ext: "png", mime: "image/png" };
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return { ext: "jpg", mime: "image/jpeg" };
  if (contentType.includes("webp")) return { ext: "webp", mime: "image/webp" };
  return null;
}

function readPngSize(buffer) {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readJpegSize(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return null;
    const isSof = (
      marker >= 0xc0 && marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    );
    if (isSof) {
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5)
      };
    }
    offset += length;
  }
  return null;
}

function readWebpSize(buffer) {
  if (buffer.length < 30 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    return null;
  }
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X" && buffer.length >= 30) {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3)
    };
  }
  if (chunk === "VP8 " && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff
    };
  }
  if (chunk === "VP8L" && buffer.length >= 25) {
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))
    };
  }
  return null;
}

function readImageSize(buffer, ext) {
  if (ext === "png") return readPngSize(buffer);
  if (ext === "jpg") return readJpegSize(buffer);
  if (ext === "webp") return readWebpSize(buffer);
  return null;
}

function validateImage({ buffer, contentType, sourceUrl, minRatio = MIN_RATIO, maxRatio = MAX_RATIO }) {
  if (buffer.length < MIN_BYTES) {
    throw new Error(`image too small: ${buffer.length} bytes`);
  }
  const detected = detectImage(buffer, contentType);
  if (detected === null) {
    throw new Error(`unsupported image content-type: ${contentType || "unknown"}`);
  }
  const size = readImageSize(buffer, detected.ext);
  if (size === null || !Number.isFinite(size.width) || !Number.isFinite(size.height)) {
    throw new Error(`cannot read image dimensions: ${sourceUrl}`);
  }
  if (size.width < MIN_WIDTH || size.height < MIN_HEIGHT) {
    throw new Error(`image dimensions too small: ${size.width}x${size.height}`);
  }
  const ratio = size.width / size.height;
  if (ratio < minRatio || ratio > maxRatio) {
    throw new Error(`bad aspect ratio: ${size.width}x${size.height}`);
  }
  return { ext: detected.ext, mime: detected.mime, width: size.width, height: size.height };
}

async function downloadCandidate(
  url,
  headers = {},
  retry = { attempts: 3, timeoutMs: 45_000 },
  validation = {}
) {
  const res = await fetchWithRetry(url, {
    headers: {
      "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      ...headers
    }
  }, retry);
  const contentType = res.headers.get("content-type") ?? "";
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const image = validateImage({ buffer, contentType, sourceUrl: res.url || url, ...validation });
  return {
    buffer,
    originalUrl: res.url || url,
    bytes: buffer.length,
    ...image
  };
}

async function searchGoogleBooks(book, limiter) {
  const allItems = [];
  const allIsbns = [];
  const allCandidates = [];
  for (const variant of searchVariants(book)) {
    const url = new URL("https://www.googleapis.com/books/v1/volumes");
    url.searchParams.set("q", `intitle:${variant.title} inauthor:${variant.author}`);
    url.searchParams.set("maxResults", "5");
    url.searchParams.set("printType", "books");
    url.searchParams.set("fields", "items(volumeInfo(title,subtitle,authors,imageLinks,industryIdentifiers))");
    const json = await fetchJson(url, limiter);
    const items = Array.isArray(json.items) ? json.items : [];
    allItems.push(...items);
    for (const isbn of collectIsbns(items)) {
      if (!allIsbns.includes(isbn)) allIsbns.push(isbn);
    }
    const candidates = items
      .map((item) => {
        const info = item?.volumeInfo ?? {};
        return {
          info,
          score: scoreCandidate(book, info),
          imageUrl: bestImageLink(info.imageLinks)
        };
      })
      .filter((x) => x.imageUrl !== null && x.score >= 7);
    allCandidates.push(...candidates);
    if (allCandidates.length > 0) break;
  }
  allCandidates.sort((a, b) => b.score - a.score);
  return { candidates: allCandidates, isbns: allIsbns, items: allItems };
}

async function tryGoogleBooks(book, limiters) {
  if (limiters.googleDisabled) {
    return { hit: null, isbns: [], error: new Error(limiters.googleDisabled) };
  }
  const { candidates, isbns } = await searchGoogleBooks(book, limiters.google);
  let lastErr = null;
  for (const candidate of candidates) {
    try {
      const image = await downloadCandidate(candidate.imageUrl);
      return {
        hit: {
          source: "google-books",
          originalUrl: image.originalUrl,
          image
        },
        isbns
      };
    } catch (err) {
      lastErr = err;
    }
  }
  return { hit: null, isbns, error: lastErr };
}

async function tryOpenLibraryIsbn(isbns, limiters) {
  let lastErr = null;
  for (const isbn of isbns) {
    const url = `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-L.jpg?default=false`;
    try {
      await limiters.openLibrary();
      const image = await downloadCandidate(url);
      return {
        source: "openlibrary-isbn",
        originalUrl: image.originalUrl,
        image
      };
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

async function tryOpenLibrarySearch(book, limiters) {
  const candidates = [];
  for (const variant of searchVariants(book)) {
    const url = new URL("https://openlibrary.org/search.json");
    url.searchParams.set("title", variant.title);
    url.searchParams.set("author", variant.author);
    url.searchParams.set("limit", "5");
    url.searchParams.set("fields", "title,author_name,cover_i,isbn");
    const json = await fetchJson(url, limiters.openLibrary);
    const docs = Array.isArray(json.docs) ? json.docs : [];
    candidates.push(
      ...docs
        .map((doc) => ({
          doc,
          score: scoreCandidate(book, {
            title: doc.title,
            authors: Array.isArray(doc.author_name) ? doc.author_name : []
          })
        }))
        .filter((x) => x.doc?.cover_i !== undefined && x.score >= 7)
    );
    if (candidates.length > 0) break;
  }
  candidates.sort((a, b) => b.score - a.score);
  let lastErr = null;
  for (const candidate of candidates) {
    const url = `https://covers.openlibrary.org/b/id/${encodeURIComponent(candidate.doc.cover_i)}-L.jpg?default=false`;
    try {
      await limiters.openLibrary();
      const image = await downloadCandidate(url);
      return {
        source: "openlibrary-search",
        originalUrl: image.originalUrl,
        image
      };
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

function parseDotenv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

let cachedOpenRouterApiKey = null;
let openRouterKeyLoaded = false;
let openRouterWarned = false;

function getOpenRouterApiKey() {
  if (openRouterKeyLoaded) return cachedOpenRouterApiKey;
  openRouterKeyLoaded = true;
  if (process.env.OPENROUTER_API_KEY) {
    cachedOpenRouterApiKey = process.env.OPENROUTER_API_KEY;
    return cachedOpenRouterApiKey;
  }
  const envboxPath = path.join(os.homedir(), ".alice-secrets/.env");
  if (fs.existsSync(envboxPath)) {
    const parsed = parseDotenv(fs.readFileSync(envboxPath, "utf8"));
    if (parsed.OPENROUTER_API_KEY) {
      cachedOpenRouterApiKey = parsed.OPENROUTER_API_KEY;
      return cachedOpenRouterApiKey;
    }
  }
  return null;
}

function cleanJsonText(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }
  return trimmed;
}

async function callOpenRouterJson({ model, messages }) {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    if (!openRouterWarned) {
      console.error("[warn] OPENROUTER_API_KEY not found; image-search selection will use first valid candidate");
      openRouterWarned = true;
    }
    return null;
  }
  const res = await fetchWithRetry("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://koko-chat.local",
      "X-Title": "KokoChat Deeply Library Cover Selector"
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0,
      max_tokens: 180,
      response_format: { type: "json_object" }
    })
  }, { attempts: 2, timeoutMs: 45_000 });
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return null;
  return JSON.parse(cleanJsonText(content));
}

async function selectImageCandidate(book, candidates, options) {
  if (!options.llmSelect || candidates.length <= 1) return candidates[0] ?? null;
  const aliases = bookAliases(book);
  const payload = {
    book: {
      id: book.id,
      title: book.t,
      author: book.a,
      titleAliases: aliases.titles,
      authorAliases: aliases.authors
    },
    candidates: candidates.map((candidate, index) => ({
      index,
      title: candidate.title,
      pageUrl: candidate.pageUrl,
      imageUrl: candidate.imageUrl,
      width: candidate.image.width,
      height: candidate.image.height
    }))
  };
  try {
    const selected = await callOpenRouterJson({
      model: options.llmModel,
      messages: [
        {
          role: "system",
          content: [
            "You select book cover images.",
            "Return strict JSON only: {\"choice\": number|null, \"reason\": string}.",
            "Choose the candidate that is most likely the cover of the exact requested book.",
            "Prefer exact title and author matches. Reject unrelated books, posters, screenshots, bundles, ads, and pages that only mention the book in passing.",
            "If none is sufficiently likely, return choice:null."
          ].join("\n")
        },
        {
          role: "user",
          content: JSON.stringify(payload, null, 2)
        }
      ]
    });
    const choice = selected?.choice;
    if (Number.isInteger(choice) && choice >= 0 && choice < candidates.length) {
      candidates[choice].selector = {
        model: options.llmModel,
        reason: typeof selected.reason === "string" ? selected.reason.slice(0, 180) : ""
      };
      return candidates[choice];
    }
    if (choice === null) return null;
  } catch (err) {
    if (!openRouterWarned) {
      console.error(`[warn] OpenRouter selector failed: ${err instanceof Error ? err.message : String(err)}`);
      openRouterWarned = true;
    }
  }
  return candidates[0] ?? null;
}

async function duckDuckGoImageResults(query, limiters) {
  await limiters.imageSearch();
  const firstUrl = new URL("https://duckduckgo.com/");
  firstUrl.searchParams.set("q", query);
  firstUrl.searchParams.set("iax", "images");
  firstUrl.searchParams.set("ia", "images");
  const firstRes = await fetchWithRetry(firstUrl, {
    headers: {
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
    }
  }, { attempts: 2, timeoutMs: 30_000 });
  const firstHtml = await firstRes.text();
  const vqd = firstHtml.match(/vqd=([^&"']+)/)?.[1];
  if (!vqd) return [];

  await limiters.imageSearch();
  const imageUrl = new URL("https://duckduckgo.com/i.js");
  imageUrl.searchParams.set("l", "wt-wt");
  imageUrl.searchParams.set("o", "json");
  imageUrl.searchParams.set("q", query);
  imageUrl.searchParams.set("vqd", vqd);
  imageUrl.searchParams.set("f", ",,,");
  imageUrl.searchParams.set("p", "1");
  const res = await fetchWithRetry(imageUrl, {
    headers: {
      "Accept": "application/json,text/javascript,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Referer": firstUrl.toString()
    }
  }, { attempts: 2, timeoutMs: 30_000 });
  const json = JSON.parse(await res.text());
  return Array.isArray(json.results) ? json.results : [];
}

async function bingImageResults(query, limiters) {
  await limiters.imageSearch();
  const url = new URL("https://cn.bing.com/images/search");
  url.searchParams.set("q", query);
  url.searchParams.set("form", "HDRSC2");
  url.searchParams.set("first", "1");
  const res = await fetchWithRetry(url, {
    headers: {
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
    }
  }, { attempts: 2, timeoutMs: 30_000 });
  const html = await res.text();
  const out = [];
  const re = /class=["']iusc["'][^>]+m=["']([^"']+)["']/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    try {
      const meta = JSON.parse(decodeHtmlAttr(match[1]));
      out.push({
        image: typeof meta.murl === "string" ? meta.murl : "",
        thumbnail: typeof meta.turl === "string" ? decodeHtmlAttr(meta.turl) : "",
        title: typeof meta.t === "string" ? meta.t : "",
        url: typeof meta.purl === "string" ? meta.purl : "",
        width: null,
        height: null
      });
    } catch {
      // Ignore malformed result records.
    }
    if (out.length >= 20) break;
  }
  return out;
}

function imageSearchQueries(book) {
  const variants = searchVariants(book).slice(0, 2);
  const out = [];
  const seen = new Set();
  for (const variant of variants) {
    for (const suffix of ["书 封面", "book cover"]) {
      const query = `${variant.title} ${variant.author} ${suffix}`;
      const key = normalizeText(query);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(query);
    }
  }
  return out;
}

const HIGH_RISK_IMAGE_SEARCH_DOMAINS = new Set([
  "zhuanlan.zhihu.com",
  "zhihu.com",
  "k.sina.cn",
  "k.sina.com.cn",
  "sohu.com",
  "thepaper.cn",
  "blog.csdn.net",
  "huaban.com",
  "lifeweek.com.cn",
  "post.smzdm.com",
  "culture.ifeng.com",
  "ishare.ifeng.com",
  "health.baidu.com",
  "bbs.voc.com.cn",
  "jsnews.jschina.com.cn",
  "guancha.cn",
  "jiemian.com",
  "v.qq.com",
  "fbs.qq.com",
  "worldscience.cn"
]);

function isTitleAliasInCandidateTitle(book, candidateTitle) {
  const title = normalizeText(candidateTitle);
  if (!title) return false;
  return bookAliases(book).titles
    .map((alias) => normalizeText(alias))
    .filter((alias) => alias.length >= 2)
    .some((alias) => title.includes(alias) || alias.includes(title));
}

function parseHostnameAndPath(url) {
  try {
    const parsed = new URL(url);
    return {
      hostname: parsed.hostname.replace(/^www\./, ""),
      pathname: parsed.pathname
    };
  } catch {
    return { hostname: "", pathname: "" };
  }
}

function isHighRiskImageSearchCandidate(book, candidate) {
  const { hostname, pathname } = parseHostnameAndPath(candidate.pageUrl || candidate.imageUrl);
  if (HIGH_RISK_IMAGE_SEARCH_DOMAINS.has(hostname)) return true;
  if (hostname === "upimg.baike.so.com" || pathname.includes("/gallery/")) return true;
  if (isTitleAliasInCandidateTitle(book, candidate.title)) return false;

  return (
    /图册/.test(candidate.title) ||
    /（[^）]*(学者|哲学家|经济学家|作家|画家|政治家|教育家|心理学家|数学家|物理学家|社会学家|人类学家|导演|人物|思想家|历史学家|法学家|语言学家|建筑师|艺术家|科学家|生物学家|外交家)[^）]*）/.test(candidate.title) ||
    /(_文献类参考资料|参考资料_百度百科|百科TA说)/.test(candidate.title)
  );
}

async function tryImageSearch(book, limiters, options) {
  const rawCandidates = [];
  const minScore = options.llmSelect ? 0 : 7;
  for (const query of imageSearchQueries(book)) {
    let results = [];
    try {
      results = await bingImageResults(query, limiters);
    } catch {
      results = [];
    }
    if (results.length === 0) {
      results = await duckDuckGoImageResults(query, limiters);
    }
    rawCandidates.push(
      ...results.map((result) => ({
        title: typeof result.title === "string" ? result.title : "",
        pageUrl: typeof result.url === "string" ? result.url : "",
        imageUrl: typeof result.image === "string" ? result.image : "",
        thumbnailUrl: typeof result.thumbnail === "string" ? result.thumbnail : "",
        width: Number(result.width) || null,
        height: Number(result.height) || null,
        score: scoreCandidate(book, {
          title: typeof result.title === "string" ? result.title : "",
          authors: [typeof result.title === "string" ? result.title : "", typeof result.url === "string" ? result.url : ""]
        })
      }))
    );
    if (rawCandidates.some((candidate) => candidate.score >= minScore)) break;
  }

  const seen = new Set();
  const ranked = rawCandidates
    .filter((candidate) => !isHighRiskImageSearchCandidate(book, candidate))
    .filter((candidate) => candidate.score >= minScore && candidate.imageUrl)
    .filter((candidate) => {
      if (seen.has(candidate.imageUrl)) return false;
      seen.add(candidate.imageUrl);
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const downloaded = [];
  let lastErr = null;
  for (const candidate of ranked) {
    for (const url of [candidate.imageUrl, candidate.thumbnailUrl].filter(Boolean)) {
      try {
        const image = await downloadCandidate(url, {
          "Referer": candidate.pageUrl || "https://duckduckgo.com/"
        }, { attempts: 1, timeoutMs: 12_000 }, { minRatio: 0.45, maxRatio: 1.2 });
        downloaded.push({ ...candidate, image, imageUrl: url });
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (downloaded.length >= 5) break;
  }
  if (downloaded.length === 0) {
    if (lastErr) throw lastErr;
    return null;
  }

  const selected = await selectImageCandidate(book, downloaded, options);
  if (selected === null) return null;
  return {
    source: selected.selector ? "image-search-llm" : "image-search",
    originalUrl: selected.image.originalUrl,
    image: selected.image,
    candidateTitle: selected.title,
    candidatePageUrl: selected.pageUrl,
    selector: selected.selector
  };
}

function firstMatch(pattern, text) {
  const match = pattern.exec(text);
  return match?.[1] ?? null;
}

function decodeHtmlAttr(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseDoubanSearchCandidates(html, book) {
  const candidates = [];
  const re = /<a[^>]+class=["']nbg["'][^>]+href=["']([^"']+)["'][^>]*title=["']([^"']*)["'][^>]*>\s*<img[^>]+src=["']([^"']+)["']/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const nextResult = html.indexOf('<div class="result">', match.index + 1);
    const block = html.slice(match.index, nextResult === -1 ? Math.min(html.length, match.index + 3000) : nextResult);
    const castText = decodeHtmlAttr(block.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
    const href = decodeHtmlAttr(match[1]);
    const title = decodeHtmlAttr(match[2]);
    const imageUrl = decodeHtmlAttr(match[3]).replace(/^http:/i, "https:");
    const score = scoreCandidate(book, { title, authors: [castText] });
    let subjectUrl = null;
    try {
      const parsed = new URL(href);
      if (parsed.hostname === "www.douban.com" && parsed.pathname.startsWith("/link2/")) {
        const raw = parsed.searchParams.get("url");
        if (raw) subjectUrl = raw;
      } else if (parsed.hostname === "book.douban.com" && parsed.pathname.startsWith("/subject/")) {
        subjectUrl = parsed.toString();
      }
    } catch {
      subjectUrl = null;
    }
    candidates.push({ title, imageUrl, subjectUrl, score });
  }
  return candidates
    .filter((candidate) => candidate.score >= 7 && candidate.imageUrl.length > 0)
    .sort((a, b) => b.score - a.score);
}

async function tryDouban(book, limiters) {
  const search = new URL("https://www.douban.com/search");
  search.searchParams.set("cat", "1001");
  search.searchParams.set("q", `${book.t} ${book.a}`);
  await limiters.douban();
  const searchRes = await fetchWithRetry(search, {
    headers: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
    }
  }, { attempts: 2, timeoutMs: 30_000 });
  const searchHtml = await searchRes.text();
  const searchCandidates = parseDoubanSearchCandidates(searchHtml, book);
  let lastErr = null;
  for (const candidate of searchCandidates) {
    try {
      const image = await downloadCandidate(candidate.imageUrl, {
        "Referer": "https://book.douban.com/"
      });
      return {
        source: "douban",
        originalUrl: image.originalUrl,
        image
      };
    } catch (err) {
      lastErr = err;
    }
  }

  const subjectUrl = searchCandidates[0]?.subjectUrl ?? null;
  if (subjectUrl === null) return null;

  await limiters.douban();
  const detailRes = await fetchWithRetry(subjectUrl, {
    headers: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Referer": search.toString()
    }
  }, { attempts: 2, timeoutMs: 30_000 });
  const detailHtml = await detailRes.text();
  const mainpic = firstMatch(/<div[^>]+id=["']mainpic["'][\s\S]*?<img[^>]+src=["']([^"']+)["']/i, detailHtml)
    ?? firstMatch(/<img[^>]+class=["'][^"']*cover[^"']*["'][^>]+src=["']([^"']+)["']/i, detailHtml);
  if (mainpic === null) return null;
  const imageUrl = mainpic.replace(/^http:/i, "https:");
  const image = await downloadCandidate(imageUrl, {
    "Referer": subjectUrl
  }).catch((err) => {
    throw lastErr ?? err;
  });
  return {
    source: "douban",
    originalUrl: image.originalUrl,
    image
  };
}

function loadMapping() {
  if (!fs.existsSync(OUT)) {
    return { schemaVersion: 1, generatedAt: null, items: {}, misses: {} };
  }
  const raw = JSON.parse(fs.readFileSync(OUT, "utf8"));
  return {
    schemaVersion: 1,
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : null,
    items: raw.items && typeof raw.items === "object" && !Array.isArray(raw.items) ? raw.items : {},
    misses: raw.misses && typeof raw.misses === "object" && !Array.isArray(raw.misses) ? raw.misses : {}
  };
}

function atomicWriteJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function saveMapping(mapping) {
  mapping.generatedAt = new Date().toISOString();
  atomicWriteJson(OUT, mapping);
}

function findExistingFile(filename) {
  return filename ? path.join(COVERS_DIR, filename) : null;
}

function isManagedCoverUrl(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  return value.startsWith(`${PUBLIC_COVERS_BASE}/`) || value.startsWith("https://deeply.plus/covers/");
}

function hasCachedHit(mapping, book) {
  const item = mapping.items?.[book.id];
  if (item?.filename === undefined) return false;
  const file = findExistingFile(item.filename);
  return file !== null && fs.existsSync(file);
}

function writeCoverFile(bookId, image) {
  fs.mkdirSync(COVERS_DIR, { recursive: true });
  const filename = `${bookId}.${image.ext}`;
  const file = path.join(COVERS_DIR, filename);
  fs.writeFileSync(file, image.buffer);
  return filename;
}

function hitToMappingItem(hit, filename) {
  const item = {
    source: hit.source,
    originalUrl: hit.originalUrl,
    filename,
    bytes: hit.image.bytes,
    width: hit.image.width,
    height: hit.image.height
  };
  if (hit.candidateTitle) item.candidateTitle = hit.candidateTitle;
  if (hit.candidatePageUrl) item.candidatePageUrl = hit.candidatePageUrl;
  if (hit.selector) item.selector = hit.selector;
  return item;
}

async function findCover(book, limiters, options) {
  let googleIsbns = [];
  const errors = [];

  if (!options.skipGoogle) {
    try {
      const google = await tryGoogleBooks(book, limiters);
      googleIsbns = google.isbns;
      if (google.hit !== null) return google.hit;
      if (google.error) errors.push(`google-books: ${google.error.message}`);
    } catch (err) {
      if (err?.permanent && /quota exceeded/i.test(err.message)) {
        limiters.googleDisabled = "google-books: quota exceeded for this run";
      }
      errors.push(`google-books: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!options.skipOpenLibrary) {
    try {
      const openLibraryByIsbn = await tryOpenLibraryIsbn(googleIsbns, limiters);
      if (openLibraryByIsbn !== null) return openLibraryByIsbn;
    } catch (err) {
      errors.push(`openlibrary-isbn: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      const openLibraryBySearch = await tryOpenLibrarySearch(book, limiters);
      if (openLibraryBySearch !== null) return openLibraryBySearch;
    } catch (err) {
      errors.push(`openlibrary-search: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!options.skipImageSearch) {
    try {
      const imageSearch = await tryImageSearch(book, limiters, options);
      if (imageSearch !== null) return imageSearch;
    } catch (err) {
      errors.push(`image-search: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!options.skipDouban && !limiters.doubanDisabled) {
    try {
      const douban = await tryDouban(book, limiters);
      if (douban !== null) return douban;
    } catch (err) {
      if (err?.status === 403 || err?.status === 418) {
        limiters.doubanBlockCount = (limiters.doubanBlockCount ?? 0) + 1;
        if (limiters.doubanBlockCount >= 6) {
          limiters.doubanDisabled = `douban disabled after ${limiters.doubanBlockCount} block responses`;
          if (!limiters.doubanDisabledLogged) {
            console.error(`[warn] ${limiters.doubanDisabled}`);
            limiters.doubanDisabledLogged = true;
          }
        }
      }
      errors.push(`douban: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (limiters.doubanDisabled) {
    errors.push(limiters.doubanDisabled);
  }

  const reason = errors.length > 0 ? errors.slice(-2).join(" | ") : "no candidate";
  const miss = new Error(reason);
  miss.reason = reason;
  throw miss;
}

function sourceCounts(items) {
  const counts = {};
  for (const item of Object.values(items)) {
    const source = item?.source ?? "unknown";
    counts[source] = (counts[source] ?? 0) + 1;
  }
  return counts;
}

function formatCounts(counts) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "none";
  return entries.map(([k, v]) => `${k}: ${v}`).join(", ");
}

async function main() {
  const args = parseArgs(process.argv);
  const books = JSON.parse(fs.readFileSync(LIBRARY_POOL_PATH, "utf8"));
  if (fs.existsSync(SRC_KG)) {
    const kg = JSON.parse(fs.readFileSync(SRC_KG, "utf8"));
    kgBookById = new Map(kg.map((book) => [book.id, book]));
    kgBookByKey = new Map();
    for (const book of kg) {
      const pr = typeof book.pr === "number" ? book.pr : 0;
      const titles = uniqueStrings([book.title, book.titleEn]);
      const authors = uniqueStrings([book.author, book.authorEn]);
      for (const title of titles) {
        const titleKey = `${normalizeText(title)}|`;
        const existingTitle = kgBookByKey.get(titleKey);
        if (!existingTitle || (existingTitle.pr ?? 0) < pr) kgBookByKey.set(titleKey, book);
        for (const author of authors) {
          const key = `${normalizeText(title)}|${normalizeText(author)}`;
          const existing = kgBookByKey.get(key);
          if (!existing || (existing.pr ?? 0) < pr) kgBookByKey.set(key, book);
        }
      }
    }
  }
  const mapping = loadMapping();
  fs.mkdirSync(COVERS_DIR, { recursive: true });

  const coverManagedBooks = books.filter((book) => {
    const hasImg = typeof book.img === "string" && book.img.length > 0;
    return !hasImg || isManagedCoverUrl(book.img) || mapping.items?.[book.id] !== undefined;
  });
  const alreadyHadExternal = books.length - coverManagedBooks.length;
  let targetBooks = coverManagedBooks;
  if (args.only !== null) {
    targetBooks = targetBooks.filter((book) => typeof book.id === "string" && book.id.startsWith(args.only));
  }
  if (args.limit !== null) {
    targetBooks = targetBooks.slice(0, args.limit);
  }

  const hitCache = targetBooks.filter((book) => !args.force && hasCachedHit(mapping, book)).length;
  const missCache = targetBooks.filter((book) => !args.force && mapping.misses?.[book.id] !== undefined && !hasCachedHit(mapping, book)).length;
  const todo = targetBooks.filter((book) => {
    if (args.force) return true;
    if (hasCachedHit(mapping, book)) return false;
    if (!args.retryMisses && mapping.misses?.[book.id] !== undefined) return false;
    return true;
  });

  console.log("\n=== Deeply cover backfill ===");
  console.log(`library pool: ${LIBRARY_POOL_PATH}`);
  console.log(`covers dir: ${COVERS_DIR}`);
  console.log(`mapping: ${OUT}`);
  console.log(`kg aliases: ${kgBookById.size}`);
  console.log(`total books: ${books.length}`);
  console.log(`already-had img: ${alreadyHadExternal}`);
  console.log(`missing or managed img: ${coverManagedBooks.length}`);
  console.log(`target this run: ${targetBooks.length}${args.only ? ` (only ${args.only})` : ""}`);
  console.log(`cached hits: ${hitCache}`);
  console.log(`cached misses: ${missCache}`);
  console.log(`todo network: ${todo.length}`);
  console.log(`concurrency: ${args.concurrency}`);
  console.log(`google interval: ${args.googleIntervalMs}ms`);
  console.log(`google: ${args.skipGoogle ? "disabled" : "enabled"}`);
  console.log(`openlibrary: ${args.skipOpenLibrary ? "disabled" : `enabled (${args.openLibraryIntervalMs}ms)`}`);
  console.log(`image search: ${args.skipImageSearch ? "disabled" : `enabled (${args.imageSearchIntervalMs}ms)`}`);
  console.log(`llm select: ${args.llmSelect ? args.llmModel : "disabled"}`);
  console.log(`douban: ${args.skipDouban ? "disabled" : "enabled"}`);

  const startedAt = Date.now();
  const limiters = {
    google: createRateLimiter(args.googleIntervalMs),
    openLibrary: createRateLimiter(args.openLibraryIntervalMs),
    imageSearch: createRateLimiter(args.imageSearchIntervalMs),
    douban: createRateLimiter(args.doubanIntervalMs),
    doubanBlockCount: 0
  };
  const stats = {
    done: 0,
    found: 0,
    failed: 0,
    bySource: {}
  };
  let cursor = 0;
  let sinceSave = 0;

  function recordSave(force = false) {
    if (!force && sinceSave < 20) return;
    saveMapping(mapping);
    sinceSave = 0;
  }

  function logProgress(force = false) {
    if (!force && stats.done % 100 !== 0 && stats.done > 5) return;
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
    console.log(
      `[progress] ${stats.done}/${todo.length} found=${stats.found} failed=${stats.failed} elapsed=${elapsed}s sources=${formatCounts(stats.bySource)}`
    );
  }

  async function worker(workerId) {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= todo.length) return;
      const book = todo[i];
      try {
        const hit = await findCover(book, limiters, args);
        const oldFilename = mapping.items?.[book.id]?.filename;
        const filename = writeCoverFile(book.id, hit.image);
        if (oldFilename && oldFilename !== filename) {
          const oldFile = path.join(COVERS_DIR, oldFilename);
          if (fs.existsSync(oldFile)) fs.rmSync(oldFile);
        }
        mapping.items[book.id] = hitToMappingItem(hit, filename);
        delete mapping.misses[book.id];
        stats.found += 1;
        stats.bySource[hit.source] = (stats.bySource[hit.source] ?? 0) + 1;
        if (stats.found <= 10 || stats.found % 50 === 0) {
          console.log(`[hit] ${stats.found} ${hit.source} ${book.id} ${book.t} / ${book.a} -> ${filename}`);
        }
      } catch (err) {
        const reason = err?.reason ?? (err instanceof Error ? err.message : String(err));
        mapping.misses[book.id] = {
          lastTriedAt: new Date().toISOString(),
          reason: String(reason).slice(0, 500)
        };
        stats.failed += 1;
        if (stats.failed <= 10 || stats.failed % 100 === 0) {
          console.error(`[miss] worker=${workerId} ${book.id} ${book.t} / ${book.a}: ${String(reason).slice(0, 220)}`);
        }
      } finally {
        stats.done += 1;
        sinceSave += 1;
        recordSave(false);
        logProgress(false);
      }
    }
  }

  await Promise.all(Array.from({ length: args.concurrency }, (_, i) => worker(i + 1)));
  recordSave(true);

  const allManagedIds = new Set(coverManagedBooks.map((book) => book.id));
  const mappedManagedIds = new Set(
    Object.entries(mapping.items)
      .filter(([id, item]) => allManagedIds.has(id) && item?.filename && fs.existsSync(path.join(COVERS_DIR, item.filename)))
      .map(([id]) => id)
  );
  const mappedManaged = mappedManagedIds.size;
  const finalSourceCounts = sourceCounts(
    Object.fromEntries(
      Object.entries(mapping.items).filter(([id]) => allManagedIds.has(id))
    )
  );
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);

  console.log("\n=== summary ===");
  console.log(`total: ${books.length}`);
  console.log(`already-had: ${alreadyHadExternal}`);
  console.log(`newly-found: ${mappedManaged}  (${formatCounts(finalSourceCounts)})`);
  console.log(`found-this-run: ${stats.found}`);
  console.log(`still-missing: ${coverManagedBooks.length - mappedManaged}`);
  console.log(`cached-misses: ${Object.keys(mapping.misses).filter((id) => allManagedIds.has(id) && !mappedManagedIds.has(id)).length}`);
  console.log(`elapsed: ${elapsed}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
