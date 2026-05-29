/**
 * Parser for the `koko.deeply.research.plan` fenced block.
 *
 * Single-pass plan: the Deeply agent searches the web to ground itself, then
 * designs the course outline and emits ONE `koko.deeply.research.plan` block:
 *   { version, topic, courseTitle, introduction, sections: [{ index, title }] }
 *
 * It does NOT cite per-section sources. The client lands this plan straight
 * into the course (applyResearchPlanToCourse); each section's material is
 * searched live by that section's lecture turn, not here.
 *
 * Designing the teaching structure first (rather than letting raw search
 * results dictate section shape) keeps the outline aligned with the user's
 * ask — e.g. a "viewpoints by famous investor" topic stays organised around
 * those people instead of collapsing into a generic "bulls vs bears" split.
 */

import { extractFencedBlock } from "@/runtime/messageBlocks";

export const DEEPLY_RESEARCH_PLAN_BLOCK_TYPE = "koko.deeply.research.plan";

const MAX_TITLE_CHARS = 40;
const MAX_INTRO_CHARS = 1200;
const MAX_COURSE_TITLE_CHARS = 60;
const MIN_SECTIONS = 2;
const MAX_SECTIONS = 40;

export interface DeeplyResearchPlanSection {
  index: number;
  title: string;
}

export interface DeeplyResearchPlan {
  version: 1;
  topic: string;
  courseTitle: string;
  introduction: string;
  sections: DeeplyResearchPlanSection[];
}

export interface ParseSuccess { ok: true; value: DeeplyResearchPlan }
export interface ParseFailure { ok: false; error: string }
export type ParseResult = ParseSuccess | ParseFailure;

export function parseDeeplyResearchPlan(assistantText: string): ParseResult {
  const fenced = extractFencedBlock(assistantText, DEEPLY_RESEARCH_PLAN_BLOCK_TYPE);
  if (fenced === null) {
    return { ok: false, error: "未找到 koko.deeply.research.plan 块" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fenced.body.trim());
  } catch (error) {
    return {
      ok: false,
      error: `JSON 解析失败:${error instanceof Error ? error.message : String(error)}`
    };
  }
  if (!isRecord(raw)) {
    return { ok: false, error: "fenced block 内部必须是 JSON 对象" };
  }

  const topic = trimString(raw.topic).slice(0, MAX_COURSE_TITLE_CHARS * 4);
  const courseTitle = trimString(raw.courseTitle).slice(0, MAX_COURSE_TITLE_CHARS);
  const introduction = trimString(raw.introduction).slice(0, MAX_INTRO_CHARS);
  if (courseTitle.length === 0) {
    return { ok: false, error: "courseTitle 不能为空" };
  }
  if (introduction.length === 0) {
    return { ok: false, error: "introduction 不能为空" };
  }

  const rawSections = Array.isArray(raw.sections) ? raw.sections : [];
  const sections: DeeplyResearchPlanSection[] = [];
  for (let i = 0; i < rawSections.length; i += 1) {
    const item = rawSections[i];
    if (!isRecord(item)) continue;
    const title = stripSectionPrefix(
      trimString(item.title) || trimString(item.name)
    ).slice(0, MAX_TITLE_CHARS);
    if (title.length === 0) continue;
    const rawIndex = typeof item.index === "number" ? Math.trunc(item.index) : NaN;
    const index = Number.isFinite(rawIndex) && rawIndex > 0 ? rawIndex : i + 1;
    sections.push({ index, title });
  }

  if (sections.length < MIN_SECTIONS) {
    return {
      ok: false,
      error: `sections 至少 ${MIN_SECTIONS} 节,实际 ${sections.length} 节`
    };
  }
  const trimmed = sections.slice(0, MAX_SECTIONS);
  // Stable renumber so progress UI is monotonic regardless of what the
  // model wrote.
  const renumbered = trimmed.map((section, idx) => ({
    index: idx + 1,
    title: section.title
  }));

  return {
    ok: true,
    value: {
      version: 1,
      topic,
      courseTitle,
      introduction,
      sections: renumbered
    }
  };
}

function stripSectionPrefix(title: string): string {
  return title.replace(/^第\s*[零〇一二两三四五六七八九十百\d]+\s*节\s*[:：]\s*/, "").trim();
}

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
