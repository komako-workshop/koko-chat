/**
 * 从 agent 返回的 markdown 大纲里抠出 `## 第N节:标题` 节列表。
 * 跟 deeply.plus 原版的 outline 解析逻辑同构,以便目录推进语义一致。
 *
 * 兼容:
 *   - 中文形式 `## 第N节:标题` 或 `## 第N节：标题`(全/半角冒号都行)
 *   - 英文形式 `## Section N: Title`(以备 future)
 *   - 部分编号用大写"一二三...十"等汉字数字
 *
 * 容错策略:行首允许有 `#` 1-6 个,允许有空白。
 */
export interface DeeplyOutlineSection {
  index: number;
  title: string;
}

export function parseDeeplyCourseOutline(markdown: string): DeeplyOutlineSection[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: DeeplyOutlineSection[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (!line.startsWith("#")) continue;
    const zh = line.match(
      /^#{1,6}\s*第\s*([零〇一二两三四五六七八九十百\d]+)\s*节\s*[:：]?\s*(.+?)\s*$/
    );
    const en =
      !zh ? line.match(/^#{1,6}\s*(?:Section|Chapter)\s*(\d+)\s*[:：]?\s*(.+?)\s*$/i) : null;
    const hit = zh ?? en;
    if (!hit) continue;
    const idx = parseChineseOrArabicNumber(hit[1] ?? "");
    const title = (hit[2] ?? "").trim();
    if (!Number.isFinite(idx) || idx <= 0 || title.length === 0) continue;
    out.push({ index: idx, title });
  }
  if (out.length === 0) return [];

  const seen = new Map<number, string>();
  for (const item of out) {
    if (!seen.has(item.index)) seen.set(item.index, item.title);
  }
  return Array.from(seen.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([index, title]) => ({ index, title }));
}

/**
 * "三十二" / "32" 都识别。简单 1-99 范围;课程不会超出。
 */
function parseChineseOrArabicNumber(raw: string): number {
  const s = raw.trim();
  if (s.length === 0) return 0;
  if (/^\d+$/.test(s)) {
    const n = Math.trunc(Number(s));
    return Number.isFinite(n) ? n : 0;
  }
  if (!/^[零〇一二两三四五六七八九十]+$/.test(s)) return 0;
  const map: Record<string, number> = {
    零: 0,
    "〇": 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10
  };
  if (s === "十") return 10;
  const parts = s.split("十");
  if (parts.length === 1) {
    return map[s] ?? 0;
  }
  const leftPart = parts[0] ?? "";
  const rightPart = parts[1] ?? "";
  const leftVal = leftPart.length === 0 ? 1 : map[leftPart] ?? 0;
  if (leftVal === 0) return 0;
  const rightVal = rightPart.length === 0 ? 0 : map[rightPart] ?? -1;
  if (rightVal < 0) return 0;
  return leftVal * 10 + rightVal;
}
