/**
 * 解析 `koko.deeply.research.outline` fenced block。
 *
 * 这是 Phase B 深度调研 agent 的最终交付:边搜边汇报完之后,agent
 * 必须在回复最末尾输出一个 fenced block,里面是结构化的课程 outline
 * + cited sources。客户端 transformer 解析出来后,写入 storage,把
 * conversation bootstrap 切到 ready,后面就走跟普通课程同款的 mainline
 * 讲解流程。
 *
 * 跟普通 inferCourseOutline 的最大区别:这一份 outline 自带 sources,
 * 后续讲解 prompt 注入 sources,agent 可以在每节里 cite 真实(phase D
 * 之后是真实的)来源。
 */
import { extractFencedBlock } from "@/runtime/messageBlocks";

import { parseDeeplyCourseOutline, type DeeplyOutlineSection } from "./parseCourseOutline";

export const DEEPLY_RESEARCH_OUTLINE_BLOCK_TYPE = "koko.deeply.research.outline";

// 用户可以选 light 课程(3 节)甚至更短的主题。这里只保留"至少 2 节
// 才能算课"的底线护栏,防 agent 给出 1 节这种 totally degenerate 输出。
const MIN_SECTIONS = 2;
const MAX_SECTIONS = 60;
const MAX_TITLE_CHARS = 60;
const MAX_INTRODUCTION_CHARS = 800;
const MAX_SOURCES = 12;
const MAX_SNIPPET_CHARS = 240;

const STANCES = ["primary", "counterpoint", "background"] as const;
export type DeeplyResearchSourceStance = (typeof STANCES)[number];

export interface DeeplyResearchSource {
  title: string;
  url: string;
  stance: DeeplyResearchSourceStance;
  snippet: string;
}

/**
 * Research course 的 section 比普通课程多一个 `sources` 字段 —— 准备阶段
 * 调研到的、跟这一节相关的资料指针。讲解时 mainline prompt 把这些 sources
 * 注入给 agent 当"调研笔记",agent 可以(且鼓励)在讲解中 web_fetch 它们
 * 拿原文 + 再 web_search 补充新角度,临场创作内容。
 */
export interface DeeplyResearchSection {
  index: number;
  title: string;
  sources: DeeplyResearchSource[];
}

export interface DeeplyResearchOutline {
  version: 1;
  courseTitle: string;
  introduction: string;
  /** Per-section schema: 每节自带 sources(准备阶段的资料指针)。 */
  sections: DeeplyResearchSection[];
  outlineMarkdown: string;
  /**
   * Union of all per-section sources(去重)。讲解时如果 agent 想跳节
   * 引用整门课维度的资料用得上。从 sections.sources 自动合成。
   */
  sources: DeeplyResearchSource[];
}

export interface ParseFailure {
  ok: false;
  error: string;
}

export interface ParseSuccess {
  ok: true;
  value: DeeplyResearchOutline;
}

export type ParseResult = ParseSuccess | ParseFailure;

/**
 * 检测整段 agent text 里是否出现 `koko.deeply.research.outline` fenced block
 * 开头(streaming 期间也能命中,即使 block 还没闭合)。客户端 streaming defer
 * 用得到 —— 跟 tavern 的 recommendations defer 模式同款。
 */
