/**
 * Phase B of the two-phase research course pipeline (v2).
 *
 * Phase A produces a `koko.deeply.research.plan` (courseTitle, introduction,
 * sections[{title, searchHint}]) — its attention is on teaching structure,
 * not on collecting URLs.
 *
 * Phase B (this module) opens that plan in a fresh oneshot `inferOnce`
 * against the same Deeply agent, runs per-section hosted search using the
 * plan's `searchHint`, and emits the existing
 * `koko.deeply.research.outline` fenced block (each section + its real
 * sources). The deeply agent still has `web_fetch` available, so the
 * oneshot session is an agent loop with multi-step search.
 *
 * Output schema and downstream client wiring (parseResearchOutline,
 * applyResearchOutlineToCourse) is unchanged.
 */

import { inferOnce } from "@/runtime/openclaw";

import { DEEPLY_MINI_APP_ID } from "./constants";
import {
  parseDeeplyResearchOutline,
  type DeeplyResearchOutline
} from "./parseResearchOutline";
import type { DeeplyResearchPlan } from "./parseResearchPlan";
import { buildResearchOutlineFromPlanPrompt } from "./persona";

const DEEPLY_AGENT_ID = "deeply";

// Phase B is an agent loop: it will run hosted search once per section,
// plus optional `web_fetch` for noteworthy URLs. Bound to a higher ceiling
// because a 7-10-section plan with a hosted-search call each can run
// 2-5 minutes end to end.
const PHASE_B_TIMEOUT_MS = 360_000;

export interface InferResearchOutlineFromPlanInput {
  /** User's original topic; falls back to `plan.topic` if empty. */
  topic: string;
  plan: DeeplyResearchPlan;
}

export type InferResearchOutlineFromPlanResult =
  | { ok: true; value: DeeplyResearchOutline; rawText: string }
  | { ok: false; error: string; rawText?: string };

export async function inferResearchOutlineFromPlan(
  input: InferResearchOutlineFromPlanInput
): Promise<InferResearchOutlineFromPlanResult> {
  const topic = input.topic.length > 0 ? input.topic : input.plan.topic;
  const prompt = buildResearchOutlineFromPlanPrompt({
    topic,
    plan: {
      courseTitle: input.plan.courseTitle,
      introduction: input.plan.introduction,
      sections: input.plan.sections
    }
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
