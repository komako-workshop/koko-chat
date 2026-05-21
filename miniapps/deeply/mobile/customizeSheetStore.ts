import { useSyncExternalStore } from "react";

/**
 * 全局开关 CourseCustomizeSheet 的 store。
 *
 * 设计跟 courseSheetStore 同构 —— 都需要 sheet 渲染在 DeeplyExploreScreen
 * 的 root 里(absolute overlay),否则 RN Modal 会 portal 出 demo frame,
 * web demo 上看起来就是横铺整个浏览器宽度。
 *
 * 这两个 sheet 不会同时打开:用户要么点"定制课程"开 customize,要么点推荐卡
 * 开 course detail,无需互锁。
 */
export interface DeeplyCustomizeSheetState {
  /** Explore conversation id that triggered the sheet. Forwarded to created course as parent. */
  conversationId: string | null;
  isOpen: boolean;
}

const initialState: DeeplyCustomizeSheetState = {
  conversationId: null,
  isOpen: false
};

let currentState: DeeplyCustomizeSheetState = initialState;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function setState(next: DeeplyCustomizeSheetState): void {
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

function getSnapshot(): DeeplyCustomizeSheetState {
  return currentState;
}

export function openDeeplyCustomizeSheet(conversationId: string | null): void {
  setState({ conversationId, isOpen: true });
}

export function closeDeeplyCustomizeSheet(): void {
  if (!currentState.isOpen) return;
  setState({ ...currentState, isOpen: false });
}

export function useDeeplyCustomizeSheetState(): DeeplyCustomizeSheetState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