export function isDeeplyResearchOutlineStream(text: string): boolean {
  return /```[ \t]*koko\.deeply\.research\.outline\b/.test(text);
}

/**
 * Best-effort parse the research-outline fenced block.
 *
 * LLM 经常 alias 字段名(`title` vs `courseTitle`)或漏字段。严格校验只
 * 会让 90% 的产出被打回。这里做相反:**只要拿到一个能 reconstruct
 * 课程目录的最小信息(outlineMarkdown 或 sections),就算成功**,
 * 其它字段缺就用合理 fallback。
 *
 * - title alias: `courseTitle` | `course_title` | `title` | `name`
 * - introduction alias: `introduction` | `courseSummary` | `course_summary`
 *   | `intro` | `summary` | `description`,
 *   缺就空字符串(EmptyState 显示稍简陋,但课程能跑)
 * - outlineMarkdown alias: `outlineMarkdown` | `outline_markdown`
 *   | `markdown` | `outline`
 * - sections optional;缺就从 outlineMarkdown 重 parse;再缺才报错
 * - sources alias: `sources` | `citations` | `references`,缺就 []
 *   (mainline prompt 没 sources block,讲解时不强制 cite,行为退回到普通课程)
 */
export function parseDeeplyResearchOutline(assistantText: string): ParseResult {
  const fenced = extractFencedBlock(assistantText, DEEPLY_RESEARCH_OUTLINE_BLOCK_TYPE);
  if (fenced === null) {
    return { ok: false, error: "未找到 koko.deeply.research.outline 块" };
  }
  const body = fenced.body.trim();
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch (error) {
    raw = parseJsonWithLooseStringQuotes(body) ?? parseLegacyYamlResearchOutline(body);
    if (raw === null) {
      return {
        ok: false,
        error: `JSON 解析失败:${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
  if (!isRecord(raw)) {
    return { ok: false, error: "fenced block 内部必须是 JSON 对象" };
  }

  const courseTitle =
    trimString(raw.courseTitle) ||
    trimString(raw.course_title) ||
    trimString(raw.title) ||
    trimString(raw.name);
  if (courseTitle.length === 0) {
    return { ok: false, error: "courseTitle / title / name 任一非空字符串都行,实际都为空" };
  }

  const introductionRaw =
    trimString(raw.introduction) ||
    trimString(raw.courseSummary) ||
    trimString(raw.course_summary) ||
    trimString(raw.intro) ||
    trimString(raw.summary) ||
    trimString(raw.description);
  const introduction = introductionRaw.slice(0, MAX_INTRODUCTION_CHARS);

  const outlineMarkdown = (
    trimString(raw.outlineMarkdown) ||
    trimString(raw.outline_markdown) ||
    trimString(raw.markdown) ||
    trimString(raw.outline)
  ).trim();

  // 提取 top-level sources(旧 schema / 兜底用)。
  const topLevelSources = collectSourcesLoose(
    Array.isArray(raw.sources)
      ? raw.sources
      : Array.isArray(raw.citations)
        ? raw.citations
        : Array.isArray(raw.references)
          ? raw.references
          : []
  );

  // sections:优先用 JSON 数组(可能带 per-section sources),缺就从 outlineMarkdown 抠。
  let sections: DeeplyResearchSection[] = [];
  if (Array.isArray(raw.sections) && raw.sections.length > 0) {
    sections = collectSectionsLoose(raw.sections);
  }
  if (sections.length === 0 && outlineMarkdown.length > 0) {
    sections = parseDeeplyCourseOutline(outlineMarkdown).map((s) => ({
      index: s.index,
      title: s.title,
      sources: []
    }));
  }

  if (sections.length === 0) {
    return {
      ok: false,
      error: "无法 reconstruct 课程目录:JSON 里既没合法 sections,outlineMarkdown 也 parse 不出 `## 第N节:标题`"
    };
  }
  if (sections.length < MIN_SECTIONS) {
    return {
      ok: false,
      error: `sections 至少 ${MIN_SECTIONS} 节,实际 ${sections.length} 节`
    };
  }
  if (sections.length > MAX_SECTIONS) {
    sections = sections.slice(0, MAX_SECTIONS);
  }

  // 旧 schema 兼容:如果没有任何 section 自带 sources,把 top-level sources
  // 平均分到每节(round-robin),保证讲解时每节至少有几条资料指针。
  const anySectionHasSources = sections.some((s) => s.sources.length > 0);
  if (!anySectionHasSources && topLevelSources.length > 0) {
    sections = sections.map((s, idx) => ({
      ...s,
      sources: topLevelSources.filter((_, srcIdx) => srcIdx % sections.length === idx)
    }));
  }

  // 如果 outlineMarkdown 缺失但 sections 数组完整,合成一个最小 markdown,
  // 让 mainline prompt 的 `<course_outline>` 不空。新形态:标题 + 资料列表。
  const effectiveOutlineMarkdown =
    outlineMarkdown.length > 0
      ? outlineMarkdown
      : sections
          .map((s) => {
            const lines = [`## 第${s.index}节:${s.title}`];
            for (const src of s.sources) {
              lines.push(`- [${src.stance}] ${src.title} — ${src.url}`);
            }
            return lines.join("\n");
          })
          .join("\n\n");

  // 把 per-section sources 合成成 top-level union(去重 by url),
  // backward compat: 老路径(整门课维度需要 sources)还能用。
  const unionSources: DeeplyResearchSource[] = [];
  const seenUrls = new Set<string>();
  for (const section of sections) {
    for (const src of section.sources) {
      if (seenUrls.has(src.url)) continue;
      seenUrls.add(src.url);
      unionSources.push(src);
    }
  }
  // 顶层 sources(如果存在)也并入(去重)。
  for (const src of topLevelSources) {
    if (seenUrls.has(src.url)) continue;
    seenUrls.add(src.url);
    unionSources.push(src);
  }

  // Research / material / book courses are only useful if they carry at least
  // one verified source pointer. If search is blocked and the agent emits an
  // empty-sources outline, fail parsing so the UI can surface a retry state
  // instead of creating a course that looks researched but cannot cite anything.
  if (unionSources.length === 0) {
    return {
      ok: false,
      error: "没有拿到任何可验证来源 URL;已拒绝创建空来源调研课程"
    };
  }

  return {
    ok: true,
    value: {
      version: 1,
      courseTitle,
      introduction,
      sections,
      outlineMarkdown: effectiveOutlineMarkdown,
      sources: unionSources.slice(0, MAX_SOURCES * 2)
    }
  };
}

function collectSectionsLoose(rawSections: unknown[]): DeeplyResearchSection[] {
  const out: DeeplyResearchSection[] = [];
  for (let i = 0; i < rawSections.length; i += 1) {
    const item = rawSections[i];
    if (!isRecord(item)) continue;
    const title = stripSectionPrefix(
      trimString(item.title) || trimString(item.name) || trimString(item.heading)
    );
    if (title.length === 0) continue;
    const rawIndex = typeof item.index === "number"
      ? Math.trunc(item.index)
      : typeof item.section === "number"
        ? Math.trunc(item.section)
        : NaN;
    // index 缺 / 不合法时按 1-based 顺序回填,而不是丢弃这条 section。
    const index = Number.isFinite(rawIndex) && rawIndex > 0 ? rawIndex : i + 1;
    const sources = collectSourcesLoose(
      Array.isArray(item.sources)
        ? item.sources
        : Array.isArray(item.sourcePointers)
          ? item.sourcePointers
          : Array.isArray(item.source_pointers)
            ? item.source_pointers
            : Array.isArray(item.citations)
              ? item.citations
              : Array.isArray(item.references)
                ? item.references
                : []
    );
    out.push({
      index,
      title: title.slice(0, MAX_TITLE_CHARS),
      sources
    });
  }
  if (out.length === 0) return out;
  // 去重 + 顺序固定 + 重新编号,保证 mainline 进度推进的 1..N 单调连续。
  // 去重按 title,sources 用第一次出现的那条 section 的。
  const seenTitles = new Map<string, DeeplyResearchSection>();
  for (const item of out) {
    if (!seenTitles.has(item.title)) seenTitles.set(item.title, item);
  }
  return Array.from(seenTitles.values()).map((s, idx) => ({
    index: idx + 1,
    title: s.title,
    sources: s.sources
  }));
}

function collectSourcesLoose(rawSources: unknown[]): DeeplyResearchSource[] {
  const out: DeeplyResearchSource[] = [];
  const seenUrls = new Set<string>();
  for (const item of rawSources) {
    if (!isRecord(item)) continue;
    const title = trimString(item.title) || trimString(item.name);
    const url = trimString(item.url) || trimString(item.link);
    if (title.length === 0) continue;
    if (url.length === 0 || !/^https?:\/\//i.test(url)) continue;
    const urlKey = url.toLowerCase();
    if (seenUrls.has(urlKey)) continue;
    seenUrls.add(urlKey);
    const stanceRaw = trimString(item.stance) as DeeplyResearchSourceStance;
    const stance = STANCES.includes(stanceRaw) ? stanceRaw : "primary";
    const snippet = (
      trimString(item.snippet) ||
      trimString(item.summary) ||
      trimString(item.description) ||
      trimString(item.relevance) ||
      trimString(item.why_it_matters)
    ).slice(0, MAX_SNIPPET_CHARS);
    out.push({ title, url, stance, snippet });
    if (out.length >= MAX_SOURCES) break;
  }
  return out;
}

function stripSectionPrefix(title: string): string {
  return title.replace(/^第\s*[零〇一二两三四五六七八九十百\d]+\s*节\s*[:：]\s*/, "").trim();
}

function parseJsonWithLooseStringQuotes(body: string): unknown | null {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;

  try {
    return JSON.parse(escapeLooseStringQuotes(trimmed));
  } catch {
    return null;
  }
}

function escapeLooseStringQuotes(input: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i] ?? "";
    if (!inString) {
      out += ch;
      if (ch === "\"") inString = true;
      continue;
    }

    if (ch === "\\") {
      out += ch;
      if (i + 1 < input.length) {
        i += 1;
        out += input[i] ?? "";
      }
      continue;
    }

    if (ch === "\"") {
      if (isClosingJsonStringQuote(input, i)) {
        out += ch;
        inString = false;
      } else {
        out += "\\\"";
      }
      continue;
    }

    out += ch;
  }
  return out;
}

