/**
 * 解析 `koko.deeply.course-brief` fenced block。
 *
 * 用户在探索 chat 里点击一张推荐卡时,我们后台调一次 inferOnce 让 deeply
 * agent 生成"这门课"的详细介绍 + 配置选项,作为弹窗里 commit gate 的数据。
 *
 * 关键设计:options 完全由 agent 自由决定(0-2 个),既不预设"难度"也不
 * 预设"风格"。Agent 看到对话上下文和卡片本身,自己判断需要再问什么 ——
 * 跟 Cursor / Claude Code 的 plan 风格一致。"想讲多少节" 是固定控件,
 * 不在 options 数组里。
 */
import { extractFencedBlock } from "@/runtime/messageBlocks";

export const DEEPLY_COURSE_BRIEF_BLOCK_TYPE = "koko.deeply.course-brief";

const MIN_OPTIONS = 0;
const MAX_OPTIONS = 2;
const MIN_CHOICES = 2;
const MAX_CHOICES = 4;
const MIN_SECTIONS = 10;
const MAX_SECTIONS = 60;
const INTRO_MAX_CHARS = 1200;

export interface DeeplyCourseBriefChoice {
  value: string;
  label: string;
  description?: string;
}

export interface DeeplyCourseBriefOption {
  id: string;
  title: string;
  description?: string;
  choices: DeeplyCourseBriefChoice[];
  defaultValue: string;
}

export interface DeeplyCourseBrief {
  version: 1;
  introduction: string;
  suggestedSections: number;
  options: DeeplyCourseBriefOption[];
}

export interface ParseFailure {
  ok: false;
  error: string;
}

export interface ParseSuccess {
  ok: true;
  value: DeeplyCourseBrief;
}

export type ParseResult = ParseSuccess | ParseFailure;

export function parseDeeplyCourseBrief(assistantText: string): ParseResult {
  const fenced = extractFencedBlock(assistantText, DEEPLY_COURSE_BRIEF_BLOCK_TYPE);
  if (fenced === null) {
    return { ok: false, error: "未找到 koko.deeply.course-brief 课程介绍块" };
  }
  const body = fenced.body.trim();
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch (error) {
    return {
      ok: false,
      error: `课程介绍块 JSON 解析失败: ${error instanceof Error ? error.message : String(error)}`
    };
  }
  if (!isRecord(raw)) {
    return { ok: false, error: "课程介绍块不是 JSON 对象" };
  }
  if (raw.version !== 1) {
    return { ok: false, error: `课程介绍块版本号不被支持: ${String(raw.version)}` };
  }
  const intro = readNonEmpty(raw.introduction, "introduction");
  if (intro.error !== undefined) return { ok: false, error: intro.error };
  if (intro.value.length > INTRO_MAX_CHARS) {
    return { ok: false, error: `introduction 长度超过 ${INTRO_MAX_CHARS}` };
  }
  const sections = readSections(raw.suggestedSections, "suggestedSections");
  if (sections.error !== undefined) return { ok: false, error: sections.error };

  const options: DeeplyCourseBriefOption[] = [];
  if (raw.options !== undefined) {
    if (!Array.isArray(raw.options)) {
      return { ok: false, error: "options 不是数组" };
    }
    if (raw.options.length > MAX_OPTIONS) {
      return { ok: false, error: `options 数量超过 ${MAX_OPTIONS}` };
    }
    if (raw.options.length < MIN_OPTIONS) {
      return { ok: false, error: `options 数量小于 ${MIN_OPTIONS}` };
    }
    for (let i = 0; i < raw.options.length; i += 1) {
      const opt = parseOption(raw.options[i], i);
      if (opt.error !== undefined) return { ok: false, error: opt.error };
      options.push(opt.value);
    }
  }

  return {
    ok: true,
    value: {
      version: 1,
      introduction: intro.value,
      suggestedSections: sections.value,
      options
    }
  };
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

function parseOption(value: unknown, index: number): Read<DeeplyCourseBriefOption> {
  const where = `options[${index}]`;
  if (!isRecord(value)) {
    return { error: `${where} 不是对象` };
  }
  const id = readNonEmpty(value.id, `${where}.id`);
  if (id.error !== undefined) return { error: id.error };
  const title = readNonEmpty(value.title, `${where}.title`);
  if (title.error !== undefined) return { error: title.error };
  const description = readOptionalString(value.description, `${where}.description`);
  if (description.error !== undefined) return { error: description.error };

  if (!Array.isArray(value.choices)) {
    return { error: `${where}.choices 不是数组` };
  }
  if (value.choices.length < MIN_CHOICES || value.choices.length > MAX_CHOICES) {
    return {
      error: `${where}.choices 数量异常: 期望 ${MIN_CHOICES}-${MAX_CHOICES}, 得到 ${value.choices.length}`
    };
  }
  const choices: DeeplyCourseBriefChoice[] = [];
  const valueSet = new Set<string>();
  for (let i = 0; i < value.choices.length; i += 1) {
    const choice = parseChoice(value.choices[i], `${where}.choices[${i}]`);
    if (choice.error !== undefined) return { error: choice.error };
    if (valueSet.has(choice.value.value)) {
      return { error: `${where}.choices 出现重复 value: ${choice.value.value}` };
    }
    valueSet.add(choice.value.value);
    choices.push(choice.value);
  }
  const defaultValue = readNonEmpty(value.defaultValue, `${where}.defaultValue`);
  if (defaultValue.error !== undefined) return { error: defaultValue.error };
  if (!valueSet.has(defaultValue.value)) {
    return { error: `${where}.defaultValue 不在 choices 列表中` };
  }

  return {
    value: {
      id: id.value,
      title: title.value,
      ...(description.value !== "" ? { description: description.value } : {}),
      choices,
      defaultValue: defaultValue.value
    }
  };
}

function parseChoice(value: unknown, where: string): Read<DeeplyCourseBriefChoice> {
  if (!isRecord(value)) {
    return { error: `${where} 不是对象` };
  }
  const v = readNonEmpty(value.value, `${where}.value`);
  if (v.error !== undefined) return { error: v.error };
  const label = readNonEmpty(value.label, `${where}.label`);
  if (label.error !== undefined) return { error: label.error };
  const description = readOptionalString(value.description, `${where}.description`);
  if (description.error !== undefined) return { error: description.error };
  return {
    value: {
      value: v.value,
      label: label.value,
      ...(description.value !== "" ? { description: description.value } : {})
    }
  };
}

function readNonEmpty(value: unknown, name: string): Read<string> {
  if (typeof value !== "string") return { error: `${name} 不是字符串` };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { error: `${name} 不能为空` };
  return { value: trimmed };
}

function readOptionalString(value: unknown, name: string): Read<string> {
  if (value === undefined || value === null) return { value: "" };
  if (typeof value !== "string") return { error: `${name} 不是字符串` };
  return { value: value.trim() };
}

function readSections(value: unknown, name: string): Read<number> {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { error: `${name} 不是数字` };
  }
  const n = Math.round(value);
  const clamped = Math.max(MIN_SECTIONS, Math.min(MAX_SECTIONS, n));
  return { value: clamped };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
