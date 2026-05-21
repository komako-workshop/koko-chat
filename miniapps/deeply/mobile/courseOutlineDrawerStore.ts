import { useSyncExternalStore } from "react";

/**
 * 全局开/关 Deeply 课程目录抽屉的 store。
 *
 * 跟 CourseDetailSheet 同模式:抽屉得活在 DeeplyCourseScreen 的 root 里
 * (用 absolute overlay),不能跨 host stack 用 RN Modal,否则跳出 demo
 * frame。header 右上角按钮(在 host route 壳里)调 open,DeeplyCourseScreen
 * 顶层 mount 监听并渲染抽屉。
 */
export interface DeeplyCourseOutlineDrawerState {
  /** Which conversation the drawer was opened for. */
  conversationId: string | null;
  isOpen: boolean;
}

const initialState: DeeplyCourseOutlineDrawerState = {
  conversationId: null,
  isOpen: false
};

let currentState: DeeplyCourseOutlineDrawerState = initialState;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function setState(next: DeeplyCourseOutlineDrawerState): void {
  if (
    next.conversationId === currentState.conversationId &&
    next.isOpen === currentState.isOpen
  ) {
    return;
  }
  currentState = next;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): DeeplyCourseOutlineDrawerState {
  return currentState;
}

export function openDeeplyCourseOutlineDrawer(conversationId: string): void {
  setState({ conversationId, isOpen: true });
}

export function closeDeeplyCourseOutlineDrawer(): void {
  if (!currentState.isOpen) return;
  setState({ ...currentState, isOpen: false });
}

export function useDeeplyCourseOutlineDrawerState(): DeeplyCourseOutlineDrawerState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
