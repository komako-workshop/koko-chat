import { inferOnce } from "@/runtime/openclaw";
import type { ChatMessage } from "@/state/conversations";

import { DEEPLY_MINI_APP_ID } from "./constants";
import {
  parseDeeplyCourseBrief,
  type DeeplyCourseBrief
} from "./parseCourseBrief";
import type { DeeplyRecommendationCard } from "./parseRecommendations";
import { buildCourseBriefPrompt } from "./persona";

const MAX_TRANSCRIPT_TURNS = 8;
const MAX_TURN_CHARS = 600;

export interface InferCourseBriefInput {
  card: DeeplyRecommendationCard;
  messages: ChatMessage[];
  timeoutMs?: number;
}

export interface InferCourseBriefSuccess {
  ok: true;
  brief: DeeplyCourseBrief;
}
export interface InferCourseBriefFailure {
  ok: false;
  error: string;
  rawText?: string;
}
export type InferCourseBriefResult = InferCourseBriefSuccess | InferCourseBriefFailure;

/**
 * Call deeply agent for the "course brief" of a recommended card.
 *
 * Used by the bottom sheet that appears when a user taps a recommendation
 * card: returns the detailed introduction + suggested section count +
 * agent-decided extra option dimensions.
 */
export async function inferCourseBrief(
  input: InferCourseBriefInput
): Promise<InferCourseBriefResult> {
  const transcript = formatRecentTranscript(input.messages);
  const prompt = buildCourseBriefPrompt({
    card: {
      kind: input.card.kind,
      title: input.card.title,
      subtitle: input.card.subtitle,
      reason: input.card.reason,
      suggestedSections: input.card.suggestedSections
    },
    transcript
  });

  try {
    const result = await inferOnce({
      miniAppId: DEEPLY_MINI_APP_ID,
      prompt,
      timeoutMs: input.timeoutMs ?? 90_000
    });
    const parsed = parseDeeplyCourseBrief(result.text);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error, rawText: result.text };
    }
    return { ok: true, brief: parsed.value };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function formatRecentTranscript(messages: ChatMessage[]): string {
  const usable = messages
    .filter((m) => (m.role === "user" || m.role === "agent") && m.text.trim().length > 0)
    .slice(-MAX_TRANSCRIPT_TURNS);
  if (usable.length === 0) return "";
  return usable
    .map((m) => {
      const speaker = m.role === "user" ? "用户" : "Deeply";
      const text = m.text.trim().slice(0, MAX_TURN_CHARS);
      return `${speaker}:${text}`;
    })
    .join("\n\n");
}
