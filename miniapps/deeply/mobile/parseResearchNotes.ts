/**
 * Parser for the Phase A `koko.deeply.research.notes` fenced block.
 *
 * Two-phase research breakdown:
 *
 *   Phase A (this block) — Deeply agent does *only* research:
 *     - calls web_search / web_fetch as much as the topic needs
 *     - streams Chinese prose narration so the user sees the process
 *     - finishes by emitting ONE `koko.deeply.research.notes` block:
 *         { topic, synthesis, sources: [...] }
 *     - does NOT decide on sections, titles, or per-section assignment
 *
 *   Phase B (separate `inferOnce`) — same agent, but a stateless one-shot:
 *     - reads the Phase A notes
 *     - decides on a section breakdown and assigns sources per section
 *     - emits the existing `koko.deeply.research.outline` block
 *     - does NOT have web tools available (purely a JSON-generation turn)
 *
 * The split exists because asking the model to plan tools, narrate prose,
 * AND emit a strict per-section JSON schema in one turn was demonstrably
 * splitting its attention — the 2026-05-28 regression had toolCallCount=0
 * while the agent still produced a plausible-looking sources array from
 * its training data. Each phase now owns one job.
 */

import { extractFencedBlock } from "@/runtime/messageBlocks";

import type { DeeplyResearchSource, DeeplyResearchSourceStance } from "./parseResearchOutline";

export const DEEPLY_RESEARCH_NOTES_BLOCK_TYPE = "koko.deeply.research.notes";

const MAX_SYNTHESIS_CHARS = 1200;
const MAX_TOPIC_CHARS = 200;
const MAX_NOTE_CHARS = 240;
const MAX_SOURCES = 30; // Phase A casts a wider net than the final outline keeps.

const STANCES = ["primary", "counterpoint", "background"] as const;

export interface DeeplyResearchNotes {
  version: 1;
  topic: string;
  /** Free-form Chinese synthesis: 300-1200 chars, the agent's read on the topic. */
  synthesis: string;
  /** Flat list of sources collected this turn — Phase B will split them across sections. */
  sources: DeeplyResearchSource[];
}

export interface ParseSuccess { ok: true; value: DeeplyResearchNotes }
export interface ParseFailure { ok: false; error: string }
export type ParseResult = ParseSuccess | ParseFailure;

/**
 * Lightweight stream detector — true while the fenced block has started but
 * not yet closed. Used by streamingDisplayText to hide raw JSON from the
 * chat surface while the agent is mid-emit.
 */
export function isDeeplyResearchNotesStream(text: string): boolean {
  return /```[ \t]*koko\.deeply\.research\.notes\b/.test(text);
}

export function parseDeeplyResearchNotes(assistantText: string): ParseResult {
  const fenced = extractFencedBlock(assistantText, DEEPLY_RESEARCH_NOTES_BLOCK_TYPE);
  if (fenced === null) {
    return { ok: false, error: "未找到 koko.deeply.research.notes 块" };
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

  const topic = trimString(raw.topic).slice(0, MAX_TOPIC_CHARS);
  const synthesis = (
    trimString(raw.synthesis) ||
    trimString(raw.summary) ||
    trimString(raw.takeaway) ||
    trimString(raw.read)
  ).slice(0, MAX_SYNTHESIS_CHARS);

  const sources = collectSourcesLoose(Array.isArray(raw.sources) ? raw.sources : []);

  // Hard guardrail: research notes that don't carry any verifiable source URL
  // are exactly the failure mode that motivated the two-phase split.
  // Phase B has no way to recover (it can't search the web), so refuse here
  // and let the caller surface a retry banner instead of pretending we have
  // notes to summarise.
  if (sources.length === 0) {
    return {
      ok: false,
      error: "没有拿到任何可验证来源 URL;已拒绝把空 notes 转成调研课"
    };
  }
  if (synthesis.length === 0) {
    return {
      ok: false,
      error: "synthesis 字段为空,Phase B 无法在没有综合判断的情况下拆目录"
    };
  }

  return {
    ok: true,
    value: {
      version: 1,
      topic,
      synthesis,
      sources
    }
  };
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
    const stanceRaw = trimString(item.stance);
    const stance: DeeplyResearchSourceStance = (STANCES as readonly string[]).includes(stanceRaw)
      ? (stanceRaw as DeeplyResearchSourceStance)
      : "primary";
    const note = (
      trimString(item.note) ||
      trimString(item.notes) ||
      trimString(item.snippet) ||
      trimString(item.summary) ||
      trimString(item.relevance)
    ).slice(0, MAX_NOTE_CHARS);
    out.push({ title, url, stance, snippet: note });
    if (out.length >= MAX_SOURCES) break;
  }
  return out;
}

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