function isClosingJsonStringQuote(input: string, quoteIndex: number): boolean {
  let nextIndex = quoteIndex + 1;
  while (nextIndex < input.length && isJsonWhitespace(input[nextIndex] ?? "")) nextIndex += 1;
  const next = input[nextIndex] ?? "";
  if (next === "" || next === ":" || next === "}" || next === "]") return true;
  if (next !== ",") return false;

  let afterComma = nextIndex + 1;
  while (afterComma < input.length && isJsonWhitespace(input[afterComma] ?? "")) afterComma += 1;
  return isLikelyJsonValueStart(input[afterComma] ?? "");
}

function isJsonWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function isLikelyJsonValueStart(ch: string): boolean {
  return (
    ch === "\"" ||
    ch === "{" ||
    ch === "[" ||
    ch === "}" ||
    ch === "]" ||
    ch === "-" ||
    ch === "t" ||
    ch === "f" ||
    ch === "n" ||
    (ch >= "0" && ch <= "9")
  );
}

/**
 * Compatibility for older / noncompliant agents that emit a YAML-ish legacy
 * outline inside the correct fenced block. We only parse the fields needed to
 * reconstruct the current JSON contract, and leave arbitrary YAML unsupported.
 */
function parseLegacyYamlResearchOutline(body: string): Record<string, unknown> | null {
  const lines = body.split(/\r?\n/);
  const title = readTopLevelScalar(lines, "courseTitle") || readTopLevelScalar(lines, "title");
  if (title.length === 0) return null;

  const topLevelSources = parseLegacyYamlSources(lines);
  const sourceById = new Map(topLevelSources.flatMap((source) => (source.id ? [[source.id, source]] : [])));
  const sections = parseLegacyYamlSections(lines, sourceById);
  if (sections.length === 0) return null;

  const introduction =
    readFoldedTopLevelBlock(lines, "introduction") ||
    readFoldedTopLevelBlock(lines, "research_note") ||
    readTopLevelScalar(lines, "introduction") ||
    readTopLevelScalar(lines, "research_note");

  return {
    version: 1,
    courseTitle: title,
    introduction,
    sections,
    sources: topLevelSources,
    outlineMarkdown: buildOutlineMarkdownFromSections(sections)
  };
}

