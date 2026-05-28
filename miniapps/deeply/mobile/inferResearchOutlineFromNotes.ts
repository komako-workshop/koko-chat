/**
 * Phase B of the two-phase research course pipeline.
 *
 * Phase A runs as a normal Deeply agent turn: it searches the web, narrates
 * the process, and emits a `koko.deeply.research.notes` fenced block with a
 * flat list of cited sources + a synthesis paragraph.
 *
 * Phase B (this module) takes those notes and runs ONE stateless `inferOnce`
 * against the same Deeply agent, asking it to:
 *   - decide on a section breakdown,
 *   - assign 2-4 already-cited sources to each section,
 *   - emit the existing `koko.deeply.research.outline` block.
 *
 * Phase B has no web tools available. Attention is fully on schema + section
 * planning. The transformer in mini-app index.ts kicks it off as soon as it
 * detects a notes block in the agent's reply.
 */

import { inferOnce } from "@/runtime/openclaw";

import { DEEPLY_MINI_APP_ID } from "./constants";
import {
  parseDeeplyResearchOutline,
  type DeeplyResearchOutline
} from "./parseResearchOutline";
import type { DeeplyResearchNotes } from "./parseResearchNotes";
import { buildResearchOutlineFromNotesPrompt } from "./persona";

const DEEPLY_AGENT_ID = "deeply";

// 一次只做 JSON 生成 + sections 拆分,不需要 web 工具,90 秒已是宽松上限。
const PHASE_B_TIMEOUT_MS = 90_000;

export interface InferResearchOutlineFromNotesInput {
  /** 用户原题,用于 prompt 头部"用户原题"段。 */
  topic: string;
  /** 用户在 customize sheet 选择的节数偏好。0 = auto。 */
  sections: number;
  notes: DeeplyResearchNotes;
}

export type InferResearchOutlineFromNotesResult =
  | { ok: true; value: DeeplyResearchOutline; rawText: string }
  | { ok: false; error: string; rawText?: string };

export async function inferResearchOutlineFromNotes(
  input: InferResearchOutlineFromNotesInput
): Promise<InferResearchOutlineFromNotesResult> {
  const prompt = buildResearchOutlineFromNotesPrompt({
    topic: input.topic.length > 0 ? input.topic : input.notes.topic,
    sections: input.sections,
    synthesis: input.notes.synthesis,
    sources: input.notes.sources
  });

  try {
    const result = await inferOnce({
      miniAppId: DEEPLY_MINI_APP_ID,
      agentId: DEEPLY_AGENT_ID,
      prompt,
      timeoutMs: PHASE_B_TIMEOUT_MS
    });
    const parsed = parseDeeplyResearchOutline(result.text);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error, rawText: result.text };
    }
    return { ok: true, value: parsed.value, rawText: result.text };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
