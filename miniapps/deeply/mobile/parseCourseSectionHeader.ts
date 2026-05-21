/**
 * 从 agent 主线讲解回复的首行解析 `## 第N节:标题`。
 *
 * 严格语义:agent 在 mainline prompt 下被强制要求首行就是这个形式,
 * 客户端只有匹配成功时才推进 progress.currentSection,这样可以避免
 * "agent 跑偏 / 跳节" 把进度污染。
 *
 * 容错:允许前面有若干空行,允许 1-6 个 `#`,允许中文/英文冒号。
 * 同时支持英文 "## Section N: Title" 形式(以备 future)。
 */
export interface ParsedCourseSectionHeader {
  section: number;
  title: string;
}

const MAX_SCAN_LINES = 12;

export function parseCourseSectionHeader(text: string): ParsedCourseSectionHeader | null {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  let scanned = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    scanned += 1;
    const zh = line.match(/^#{1,6}\s*第\s*(\d{1,4})\s*节\s*[:：]\s*(.+?)\s*$/);
    const en =
      !zh ? line.match(/^#{1,6}\s*(?:Section|Chapter)\s*(\d{1,4})\s*[:：]\s*(.+?)\s*$/i) : null;
    const hit = zh ?? en;
    if (hit) {
      const n = Math.trunc(Number(hit[1] ?? ""));
      const title = (hit[2] ?? "").trim();
      if (!Number.isFinite(n) || n <= 0 || title.length === 0) return null;
      return { section: n, title };
    }
    if (scanned >= MAX_SCAN_LINES) return null;
  }
  return null;
}
