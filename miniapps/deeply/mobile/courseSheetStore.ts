import { useSyncExternalStore } from "react";

import type { DeeplyRecommendationCard } from "./parseRecommendations";

/**
 * 全局开/关 CourseDetailSheet 的 store。
 *
 * 为什么需要"全局"而不是让 RecommendationCard 自己拥有 sheet 的 visible state:
 *   - 推荐卡是 host MessageBlockView 在每条消息里渲染的子树。
 *     如果它们各自挂一个 RN `Modal`,Modal 会 portal 到根视图外,
 *     **直接跳出我们这个 demo frame**(手机宽度框),web demo 上效果就是
 *     "sheet 横铺整个浏览器宽度"。
 *   - 改成:卡片 onPress 只调 store.open(),sheet 由 DeeplyExploreScreen
 *     在自己的 root 里用 absolute overlay 渲染一次。这样 sheet 永远活在
 *     demo frame 内部。
 *   - 顺带保证任何时刻最多只有一个 sheet 打开。
 *
 * 实现:vanilla observable + useSyncExternalStore,不引入 zustand 之类
 * 外部依赖到 mini-app workspace。
 */
export interface DeeplyCourseSheetState {
  card: DeeplyRecommendationCard | null;
  /** Explore conversation id that owns the card. Used as transcript context. */
  conversationId: string | null;
  isOpen: boolean;
}

const initialState: DeeplyCourseSheetState = {
  card: null,
  conversationId: null,
  isOpen: false
};

let currentState: DeeplyCourseSheetState = initialState;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function setState(next: DeeplyCourseSheetState): void {
  if (next === currentState) return;
  currentState = next;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): DeeplyCourseSheetState {
  return currentState;
}

export function openDeeplyCourseSheet(
  card: DeeplyRecommendationCard,
  conversationId: string
): void {
  setState({ card, conversationId, isOpen: true });
}

export function closeDeeplyCourseSheet(): void {
  if (!currentState.isOpen) return;
  setState({ ...currentState, isOpen: false });
}

export function useDeeplyCourseSheetState(): DeeplyCourseSheetState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
