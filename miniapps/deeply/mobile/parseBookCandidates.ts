/**
 * 解析 `koko.deeply.book.candidates` fenced block。
 *
 * "从一本书入门" disambiguation 阶段 agent 的交付物:用户在 sheet 里只输了
 * 一个书名,agent 这一轮先通过 KokoChat 托管搜索(web_fetch deeply.plus)
 * 找出 1-5 个可能的真实候选(同名书 / 不同版本 / 译本),输出这个 fenced
 * block,**不出 outline**,等用户在 chat 里点候选卡片确认。
 *
 * 客户端把 fenced block 解开成:
 *   1. intro 段(prose,可选)
 *   2. N 张 BookCandidateCard(可点击)
 *
 * 用户点某张卡片后,客户端 dispatch 一条 visible text 给 agent
 * (见 `persona.ts` 里的 `buildBookCandidateChosenVisibleText`),
 * 触发第二轮 outline kickoff。
 *
 * Schema 设计原则:**这是「防乌龙」的 disambiguation,不是「选版本」**。
 * 用户关心的是"是哪个作者写的关于什么的书",不关心 1998 年版还是 2017 年版。
 * 所以字段只有 author + subject(关于什么的),不带 year / edition。
 *
 * ```koko.deeply.book.candidates
 * {
 *   "version": 1,
 *   "intro": "我搜了一下「活着」,有这几个不同的作品,你点选一本:",
 *   "candidates": [
 *     {
 *       "title": "活着",
 *       "author": "余华",
 *       "subject": "当代中国长篇小说,讲徐福贵在大跃进/文革年代失去亲人的故事",
 *       "tagline": "(可选)进一步区分句,比如重点强调跟其它候选的差别"
 *     }
 *   ]
 * }
 * ```
 */
import { extractFencedBlock } from "@/runtime/messageBlocks";

export const DEEPLY_BOOK_CANDIDATES_BLOCK_TYPE = "koko.deeply.book.candidates";
export const DEEPLY_BOOK_CANDIDATE_BLOCK_TYPE = "koko.deeply.book.candidate";

const MIN_CANDIDATES = 1;
const MAX_CANDIDATES = 5;
const MAX_TITLE_CHARS = 120;
const MAX_AUTHOR_CHARS = 120;
const MAX_SUBJECT_CHARS = 120;
const MAX_TAGLINE_CHARS = 120;
const MAX_INTRO_CHARS = 240;

export interface DeeplyBookCandidate {
  title: string;
  /**
   * 作者(主作者 / 编者)。author 是 disambiguation 的核心,几乎任何同名书都
   * 是不同作者写的。建议必填,但 agent 偶尔搞不清作者时允许省略(parser 不强制)。
   */
  author?: string;
  /**
   * 关于什么的 —— 体裁 + 主题 + 时代背景。一句话,<= 120 字。这是用户识别
   * 「是这本不是那本」的关键依据。**禁止用这里描述出版社 / 译本 / 版本年份。**
   */
  subject?: string;
  /**
   * (可选)进一步的一句区分话,只在主标题 + author + subject 还不够区分时填。
   * 大多数情况留空,避免重复 subject 已经说过的信息。
   */
  tagline?: string;
}

export interface DeeplyBookCandidates {
  version: 1;
  intro: string;
  candidates: DeeplyBookCandidate[];
}

export type DeeplyBookCandidatesParseResult =
  | { ok: true; value: DeeplyBookCandidates }
  | { ok: false; error: string };

export function parseDeeplyBookCandidates(
  assistantText: string
): DeeplyBookCandidatesParseResult {
  const fenced = extractFencedBlock(assistantText, DEEPLY_BOOK_CANDIDATES_BLOCK_TYPE);
  if (fenced === null) {
    return { ok: false, error: "未找到 koko.deeply.book.candidates 块" };
  }
  const body = fenced.body.trim();

  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch (err) {
    return {
      ok: false,
      error: `book.candidates JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`
    };
  }
  if (!isRecord(raw)) return { ok: false, error: "book.candidates 不是 JSON 对象" };

  const candidatesRaw = raw.candidates;
  if (!Array.isArray(candidatesRaw)) {
    return { ok: false, error: "book.candidates.candidates 不是数组" };
  }
  if (
    candidatesRaw.length < MIN_CANDIDATES ||
    candidatesRaw.length > MAX_CANDIDATES
  ) {
    return {
      ok: false,
      error: `candidates 数量应在 ${MIN_CANDIDATES}-${MAX_CANDIDATES} 之间,实际 ${candidatesRaw.length}`
    };
  }

  const candidates: DeeplyBookCandidate[] = [];
  for (let i = 0; i < candidatesRaw.length; i += 1) {
    const c = parseCandidate(candidatesRaw[i], i);
    if (c.error !== undefined) return { ok: false, error: c.error };
    candidates.push(c.value);
  }

  const introRaw = typeof raw.intro === "string" ? raw.intro.trim() : "";
  const intro =
    introRaw.length > MAX_INTRO_CHARS ? introRaw.slice(0, MAX_INTRO_CHARS) : introRaw;

  return { ok: true, value: { version: 1, intro, candidates } };
}

export function isDeeplyBookCandidate(value: unknown): value is DeeplyBookCandidate {
  if (!isRecord(value)) return false;
  return typeof value.title === "string" && value.title.length > 0;
}

interface OkValue<T> {
  value: T;
  error?: undefined;
}
interface ErrValue {
  value?: undefined;
  error: string;
}
type Read<T> = OkValue<T> | ErrValue;

function parseCandidate(value: unknown, index: number): Read<DeeplyBookCandidate> {
  const where = `candidates[${index}]`;
  if (!isRecord(value)) return { error: `${where} 不是对象` };
  const title = readNonEmpty(value.title, `${where}.title`, MAX_TITLE_CHARS);
  if (title.error !== undefined) return { error: title.error };
  const author = readOptional(value.author, `${where}.author`, MAX_AUTHOR_CHARS);
  if (author.error !== undefined) return { error: author.error };
  const subject = readOptional(value.subject, `${where}.subject`, MAX_SUBJECT_CHARS);
  if (subject.error !== undefined) return { error: subject.error };
  const tagline = readOptional(value.tagline, `${where}.tagline`, MAX_TAGLINE_CHARS);
  if (tagline.error !== undefined) return { error: tagline.error };

  const out: DeeplyBookCandidate = { title: title.value };
  if (author.value.length > 0) out.author = author.value;
  if (subject.value.length > 0) out.subject = subject.value;
  if (tagline.value.length > 0) out.tagline = tagline.value;
  return { value: out };
}

function readNonEmpty(value: unknown, name: string, maxLen: number): Read<string> {
  if (typeof value !== "string") return { error: `${name} 不是字符串` };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { error: `${name} 为空` };
  return { value: trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed };
}

function readOptional(value: unknown, name: string, maxLen: number): Read<string> {
  if (value === undefined || value === null) return { value: "" };
  if (typeof value !== "string") return { error: `${name} 不是字符串` };
  const trimmed = value.trim();
  return { value: trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
