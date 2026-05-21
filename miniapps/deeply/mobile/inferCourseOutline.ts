import { inferOnce } from "@/runtime/openclaw";

import { DEEPLY_MINI_APP_ID } from "./constants";
import {
  parseDeeplyCourseOutline,
  type DeeplyOutlineSection
} from "./parseCourseOutline";
import { buildCourseOutlinePrompt } from "./persona";

export interface InferCourseOutlineInput {
  courseTitle: string;
  courseSubtitle: string;
  introduction: string;
  targetSections: number;
  timeoutMs?: number;
}

export interface InferCourseOutlineSuccess {
  ok: true;
  outlineMarkdown: string;
  sections: DeeplyOutlineSection[];
}

export interface InferCourseOutlineFailure {
  ok: false;
  error: string;
  rawText?: string;
}

export type InferCourseOutlineResult =
  | InferCourseOutlineSuccess
  | InferCourseOutlineFailure;

/**
 * 后台跑一次 inferOnce,让 deeply-course agent 写一份 markdown 大纲。
 * 返回的 outlineMarkdown 是原始 agent 文本,sections 是 parser 的结果。
 *
 * 给 outlineMarkdown 加大 timeoutMs:这一步会生成 30-50 个章节标题
 * + 隐喻 + 要点,比一般 inferOnce 重,150 秒比较稳。
 */
export async function inferCourseOutline(
  input: InferCourseOutlineInput
): Promise<InferCourseOutlineResult> {
  const prompt = buildCourseOutlinePrompt({
    courseTitle: input.courseTitle,
    courseSubtitle: input.courseSubtitle,
    introduction: input.introduction,
    targetSections: input.targetSections
  });
  try {
    const result = await inferOnce({
      miniAppId: DEEPLY_MINI_APP_ID,
      // 走 deeply mini-app 的默认 agent(deeply),跟讲解 conversation 共享
      // 同一个 OpenClaw agent。Session key 由 inferOnce 自己生成的临时 scope
      // 隔离,跟讲解 chat 的长会话互不污染。
      prompt,
      timeoutMs: input.timeoutMs ?? 150_000
    });
    const sections = parseDeeplyCourseOutline(result.text);
    if (sections.length === 0) {
      return {
        ok: false,
        error: "未能从大纲文本里解析出 `## 第N节:标题` 章节",
        rawText: result.text
      };
    }
    return { ok: true, outlineMarkdown: result.text.trim(), sections };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