function parseLegacyYamlSections(
  lines: string[],
  sourceById: Map<string, { title: string; url: string; stance: DeeplyResearchSourceStance; snippet: string }>
): Array<{ index: number; title: string; sources: DeeplyResearchSource[] }> {
  const start = findTopLevelLine(lines, "sections");
  if (start < 0) return [];
  const end = findNextTopLevelLine(lines, start + 1);
  const sections: Array<{ index: number; title: string; sourceIds: string[] }> = [];
  let current: { index: number; title: string; sourceIds: string[] } | null = null;
  let inSourceIds = false;

  for (let i = start + 1; i < (end < 0 ? lines.length : end); i += 1) {
    const line = lines[i] ?? "";
    const itemMatch = /^\s{2}-\s+(?:index|section):\s*(\d+)\s*$/.exec(line);
    if (itemMatch !== null) {
      if (current !== null) sections.push(current);
      current = { index: Number(itemMatch[1]), title: "", sourceIds: [] };
      inSourceIds = false;
      continue;
    }
    if (current === null) continue;
    const scalarMatch = /^\s{4}([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (scalarMatch !== null) {
      const key = scalarMatch[1] ?? "";
      const value = readYamlScalarValue(scalarMatch[2] ?? "");
      inSourceIds = key === "source_ids" || key === "sourceIds";
      if (key === "title") current.title = value;
      continue;
    }
    if (inSourceIds) {
      const sourceIdMatch = /^\s{6}-\s*(.+?)\s*$/.exec(line);
      if (sourceIdMatch !== null) current.sourceIds.push(readYamlScalarValue(sourceIdMatch[1] ?? ""));
    }
  }
  if (current !== null) sections.push(current);

  return sections.flatMap((section, idx) => {
    if (section.title.length === 0) return [];
    const sources = section.sourceIds
      .flatMap((id) => {
        const source = sourceById.get(id);
        return source === undefined ? [] : [{ ...source }];
      })
      .slice(0, MAX_SOURCES);
    return [
      {
        index: Number.isFinite(section.index) && section.index > 0 ? section.index : idx + 1,
        title: section.title,
        sources
      }
    ];
  });
}

function parseLegacyYamlSources(
  lines: string[]
): Array<{ id?: string; title: string; url: string; stance: DeeplyResearchSourceStance; snippet: string }> {
  const start = findTopLevelLine(lines, "sources");
  if (start < 0) return [];
  const out: Array<{ id?: string; title: string; url: string; stance: DeeplyResearchSourceStance; snippet: string }> = [];
  let current: Record<string, string> | null = null;

  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^\S/.test(line)) break;
    const itemMatch = /^\s{2}-\s+([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (itemMatch !== null) {
      if (current !== null) pushLegacyYamlSource(out, current);
      current = { [itemMatch[1] ?? ""]: readYamlScalarValue(itemMatch[2] ?? "") };
      continue;
    }
    if (current === null) continue;
    const scalarMatch = /^\s{4}([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (scalarMatch !== null) current[scalarMatch[1] ?? ""] = readYamlScalarValue(scalarMatch[2] ?? "");
  }
  if (current !== null) pushLegacyYamlSource(out, current);
  return out;
}

function pushLegacyYamlSource(
  out: Array<{ id?: string; title: string; url: string; stance: DeeplyResearchSourceStance; snippet: string }>,
  source: Record<string, string>
): void {
  const title = source.title ?? source.name ?? "";
  const url = source.url ?? source.link ?? "";
  if (title.length === 0 || !/^https?:\/\//i.test(url)) return;
  const stanceRaw = (source.stance ?? "") as DeeplyResearchSourceStance;
  const stance = STANCES.includes(stanceRaw) ? stanceRaw : "primary";
  const snippet = (source.snippet ?? source.relevance ?? source.summary ?? source.description ?? "").slice(0, MAX_SNIPPET_CHARS);
  out.push({
    ...(source.id !== undefined && source.id.length > 0 ? { id: source.id } : {}),
    title,
    url,
    stance,
    snippet
  });
}

function buildOutlineMarkdownFromSections(
  sections: Array<{ index: number; title: string; sources: DeeplyResearchSource[] }>
): string {
  return sections
    .map((section) => {
      const lines = [`## 第${section.index}节:${section.title}`];
      for (const source of section.sources) lines.push(`- [${source.stance}] ${source.title} — ${source.url}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

function readTopLevelScalar(lines: string[], key: string): string {
  const line = lines.find((item) => item.startsWith(`${key}:`));
  if (line === undefined) return "";
  return readYamlScalarValue(line.slice(key.length + 1));
}

function readFoldedTopLevelBlock(lines: string[], key: string): string {
  const index = lines.findIndex((line) => line.trim() === `${key}: >` || line.trim() === `${key}: |`);
  if (index < 0) return "";
  const out: string[] = [];
  for (let i = index + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^\S/.test(line)) break;
    const trimmed = line.trim();
    if (trimmed.length > 0) out.push(trimmed);
  }
  return out.join(" ").trim();
}

function findTopLevelLine(lines: string[], key: string): number {
  return lines.findIndex((line) => line.trim() === `${key}:` && line.startsWith(key));
}

function findNextTopLevelLine(lines: string[], start: number): number {
  for (let i = start; i < lines.length; i += 1) {
    if (/^[A-Za-z_][\w-]*:\s*/.test(lines[i] ?? "")) return i;
  }
  return -1;
}

function readYamlScalarValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const quote = trimmed[0];
    if ((quote === "\"" || quote === "'") && trimmed[trimmed.length - 1] === quote) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
