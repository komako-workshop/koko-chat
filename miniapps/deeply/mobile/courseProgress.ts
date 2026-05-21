import { useSyncExternalStore } from "react";

import { getMiniAppStorage } from "@/runtime/miniAppStorage";

import { DEEPLY_MINI_APP_ID } from "./constants";
import type { DeeplyOutlineSection } from "./parseCourseOutline";

/**
 * 每门课程的进度状态,对齐 deeply.plus 原版进度模型:
 *
 *   - `currentSection`:主线进度,**单调不回退**。"继续:下一节" chip
 *     基于它决定下一节是几。
 *   - `totalSections`:整门课总节数(等于 outline.length)。
 *   - `readSections`:已讲过的节集合,支持跳读(可能非连续)。
 *   - `activeSection`:当前正在讲 / 最近讲到的节,用作目录高亮。
 *     **允许回退**(用户重听某节时不该污染 currentSection)。
 */
export interface DeeplyCourseProgress {
  currentSection: number;
  totalSections: number;
  readSections: number[];
  activeSection: number;
}

const STORAGE = getMiniAppStorage(DEEPLY_MINI_APP_ID);
const PROGRESS_PREFIX = "progress.";

function storageKey(conversationId: string): string {
  return `${PROGRESS_PREFIX}${conversationId}`;
}

function emptyProgress(): DeeplyCourseProgress {
  return {
    currentSection: 0,
    totalSections: 0,
    readSections: [],
    activeSection: 0
  };
}

const stateByConversation = new Map<string, DeeplyCourseProgress>();
const listenersByConversation = new Map<string, Set<() => void>>();

function emit(conversationId: string): void {
  const listeners = listenersByConversation.get(conversationId);
  if (listeners === undefined) return;
  for (const l of listeners) l();
}

function persist(conversationId: string, value: DeeplyCourseProgress): void {
  STORAGE.setJson(storageKey(conversationId), value);
}

function loadFromStorage(conversationId: string): DeeplyCourseProgress {
  const raw = STORAGE.getJson<DeeplyCourseProgress>(storageKey(conversationId));
  if (raw === undefined) return emptyProgress();
  return normalizeProgress(raw);
}

function normalizeProgress(value: unknown): DeeplyCourseProgress {
  if (value === null || typeof value !== "object") return emptyProgress();
  const v = value as Partial<DeeplyCourseProgress>;
  const total = typeof v.totalSections === "number" && Number.isFinite(v.totalSections)
    ? Math.max(0, Math.trunc(v.totalSections))
    : 0;
  const current = typeof v.currentSection === "number" && Number.isFinite(v.currentSection)
    ? Math.max(0, Math.trunc(v.currentSection))
    : 0;
  const active = typeof v.activeSection === "number" && Number.isFinite(v.activeSection)
    ? Math.max(0, Math.trunc(v.activeSection))
    : current;
  const read = Array.isArray(v.readSections)
    ? Array.from(
        new Set(
          v.readSections
            .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0)
            .map((n) => Math.trunc(n))
        )
      ).sort((a, b) => a - b)
    : [];
  return {
    currentSection: current,
    totalSections: total,
    readSections: read,
    activeSection: active
  };
}

function ensureState(conversationId: string): DeeplyCourseProgress {
  const cached = stateByConversation.get(conversationId);
  if (cached !== undefined) return cached;
  const loaded = loadFromStorage(conversationId);
  stateByConversation.set(conversationId, loaded);
  return loaded;
}

function setState(conversationId: string, next: DeeplyCourseProgress): void {
  const prev = stateByConversation.get(conversationId);
  if (
    prev !== undefined &&
    prev.currentSection === next.currentSection &&
    prev.totalSections === next.totalSections &&
    prev.activeSection === next.activeSection &&
    prev.readSections.length === next.readSections.length &&
    prev.readSections.every((v, i) => next.readSections[i] === v)
  ) {
    return;
  }
  stateByConversation.set(conversationId, next);
  persist(conversationId, next);
  emit(conversationId);
}

/** 在 outline 生成完成时调用,设置总节数,如果之前没初始化就把进度重置。 */
export function initDeeplyCourseProgress(
  conversationId: string,
  sections: DeeplyOutlineSection[]
): void {
  const prev = ensureState(conversationId);
  const total = sections.length;
  setState(conversationId, {
    currentSection: prev.currentSection,
    totalSections: total,
    readSections: prev.readSections.filter((n) => n <= total),
    activeSection: prev.activeSection > 0 && prev.activeSection <= total ? prev.activeSection : 0
  });
}

/**
 * 主线推进:用户讲完第 N 节后调用。currentSection 单调不回退;
 * activeSection 更新到 N;readSections 加 N。
 */
export function advanceDeeplyCourseProgress(
  conversationId: string,
  reachedSection: number
): void {
  const prev = ensureState(conversationId);
  const nextCurrent = Math.max(prev.currentSection, reachedSection);
  const readSet = new Set(prev.readSections);
  readSet.add(reachedSection);
  setState(conversationId, {
    currentSection: nextCurrent,
    totalSections: prev.totalSections,
    readSections: Array.from(readSet).sort((a, b) => a - b),
    activeSection: reachedSection
  });
}

/** 目录跳转 / 回看时调用:不影响 currentSection,只动 activeSection。 */
export function setDeeplyCourseActiveSection(
  conversationId: string,
  section: number
): void {
  const prev = ensureState(conversationId);
  setState(conversationId, {
    ...prev,
    activeSection: section
  });
}

/**
 * 用户从目录里直接点了某一节:
 * - 把 currentSection 直接设成 N(允许回退,跟 advance 的单调性不一样,
 *   这是用户主动 declare "我要从这一节继续",顶部进度 + 「下一节」chip
 *   立刻跟着切)
 * - activeSection 也设成 N
 * - readSections 加 N(立刻让目录标这节为已读 / 当前)
 *
 * 跟 deeply.plus 原版的目录点击行为同构。
 */
export function jumpDeeplyCourseToSection(
  conversationId: string,
  section: number
): void {
  const prev = ensureState(conversationId);
  const readSet = new Set(prev.readSections);
  readSet.add(section);
  setState(conversationId, {
    currentSection: section,
    totalSections: prev.totalSections,
    readSections: Array.from(readSet).sort((a, b) => a - b),
    activeSection: section
  });
}

function subscribe(conversationId: string, listener: () => void): () => void {
  let listeners = listenersByConversation.get(conversationId);
  if (listeners === undefined) {
    listeners = new Set();
    listenersByConversation.set(conversationId, listeners);
  }
  listeners.add(listener);
  // ensure initial load
  ensureState(conversationId);
  return () => {
    listeners?.delete(listener);
  };
}

export function getDeeplyCourseProgress(conversationId: string): DeeplyCourseProgress {
  return ensureState(conversationId);
}

export function useDeeplyCourseProgress(
  conversationId: string
): DeeplyCourseProgress {
  const sub = (listener: () => void): (() => void) => subscribe(conversationId, listener);
  const get = (): DeeplyCourseProgress => ensureState(conversationId);
  return useSyncExternalStore(sub, get, get);
}
