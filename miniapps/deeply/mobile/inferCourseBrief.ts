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
  /**
   * 强制重新调一次 LLM,不走缓存。默认 false(命中缓存就直接返回)。
   * 留给"刷新介绍"这类未来 UI 用,目前没人传。
   */
  force?: boolean;
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
 * Process-wide in-memory cache for course briefs.
 *
 * 用户在 explore 页点一张推荐卡 → CourseDetailSheet 起来 → inferCourseBrief
 * 调 LLM,大概要等 3-10 秒。关掉 sheet 再点同一张卡时,sheet 组件会重新 mount、
 * useEffect 重新跑、又会发一遍同一个 LLM 请求 —— 用户感受是"白等了"。
 *
 * 简单做法:按卡片身份(kind+title+subtitle)在内存里 cache 最近成功的 brief。
 *
 * 故意不持久化(MMKV / disk)的考虑:
 *   - brief 跟着 prompt 模板 + 模型版本走,跨 session 失效成本高
 *   - process 重启就清光,反而更安全
 *   - 单条 ~1KB,16k 本书全 hit 也才 ~16MB,目前不需要 LRU 上限
 *
 * 故意不把 transcript 纳入 cache key 的考虑:
 *   - 典型场景是用户秒内反复点同一张卡;transcript 多半没变
 *   - 即便变了,brief 是"介绍这门课"的稳态内容,影响很小
 *   - 真要按 transcript 失效再扩;现在以"瞬时复点"的体感优先
 */
const briefCache = new Map<string, DeeplyCourseBrief>();

function briefCacheKey(card: DeeplyRecommendationCard): string {
  return `${card.kind}|${card.title}|${card.subtitle}`;
}

/**
 * 同步查 brief 缓存。命中时 CourseDetailSheet 可以直接以 "ready" 初始化,
 * 完全跳过 loading state 那一帧;未命中(null)走正常 async path。
 */
export function lookupCachedCourseBrief(
  card: DeeplyRecommendationCard
): DeeplyCourseBrief | null {
  return briefCache.get(briefCacheKey(card)) ?? null;
}

/** 测试 / dev 用:清空 brief 缓存。生产路径不调。 */
export function clearCourseBriefCache(): void {
  briefCache.clear();
}

/**
 * Call deeply agent for the "course brief" of a recommended card.
 *
 * Used by the bottom sheet that appears when a user taps a recommendation
 * card: returns the detailed introduction + suggested section count +
 * agent-decided extra option dimensions.
 *
 * 命中 in-memory cache 时直接返回,跳过 LLM call。失败不 cache,允许重试。
 */
export async function inferCourseBrief(
  input: InferCourseBriefInput
): Promise<InferCourseBriefResult> {
  const cacheKey = briefCacheKey(input.card);
  if (input.force !== true) {
    const cached = briefCache.get(cacheKey);
    if (cached !== undefined) {
      return { ok: true, brief: cached };
    }
  }

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
    briefCache.set(cacheKey, parsed.value);
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
