import { inferOnce } from "@/runtime/openclaw";

import { DEEPLY_MINI_APP_ID } from "./constants";
import {
  parseDeeplyQuickReplies,
  type DeeplyQuickReplyChip
} from "./parseCourseQuickReplies";
import { buildCourseQuickRepliesPrompt } from "./persona";

export interface InferCourseQuickRepliesInput {
  courseTitle: string;
  section: number;
  sectionTitle: string;
  lastAgentText: string;
  timeoutMs?: number;
}

export interface InferCourseQuickRepliesSuccess {
  ok: true;
  chips: DeeplyQuickReplyChip[];
}

export interface InferCourseQuickRepliesFailure {
  ok: false;
  error: string;
}

export type InferCourseQuickRepliesResult =
  | InferCourseQuickRepliesSuccess
  | InferCourseQuickRepliesFailure;

/**
 * 给一节讲解的尾巴拉一次轻量 inferOnce,生成 2-3 个好奇点快捷回复。
 *
 * 失败时(超时 / parse 失败)返回 ok:false,UI 侧静默不显示 chip,
 * 不该让这条副线挡住主线讲解 UX。
 */
export async function inferCourseQuickReplies(
  input: InferCourseQuickRepliesInput
): Promise<InferCourseQuickRepliesResult> {
  if (input.lastAgentText.trim().length === 0) {
    return { ok: false, error: "lastAgentText 为空" };
  }
  const prompt = buildCourseQuickRepliesPrompt({
    courseTitle: input.courseTitle,
    section: input.section,
    sectionTitle: input.sectionTitle,
    lastAgentText: input.lastAgentText
  });
  try {
    const result = await inferOnce({
      miniAppId: DEEPLY_MINI_APP_ID,
      prompt,
      // 小请求,30 秒够用;太长就放弃,不挡 UX。
      timeoutMs: input.timeoutMs ?? 30_000
    });
    const parsed = parseDeeplyQuickReplies(result.text);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error };
    }
    return { ok: true, chips: parsed.value.chips };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
