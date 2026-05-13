/** Minimal SillyTavern-style lorebook evaluator for the Tavern prototype.
 *
 * This intentionally implements a conservative v0 subset:
 * - enabled entries only (enabled !== false)
 * - constant entries are always active
 * - primary keys activate entries, case-insensitive by default
 * - secondary_keys support simple AND logic when selective === true
 * - insertion_order sorts active entries
 * - position buckets: beforeCharDefs / afterCharDefs / generic
 *
 * Not implemented yet: recursion, probability, inclusion groups, depth roles,
 * timed effects, vector matching, outlets. Keep tests explicit so we can add
 * those without accidentally claiming full ST compatibility.
 */

export function evaluateLorebook(characterBook, messages, options = {}) {
  const entries = Array.isArray(characterBook?.entries) ? characterBook.entries : [];
  const scanText = buildScanText(messages, options.scanDepth ?? 4);
  const active = [];

  for (const raw of entries) {
    const entry = normalizeEntry(raw);
    if (entry === null) continue;
    if (!entry.enabled) continue;

    const constant = entry.constant;
    const primaryHit = entry.keys.length > 0 && entry.keys.some((key) => keyMatches(scanText, key, entry));
    const secondaryOk = !entry.selective || entry.secondaryKeys.length === 0
      ? true
      : entry.secondaryKeys.some((key) => keyMatches(scanText, key, entry));

    if (!constant && !(primaryHit && secondaryOk)) continue;
    active.push(entry);
  }

  active.sort((a, b) => a.insertionOrder - b.insertionOrder);
  return {
    beforeCharDefs: active.filter((entry) => entry.position === "beforeCharDefs"),
    afterCharDefs: active.filter((entry) => entry.position === "afterCharDefs"),
    generic: active.filter((entry) => entry.position === "generic"),
    all: active
  };
}

export function formatLoreEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return "";
  return entries
    .map((entry) => {
      const label = entry.comment ? `# ${entry.comment}\n` : "";
      return `${label}${entry.content}`.trim();
    })
    .filter(Boolean)
    .join("\n\n");
}

function normalizeEntry(raw) {
  if (raw === null || typeof raw !== "object") return null;
  const content = typeof raw.content === "string" ? raw.content.trim() : "";
  if (!content) return null;
  const extensions = raw.extensions && typeof raw.extensions === "object" ? raw.extensions : {};
  return {
    id: raw.id,
    comment: typeof raw.comment === "string" ? raw.comment.trim() : "",
    content,
    keys: stringArray(raw.keys),
    secondaryKeys: stringArray(raw.secondary_keys),
    constant: raw.constant === true,
    selective: raw.selective === true,
    enabled: raw.enabled !== false,
    insertionOrder: numberOr(raw.insertion_order, 100),
    position: normalizePosition(raw.position ?? extensions.position),
    caseSensitive: extensions.case_sensitive === true,
    matchWholeWords: extensions.match_whole_words !== false
  };
}

function normalizePosition(value) {
  // SillyTavern stores position as numbers in extensions.position. Text values
  // vary across exporters, so accept both common English strings and numbers.
  if (value === 0 || value === "before_char" || value === "before_char_defs") return "beforeCharDefs";
  if (value === 1 || value === "after_char" || value === "after_char_defs") return "afterCharDefs";
  return "generic";
}

function keyMatches(text, key, entry) {
  const needle = entry.caseSensitive ? key : key.toLowerCase();
  const haystack = entry.caseSensitive ? text : text.toLowerCase();
  if (!needle) return false;
  if (looksLikeRegex(needle)) {
    try {
      const lastSlash = needle.lastIndexOf("/");
      const body = needle.slice(1, lastSlash);
      const flags = needle.slice(lastSlash + 1);
      return new RegExp(body, flags).test(text);
    } catch {
      return haystack.includes(needle);
    }
  }
  if (!entry.matchWholeWords || containsCjk(needle)) return haystack.includes(needle);
  return new RegExp(`(^|\\W)${escapeRegExp(needle)}($|\\W)`).test(haystack);
}

function buildScanText(messages, scanDepth) {
  const recent = messages.slice(Math.max(0, messages.length - scanDepth));
  return recent.map((message) => `${message.role ?? ""}: ${message.text ?? message.content ?? ""}`).join("\n");
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function numberOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function looksLikeRegex(value) {
  return value.startsWith("/") && value.lastIndexOf("/") > 0;
}

function containsCjk(value) {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(value);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
