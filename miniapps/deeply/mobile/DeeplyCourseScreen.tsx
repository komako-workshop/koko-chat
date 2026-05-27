import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent
} from "react-native";

import { MarkdownText } from "@/components/MarkdownText";
import { MessageBlockView } from "@/runtime/messageBlocks";
import { useGatewayStore } from "@/state/gateway";
import {
  useConversationStore,
  type ChatMessage,
  type ConversationMeta
} from "@/state/conversations";

import { DeeplyCourseOutlineDrawerMount } from "./CourseOutlineDrawer";
import { BlinkingCursor, DeeplyPulse } from "./DeeplyPulse";
import { isDeeplyCourseBusy } from "./courseBusyState";
import {
  loadDeeplyCourseOutline,
  loadDeeplyCourseSessionRecord,
  retryDeeplyCourseOutline,
  type DeeplyCourseOutlineRecord,
  type DeeplyCourseSessionRecord
} from "./courseSession";
import {
  advanceDeeplyCourseProgress,
  useDeeplyCourseProgress
} from "./courseProgress";
import { inferCourseQuickReplies } from "./inferCourseQuickReplies";
import type { DeeplyQuickReplyChip } from "./parseCourseQuickReplies";
import { parseCourseSectionHeader } from "./parseCourseSectionHeader";
import {
  buildBookCandidateChosenVisibleText,
  buildBookKickoffVisibleText,
  buildContinueSectionUserText,
  buildMaterialKickoffVisibleText,
  buildResearchKickoffVisibleText
} from "./persona";

interface QuickRepliesEntry {
  runId: string;
  status: "loading" | "ready" | "error";
  chips?: DeeplyQuickReplyChip[];
  /**
   * loading 状态下记录开始时间。watchdog 用这个来 detect 卡死的 inflight
   * (transport 中断 / 切 mini-app 之后 gateway client 重连导致 inferOnce
   * 的 promise 永远不 resolve)。
   */
  startedAt?: number;
  /**
   * 单调递增的 generation。每次 fire 一次推进。后到的旧 promise resolve
   * 时拿到的 entry generation 不匹配就丢弃结果 —— 避免 watchdog 重发之后,
   * 旧那次的 timeout error 把新一次的 loading 覆盖掉。
   */
  generation: number;
}

/**
 * Watchdog 阈值:inferCourseQuickReplies 内部 timeoutMs = 30s,这里取 35s
 * 留 5s buffer 让自然 timeout 先发生。真的卡死(promise 不 reject 也不
 * resolve)时才走 watchdog 强制重发。
 */
const QUICK_REPLIES_STALE_MS = 35_000;
const QUICK_REPLIES_WATCHDOG_TICK_MS = 3_000;
const quickRepliesCache = new Map<string, QuickRepliesEntry>();

const DEEPLY_BG = "#F9F9F7";
const DEEPLY_INK = "#111111";
const DEEPLY_INK_SECONDARY = "#475569";
const DEEPLY_INK_MUTED = "#6B6B66";
const DEEPLY_HAIRLINE = "rgba(17,17,17,0.06)";
const DEEPLY_PANEL = "#F5F5F5";
const DEEPLY_PANEL_BORDER = "rgba(17,17,17,0.07)";
const DEEPLY_CONTINUE_BG = "#111111";
const DEEPLY_CONTINUE_TEXT = "#FFFFFF";

const EMPTY: ChatMessage[] = [];

/**
 * Module-level guard for the dev `?koko_auto_section=N` auto-firer.
 * Persists across StrictMode unmount/remount so a single trigger only
 * dispatches once per (conversation, section) pair.
 */
const autoSectionFired = new Set<string>();

/**
 * 课程窗口的滚动位置快照,key 是 conversationId,跨组件实例存活。
 * 用户切到别的 mini-app 再切回来,或者重进同一门课,FlatList 会重新
 * 挂载,如果没有 snapshot 就只能弹到顶或者底,体验跟 standard chat
 * (apps/koko-chat/app/chat/[id].tsx)对不上。
 *
 * 这里跟 standard chat 用的是同一套思路,但故意维护一个独立的 Map:
 * deeply 是另一个 package,跨 package 拉 host 的 module-level state
 * 既不干净也容易在 hot reload 之后出问题。两边的 NEAR_BOTTOM_THRESHOLD
 * 也允许有差(deeply 底部 chip row 更高,留一点缓冲)。
 */
interface CourseScrollSnapshot {
  contentHeight: number;
  viewportHeight: number;
  offsetY: number;
  isNearBottom: boolean;
}
const NEAR_BOTTOM_THRESHOLD_PX = 64;
const courseScrollSnapshots = new Map<string, CourseScrollSnapshot>();

function buildBootstrapKickoffVisibleText(
  record: DeeplyCourseSessionRecord
): string | null {
  if (record.kind === "library") {
    const lib = record.libraryInput;
    if (lib === undefined || lib.title.length === 0) return null;
    return buildBookCandidateChosenVisibleText({
      title: lib.title,
      author: lib.author,
      subject: lib.hook.length > 0 ? lib.hook : lib.category
    });
  }
  if (record.kind === "material") {
    const label = record.materialInput?.label;
    if (label === undefined || label.trim().length === 0) return null;
    return buildMaterialKickoffVisibleText({
      label,
      sections: record.sections
    });
  }
  if (record.kind === "book") {
    const book = record.bookInput;
    if (book === undefined || book.title.trim().length === 0) return null;
    return buildBookKickoffVisibleText({
      title: book.title,
      ...(book.author !== undefined ? { author: book.author } : {}),
      ...(book.edition !== undefined ? { edition: book.edition } : {}),
      sections: record.sections
    });
  }
  if (record.kind === "research") {
    const topic = record.researchTopic;
    if (topic === undefined || topic.trim().length === 0) return null;
    return buildResearchKickoffVisibleText({
      topic,
      sections: record.sections
    });
  }
  return null;
}

function retryBootstrapHint(record: DeeplyCourseSessionRecord): string {
  if (record.kind === "research") {
    return "正在重新启动调研任务,通常需要 3-10 分钟。";
  }
  if (record.kind === "book" || record.kind === "library") {
    return "正在重新确认书目并准备目录。";
  }
  if (record.kind === "material") {
    return "正在重新读取链接资料并准备目录。";
  }
  return "正在重新为你定课程目录,稍等一下。";
}

function saveCourseScrollSnapshot(
  conversationId: string | null,
  snapshot: CourseScrollSnapshot
): void {
  if (conversationId === null) return;
  courseScrollSnapshots.set(conversationId, {
    contentHeight: snapshot.contentHeight,
    viewportHeight: snapshot.viewportHeight,
    offsetY: Math.max(0, snapshot.offsetY),
    isNearBottom: snapshot.isNearBottom
  });
}

/**
 * Deeply 课程讲解 surface。视觉对齐 deeply.plus 原版:
 *   - 顶部:课程标题 + 进度 N/M(+ 目录预留)
 *   - 消息流:对齐 explore 视觉(AI 无气泡平铺 / 用户黑色胶囊)
 *   - 底部:「下一节」chip + 输入框 + 圆形发送
 *   - bootstrap loading 时显示骨架 banner,锁输入
 *   - bootstrap error 时显示错误 banner,锁输入
 *
 * 进度推进:每次 agent 流式完成时,客户端 parse last agent message 第一行,
 * 如果跟 expected 的 N 严格匹配,就把 progress.currentSection 推进到 N。
 * 跟 deeply 原版 server 端的 strict-first-line 推进同构。
 */
export function DeeplyCourseScreen({
  conversationId,
  headerHeight = 0,
  isRouteFocused = true,
  focusEpoch = 0
}: {
  conversationId: string | null;
  /**
   * Stack header 高度,由 host route 壳通过 `useHeaderHeight` 拿到。
   * 用作 KeyboardAvoidingView 的 keyboardVerticalOffset —— 跟 host
   * /chat/[id] 一致;不传 iOS 上键盘会遮住输入框。
   */
  headerHeight?: number;
  /**
   * Host route focus state. Deeply lives in its own package, so the host route
   * shell forwards navigation focus instead of importing router hooks here.
   */
  isRouteFocused?: boolean;
  /** Incremented by the host route every time `/deeply/course/[id]` focuses. */
  focusEpoch?: number;
}): React.ReactElement {
  const conversation = useConversationStore((s) =>
    conversationId === null ? null : s.list.find((m) => m.id === conversationId) ?? null
  );
  const messages = useConversationStore((s) =>
    conversationId === null ? EMPTY : s.messages[conversationId] ?? EMPTY
  );
  const status = useGatewayStore((s) => s.status);
  const sendUserMessage = useGatewayStore((s) => s.sendUserMessage);

  const record = conversationId === null ? null : loadDeeplyCourseSessionRecord(conversationId);
  // outline 在 bootstrap 时由 storage 写入,bootstrap.status ready 后读取一次即可。
  // 用 state 缓存,避免每个渲染都打 storage。
  const [outline, setOutline] = useState<DeeplyCourseOutlineRecord | null>(() =>
    conversationId === null ? null : loadDeeplyCourseOutline(conversationId)
  );
  const bootstrapStatus = conversation?.bootstrap?.status ?? "ready";
  useEffect(() => {
    if (conversationId === null) return;
    if (bootstrapStatus !== "ready") return;
    if (outline !== null) return;
    setOutline(loadDeeplyCourseOutline(conversationId));
  }, [conversationId, bootstrapStatus, outline]);

  const progress = useDeeplyCourseProgress(conversationId ?? "");
  const expectedNextSection = computeNextSection(progress);
  const totalSections = progress.totalSections > 0 ? progress.totalSections : (outline?.sections.length ?? 0);
  const nextSectionTitle = outline?.sections.find((s) => s.index === expectedNextSection)?.title ?? "";

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  // 滚动位置恢复:跟 standard chat 同构。详见文件顶部 courseScrollSnapshots。
  const isNearBottomRef = useRef(true);
  const scrollMetricsRef = useRef({
    contentHeight: 0,
    viewportHeight: 0,
    offsetY: 0
  });
  const pendingScrollRestoreRef = useRef<CourseScrollSnapshot | null>(
    conversationId === null ? null : courseScrollSnapshots.get(conversationId) ?? null
  );
  const hasRestoredScrollRef = useRef(pendingScrollRestoreRef.current === null);
  const lastConversationIdRef = useRef<string | null>(conversationId);
  const focusRestoreTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  if (lastConversationIdRef.current !== conversationId) {
    lastConversationIdRef.current = conversationId;
    const snapshot = conversationId === null
      ? null
      : courseScrollSnapshots.get(conversationId) ?? null;
    pendingScrollRestoreRef.current = snapshot;
    hasRestoredScrollRef.current = snapshot === null;
    if (snapshot !== null) {
      isNearBottomRef.current = snapshot.isNearBottom;
    }
  }
  if (pendingScrollRestoreRef.current !== null) {
    isNearBottomRef.current = pendingScrollRestoreRef.current.isNearBottom;
  }

  const updateNearBottom = useCallback((): void => {
    const { contentHeight, viewportHeight, offsetY } = scrollMetricsRef.current;
    if (contentHeight <= 0 || viewportHeight <= 0) {
      return;
    }
    const distanceToBottom = contentHeight - (offsetY + viewportHeight);
    isNearBottomRef.current = distanceToBottom <= NEAR_BOTTOM_THRESHOLD_PX;
  }, []);

  const saveCurrentScrollSnapshot = useCallback((): void => {
    saveCourseScrollSnapshot(conversationId, {
      ...scrollMetricsRef.current,
      isNearBottom: isNearBottomRef.current
    });
  }, [conversationId]);

  const scrollToBottomSoon = useCallback((animated: boolean): void => {
    // Programmatic scrolls may not reliably emit `onScroll` on all RN
    // targets. Keep the snapshot ref in sync so leaving after auto-following
    // to bottom does not persist an older manual offset.
    const { contentHeight, viewportHeight } = scrollMetricsRef.current;
    if (contentHeight > 0 && viewportHeight > 0) {
      scrollMetricsRef.current = {
        ...scrollMetricsRef.current,
        offsetY: Math.max(0, contentHeight - viewportHeight)
      };
      updateNearBottom();
      saveCurrentScrollSnapshot();
    }
    setTimeout(() => {
      listRef.current?.scrollToEnd({ animated });
    }, 16);
  }, [saveCurrentScrollSnapshot, updateNearBottom]);

  const tryRestoreSavedScroll = useCallback((): boolean => {
    const snapshot = pendingScrollRestoreRef.current;
    if (snapshot === null || hasRestoredScrollRef.current) return false;
    const { contentHeight, viewportHeight } = scrollMetricsRef.current;
    if (contentHeight <= 0 || viewportHeight <= 0) return true;

    if (snapshot.isNearBottom) {
      hasRestoredScrollRef.current = true;
      pendingScrollRestoreRef.current = null;
      isNearBottomRef.current = true;
      scrollToBottomSoon(false);
      return true;
    }
    const maxOffset = Math.max(0, contentHeight - viewportHeight);
    // During remount RN can report partial content height. Restoring before
    // `snapshot.offsetY` is representable clamps to the temporary bottom and
    // makes later content growth auto-follow to the real bottom. Wait until
    // the current content can actually hold the saved offset.
    if (
      contentHeight + 1 < snapshot.contentHeight &&
      maxOffset + 1 < snapshot.offsetY
    ) return true;
    hasRestoredScrollRef.current = true;
    pendingScrollRestoreRef.current = null;
    const offset = Math.min(Math.max(0, snapshot.offsetY), maxOffset);
    scrollMetricsRef.current = {
      ...scrollMetricsRef.current,
      offsetY: offset
    };
    updateNearBottom();
    setTimeout(() => {
      listRef.current?.scrollToOffset({ offset, animated: false });
    }, 16);
    return true;
  }, [scrollToBottomSoon, updateNearBottom]);

  const handleListScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      scrollMetricsRef.current = {
        contentHeight: contentSize.height,
        viewportHeight: layoutMeasurement.height,
        offsetY: contentOffset.y
      };
      if (pendingScrollRestoreRef.current !== null && !hasRestoredScrollRef.current) {
        tryRestoreSavedScroll();
        return;
      }
      updateNearBottom();
      saveCurrentScrollSnapshot();
    },
    [saveCurrentScrollSnapshot, tryRestoreSavedScroll, updateNearBottom]
  );

  const handleListLayout = useCallback(
    (height: number): void => {
      scrollMetricsRef.current = {
        ...scrollMetricsRef.current,
        viewportHeight: height
      };
      updateNearBottom();
      tryRestoreSavedScroll();
    },
    [tryRestoreSavedScroll, updateNearBottom]
  );

  const handleContentSizeChange = useCallback(
    (height: number): void => {
      const shouldFollowBottom = isNearBottomRef.current;
      scrollMetricsRef.current = {
        ...scrollMetricsRef.current,
        contentHeight: height
      };
      updateNearBottom();
      if (tryRestoreSavedScroll()) return;
      if (shouldFollowBottom && messages.length > 0) {
        scrollToBottomSoon(false);
      }
    },
    [messages.length, scrollToBottomSoon, tryRestoreSavedScroll, updateNearBottom]
  );

  // 切换 conversationId 时,把待恢复的 snapshot 重新指向新对话。同一
  // 组件实例如果跨 conversation 切换(比如 expo-router 复用 screen),
  // 这一步保证不会拿着旧 snapshot 去恢复新对话。
  useEffect(() => {
    const snapshot = conversationId === null
      ? null
      : courseScrollSnapshots.get(conversationId) ?? null;
    pendingScrollRestoreRef.current = snapshot;
    hasRestoredScrollRef.current = snapshot === null;
    if (snapshot !== null) {
      isNearBottomRef.current = snapshot.isNearBottom;
    }
    if (snapshot === null) return;

    const restoreRetryDelaysMs = [16, 80, 200, 400, 800];
    const timers = restoreRetryDelaysMs.map((delay) =>
      setTimeout(() => {
        if (hasRestoredScrollRef.current) return;
        tryRestoreSavedScroll();
      }, delay)
    );
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [conversationId, tryRestoreSavedScroll]);

  useEffect(() => {
    if (conversationId === null) return;
    const clearFocusRestoreTimers = (): void => {
      for (const timer of focusRestoreTimersRef.current) clearTimeout(timer);
      focusRestoreTimersRef.current = [];
    };
    if (!isRouteFocused) {
      clearFocusRestoreTimers();
      saveCurrentScrollSnapshot();
      return;
    }

    clearFocusRestoreTimers();
    const snapshot = courseScrollSnapshots.get(conversationId) ?? null;
    pendingScrollRestoreRef.current = snapshot;
    hasRestoredScrollRef.current = snapshot === null;
    if (snapshot !== null) {
      isNearBottomRef.current = snapshot.isNearBottom;
    }
    if (snapshot === null) return;

    const restoreRetryDelaysMs = [0, 16, 80, 200, 400, 800];
    focusRestoreTimersRef.current = restoreRetryDelaysMs.map((delay) =>
      setTimeout(() => {
        if (hasRestoredScrollRef.current) return;
        tryRestoreSavedScroll();
      }, delay)
    );
    return clearFocusRestoreTimers;
  }, [
    conversationId,
    focusEpoch,
    isRouteFocused,
    saveCurrentScrollSnapshot,
    tryRestoreSavedScroll
  ]);

  // 卸载或切对话之前,把当前位置写回 snapshot —— onScroll 已经在持续
  // save,这一步主要兜底极端情况(用户从来没滑动过,但 contentSize 改过)。
  useEffect(() => {
    return () => {
      saveCurrentScrollSnapshot();
    };
  }, [saveCurrentScrollSnapshot]);

  // 主线推进监听:每当 messages 增长或 streaming 状态变化,看 last agent
  // 消息有没有"刚完成"+ 首行匹配 expected,匹配就推 progress。lastSeenRef
  // 用来避免重复推同一个 runId。
  const lastAdvancedRunIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (conversationId === null) return;
    if (messages.length === 0) return;
    const lastAgent = findLastSettledAgentMessage(messages);
    if (lastAgent === null) return;
    if (lastAgent.runId !== undefined && lastAgent.runId === lastAdvancedRunIdRef.current) return;
    const header = parseCourseSectionHeader(lastAgent.text);
    if (header === null) return;
    if (header.section <= 0) return;
    if (totalSections > 0 && header.section > totalSections) return;
    advanceDeeplyCourseProgress(conversationId, header.section);
    if (lastAgent.runId !== undefined) {
      lastAdvancedRunIdRef.current = lastAgent.runId;
    }
  }, [messages, conversationId, totalSections]);

  // 好奇点快捷回复:每当 last agent settled message 是一条主线讲解
  // (有 `## 第N节:标题` 首行)时,后台调一次轻量 inferOnce 生成 chips。
  //
  // inflight 用 ref 跟踪,不要依赖 quickRepliesByRunId state — 否则
  // setState 会让 effect 重跑,cleanup 提前 cancelled,异步结果永远写不回去。
  // ref 跨 re-render 稳定,inferOnce 自然完成时直接 set state 即可。
  const [quickRepliesByRunId, setQuickRepliesByRunId] = useState<Record<string, QuickRepliesEntry>>({});
  const quickRepliesInflightRef = useRef<Set<string>>(new Set());

  // 把 messages / record / outline / state 都挂到 ref 上,watchdog 内
  // 直接读 ref.current,避免把 ref deps 全塞进 watchdog useEffect 触发
  // 频繁 timer reset。
  const quickRepliesStateRef = useRef<Record<string, QuickRepliesEntry>>({});
  const messagesRef = useRef(messages);
  const recordRef = useRef(record);
  const outlineRef = useRef(outline);
  useEffect(() => {
    quickRepliesStateRef.current = quickRepliesByRunId;
  }, [quickRepliesByRunId]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    recordRef.current = record;
  }, [record]);
  useEffect(() => {
    outlineRef.current = outline;
  }, [outline]);

  /**
   * 真正发起一次 quick replies 推理。
   *
   * - 不做 inflight 检查 —— 调用方决定要不要重发(watchdog 需要 bypass)。
   * - 每次推进 generation,异步 resolve 时校验:不是当前 generation 的
   *   旧 promise 结果直接丢弃,避免覆盖更新的 loading / ready 状态。
   * - inflight Set 在 generation 写入时同步刷新,确保主 useEffect 的 dedup
   *   仍然有效。
   */
  const fireQuickReplies = useCallback((lastAgent: ChatMessage) => {
    const runId = lastAgent.runId;
    if (runId === undefined) return;
    const cached = quickRepliesCache.get(runId);
    if (cached !== undefined) {
      setQuickRepliesByRunId((prev) => ({
        ...prev,
        [runId]: cached
      }));
      return;
    }
    const currentRecord = recordRef.current;
    const currentOutline = outlineRef.current;
    if (currentRecord === null || currentOutline === null) return;
    const header = parseCourseSectionHeader(lastAgent.text);
    if (header === null) return;
    const sectionMeta = currentOutline.sections.find((s) => s.index === header.section);
    const sectionTitle = sectionMeta?.title ?? header.title;

    const previousGeneration = quickRepliesStateRef.current[runId]?.generation ?? 0;
    const generation = previousGeneration + 1;

    quickRepliesInflightRef.current.add(runId);
    setQuickRepliesByRunId((prev) => ({
      ...prev,
      [runId]: { runId, status: "loading", startedAt: Date.now(), generation }
    }));
    void (async () => {
      const result = await inferCourseQuickReplies({
        courseTitle: currentRecord.title,
        section: header.section,
        sectionTitle,
        lastAgentText: lastAgent.text
      });
      const nextEntry: QuickRepliesEntry = result.ok
        ? { runId, status: "ready", chips: result.chips, generation }
        : { runId, status: "error", generation };
      if (result.ok) {
        quickRepliesCache.set(runId, nextEntry);
      } else if (typeof __DEV__ === "undefined" || __DEV__ === true) {
        console.warn("[deeply-course] quick replies failed", result.error);
      }
      setQuickRepliesByRunId((prev) => {
        const current = prev[runId];
        // generation 对不上 → 是被 watchdog 抢先重发后,旧那次的 promise
        // 终于 resolve 了。丢弃,不要覆盖新 entry。
        if (current === undefined || current.generation !== generation) return prev;
        return {
          ...prev,
          [runId]: nextEntry
        };
      });
      quickRepliesInflightRef.current.delete(runId);
    })();
  }, []);

  useEffect(() => {
    if (!isRouteFocused) return;
    if (conversationId === null) return;
    if (record === null || outline === null) return;
    const lastAgent = findLastSettledAgentMessage(messages);
    if (lastAgent === null) return;
    const runId = lastAgent.runId;
    if (runId === undefined) return;
    const existing = quickRepliesStateRef.current[runId] ?? quickRepliesCache.get(runId);
    if (existing !== undefined) {
      if (quickRepliesStateRef.current[runId] === undefined) {
        setQuickRepliesByRunId((prev) => ({
          ...prev,
          [runId]: existing
        }));
      }
      return;
    }
    if (quickRepliesInflightRef.current.has(runId)) return;
    fireQuickReplies(lastAgent);
  }, [messages, conversationId, record, outline, fireQuickReplies, isRouteFocused]);

  /**
   * Watchdog:每 3 秒扫一次 quickRepliesByRunId,如果有 loading entry 的
   * startedAt 已经超过 stale 阈值,认为底层 inferOnce 卡死(典型场景:
   * 用户切到别的 mini-app,gateway transport 被重连,inflight 的 promise
   * 永远不 resolve),释放 inflight 标记并强制重发一次。
   *
   * 边界:如果当前 lastAgent 的 runId 已经不是 stuck 那个(例如用户跳到
   * 别的章节,新 turn 已经覆盖),直接 drop 旧 entry,不重发。
   */
  useEffect(() => {
    if (!isRouteFocused) return;
    const interval = setInterval(() => {
      const state = quickRepliesStateRef.current;
      const now = Date.now();
      let stuckRunId: string | null = null;
      for (const [runId, entry] of Object.entries(state)) {
        if (entry.status !== "loading") continue;
        if (entry.startedAt === undefined) continue;
        if (now - entry.startedAt < QUICK_REPLIES_STALE_MS) continue;
        stuckRunId = runId;
        break;
      }
      if (stuckRunId === null) return;

      const lastAgent = findLastSettledAgentMessage(messagesRef.current);
      quickRepliesInflightRef.current.delete(stuckRunId);

      if (lastAgent === null || lastAgent.runId !== stuckRunId) {
        // 旧 runId 不再相关(用户跳了章节 / 进了新 turn),清掉就行,
        // 当前的 lastAgent 会被主 useEffect 在下个 tick 自然处理。
        setQuickRepliesByRunId((prev) => {
          if (prev[stuckRunId!] === undefined) return prev;
          const next = { ...prev };
          delete next[stuckRunId!];
          return next;
        });
        return;
      }

      console.warn(
        `[deeply-course] quick replies stuck for >${QUICK_REPLIES_STALE_MS}ms, retrying`,
        { runId: stuckRunId }
      );
      fireQuickReplies(lastAgent);
    }, QUICK_REPLIES_WATCHDOG_TICK_MS);
    return () => clearInterval(interval);
  }, [fireQuickReplies, isRouteFocused]);

  // 渲染:当前的 quick replies 取最后一条 settled agent 主线消息对应的 runId。
  const currentQuickReplies = useMemo(() => {
    const lastAgent = findLastSettledAgentMessage(messages);
    if (lastAgent === null) return null;
    if (lastAgent.runId === undefined) return null;
    if (parseCourseSectionHeader(lastAgent.text) === null) return null;
    return quickRepliesByRunId[lastAgent.runId] ?? quickRepliesCache.get(lastAgent.runId) ?? null;
  }, [messages, quickRepliesByRunId]);

  // 消息流跟随:只在"用户当前贴底"时才跟,跟 standard chat 一致。
  //
  // 之前是 `[messages.length]` —— 只在新消息来时 trigger,streaming 期间
  // 文字一段段加进来不会跟。改成 `[messages]` 让 streaming 期间也持续
  // 贴底跟字往下飞;但只要 isNearBottomRef 不在底部就完全不强制 scroll,
  // 用户往上翻看旧内容时不会被拽下来。
  //
  // 切走又切回的首屏,pendingScrollRestoreRef 还在 → tryRestoreSavedScroll
  // 接管,这里直接 early return,避免跟恢复逻辑打架。
  useEffect(() => {
    if (messages.length === 0) return;
    if (pendingScrollRestoreRef.current !== null && !hasRestoredScrollRef.current) return;
    if (!isNearBottomRef.current) return;
    const t = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: false });
    }, 16);
    return () => clearTimeout(t);
  }, [messages]);

  const isConnected = status === "connected";
  const isLoadingBootstrap = bootstrapStatus === "loading";
  // agent 还在流式 → 锁住所有"会发新 user message 的入口"。这条 busy
  // 不止 DeeplyCourseScreen 本身用,CourseOutlineDrawer 的目录跳转
  // 也要同一把锁,否则连点两下目录就会并发两个 mainline turn。
  const isAgentBusy = isDeeplyCourseBusy(messages);
  const bootstrapError = conversation?.bootstrap?.status === "error"
    ? conversation.bootstrap.error ?? "课程加载失败"
    : null;
  const inputLocked =
    !isConnected || sending || isAgentBusy || isLoadingBootstrap || bootstrapError !== null;
  const canSend = !inputLocked && draft.trim().length > 0;
  const canContinue = !inputLocked && expectedNextSection > 0 && expectedNextSection <= totalSections;

  const dispatch = useCallback(async (
    text: string,
    options?: { bootstrapKickoff?: boolean }
  ) => {
    if (conversationId === null) return;
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    setSending(true);
    try {
      await sendUserMessage(conversationId, trimmed);
    } catch (error) {
      console.error("[deeply-course] send failed", error);
      if (options?.bootstrapKickoff === true) {
        useConversationStore.getState().setBootstrap(conversationId, {
          status: "error",
          error: `课程准备请求发送失败:${error instanceof Error ? error.message : String(error)}`
        });
      }
    } finally {
      setSending(false);
    }
  }, [conversationId, sendUserMessage]);

  // Research / material / book kickoff:这三类 course conversation 刚创建时
  // messages 为空,自动 fire 第一条 user message 给 mainline session 触发 agent 准备。
  // 用 ref guard 防止 StrictMode 双跑 / messages 短暂回退到 0 / re-render
  // 导致重复 dispatch 同一条 kickoff。
  const researchKickoffFiredRef = useRef(false);
  useEffect(() => {
    if (record === null) return;
    if (
      record.kind !== "research" &&
      record.kind !== "material" &&
      record.kind !== "book" &&
      record.kind !== "library"
    ) {
      return;
    }
    if (conversationId === null) return;
    if (!isConnected) return;
    if (messages.length > 0) return;
    if (researchKickoffFiredRef.current) return;

    const kickoffText = buildBootstrapKickoffVisibleText(record);
    if (kickoffText === null) return;
    researchKickoffFiredRef.current = true;
    void dispatch(kickoffText, { bootstrapKickoff: true });
  }, [record, conversationId, isConnected, messages.length, dispatch]);

  const archiveConversation = useConversationStore((s) => s.archive);
  const handleArchive = useCallback(() => {
    if (conversationId === null) return;
    archiveConversation(conversationId);
  }, [archiveConversation, conversationId]);

  const handleRetryBootstrap = useCallback(() => {
    if (conversationId === null || record === null) return;
    if (record.kind !== "research" && record.kind !== "material" && record.kind !== "book" && record.kind !== "library") {
      retryDeeplyCourseOutline(conversationId);
      return;
    }
    const kickoffText = buildBootstrapKickoffVisibleText(record);
    if (kickoffText === null) return;
    useConversationStore.getState().setMessages(conversationId, () => []);
    useConversationStore.getState().setBootstrap(conversationId, {
      status: "loading",
      hint: retryBootstrapHint(record)
    });
    researchKickoffFiredRef.current = false;
    if (!isConnected) return;
    researchKickoffFiredRef.current = true;
    void dispatch(kickoffText, { bootstrapKickoff: true });
  }, [conversationId, dispatch, isConnected, record]);

  // Sanity check:从 storage 里读到的 sessionKey 跟当前 mode 默认 agent 不一致
  // 时,Gateway 会报 "agent xxx no longer exists" — 通常是 dev 阶段我们改过
  // mode 默认 agent 后,之前持久化的会话留下的尾巴。展示一个一键归档按钮
  // 让用户能快速清理,不必去开发者工具里手动删 storage。
  const sessionKey = conversation?.sessionKey ?? "";
  const isStaleSessionKey =
    sessionKey.length > 0 && !sessionKey.startsWith("agent:deeply:");

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    const text = draft;
    setDraft("");
    await dispatch(text);
  }, [canSend, draft, dispatch]);

  const handleContinue = useCallback(async () => {
    if (!canContinue) return;
    await dispatch(buildContinueSectionUserText(expectedNextSection));
  }, [canContinue, dispatch, expectedNextSection]);

  // Dev auto-trigger:agent 用 osascript 改 URL query 触发 mainline 讲解。
  // 检测到 `?koko_auto_section=N` → 等 isConnected + bootstrap ready,
  // 自动 dispatch "继续讲解第 N 节",一次性。
  //
  // 关键:expectedNextSection 是 advance progress 之后才更新,如果 query 写
  // section=3 但 progress 在 currentSection=1,expectedNextSection=2,不 match。
  // 改成"target 任意,只要 target >= 1 && target <= totalSections 就 fire",
  // 不强求 strict next。
  //
  // 用 module-level Set 持久化已 fire 的 conversationId+section 组合,跨
  // mount 不再重 fire(useRef 在 React 18 strict mode 会重置)。
  useEffect(() => {
    // Hermes 在 iOS 上也有 window 全局(空对象),`typeof window === "undefined"`
    // 拦不住,会在真机 mount 时直接抛 "Cannot read property 'search' of undefined"。
    // 这个 effect 全是 web-only dev backdoor,直接按平台拒绝。
    if (Platform.OS !== "web") return;
    if (typeof window === "undefined" || window.location === undefined) return;
    if (conversationId === null) return;
    if (!isConnected) return;
    if (isLoadingBootstrap) return;
    if (bootstrapError !== null) return;
    if (totalSections <= 0) return;
    const params = new URLSearchParams(window.location.search);
    const sectionRaw = params.get("koko_auto_section");
    if (sectionRaw === null) return;
    const target = Number(sectionRaw);
    if (!Number.isFinite(target) || target <= 0) return;
    if (target > totalSections) return;
    const fireKey = `${conversationId}:${target}`;
    if (autoSectionFired.has(fireKey)) return;
    autoSectionFired.add(fireKey);
    params.delete("koko_auto_section");
    const qs = params.toString();
    history.replaceState(
      null,
      "",
      `${window.location.pathname}${qs.length > 0 ? `?${qs}` : ""}`
    );
    console.info("[koko-debug] auto-firing section", target);
    void dispatch(buildContinueSectionUserText(target));
  }, [conversationId, isConnected, isLoadingBootstrap, bootstrapError, totalSections, dispatch]);

  const handleQuickReply = useCallback(async (chip: DeeplyQuickReplyChip) => {
    if (inputLocked) return;
    await dispatch(chip.sendText);
  }, [dispatch, inputLocked]);

  if (conversationId === null || conversation === null || record === null) {
    return <NotFoundState />;
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={headerHeight}
    >
      <CourseSubHeader
        record={record}
        progress={progress.currentSection}
        total={totalSections}
      />

      {isStaleSessionKey ? (
        <View style={[styles.banner, styles.bannerError]}>
          <View style={styles.bannerTextWrap}>
            <Text style={styles.bannerErrorTitle}>这门课的配置已过期</Text>
            <Text style={styles.bannerErrorBody}>
              它创建得早,绑的是已经不存在的 OpenClaw agent。点下面归档,然后回 Deeply
              探索从推荐卡再开一次新课。
            </Text>
          </View>
          <Pressable
            onPress={handleArchive}
            accessibilityRole="button"
            accessibilityLabel="归档并重开"
            style={({ pressed }) => [
              styles.bannerActionButton,
              styles.bannerActionButtonPrimary,
              pressed && styles.bannerActionButtonPrimaryPressed
            ]}
          >
            <Text style={styles.bannerActionButtonText}>归档</Text>
          </Pressable>
        </View>
      ) : isLoadingBootstrap ? (
        <View style={styles.banner}>
          <ActivityIndicator size="small" color={DEEPLY_INK_MUTED} />
          <View style={styles.bannerTextWrap}>
            <Text style={styles.bannerTitle}>
              {record.kind === "research"
                ? "正在为你做深度调研…"
                : record.kind === "book" || record.kind === "library"
                  ? "正在为你精读这本书…"
                  : "正在为你定课程目录…"}
            </Text>
            <Text style={styles.bannerHint}>
              {conversation.bootstrap?.hint ??
                (record.kind === "research"
                  ? "agent 正在搜资料、读资料、做综合,完成后我们就可以开始讲了。"
                  : record.kind === "book" || record.kind === "library"
                    ? "agent 在找这本书的章节解读 + 权威书评,通常 1-3 分钟。"
                    : "agent 正在按你刚选的节数生成目录,通常 30-90 秒。")}
            </Text>
          </View>
        </View>
      ) : bootstrapError !== null ? (
        <View style={[styles.banner, styles.bannerError]}>
          <View style={styles.bannerTextWrap}>
            <Text style={styles.bannerErrorTitle}>课程目录生成失败</Text>
            <Text style={styles.bannerErrorBody}>{bootstrapError}</Text>
          </View>
          <View style={styles.bannerActionsCol}>
            <Pressable
              onPress={handleRetryBootstrap}
              accessibilityRole="button"
              accessibilityLabel="重试生成目录"
              style={({ pressed }) => [
                styles.bannerActionButton,
                styles.bannerActionButtonPrimary,
                pressed && styles.bannerActionButtonPrimaryPressed
              ]}
            >
              <Text style={styles.bannerActionButtonText}>重试</Text>
            </Pressable>
            <Pressable
              onPress={handleArchive}
              accessibilityRole="button"
              accessibilityLabel="归档"
              style={({ pressed }) => [
                styles.bannerActionButton,
                styles.bannerActionButtonGhost,
                pressed && styles.bannerActionButtonGhostPressed
              ]}
            >
              <Text style={styles.bannerActionButtonGhostText}>归档</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={(info) => renderMessage(info, conversation, record)}
        ListHeaderComponent={messages.length === 0 ? <EmptyState record={record} /> : null}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        onLayout={(event) => handleListLayout(event.nativeEvent.layout.height)}
        onScroll={handleListScroll}
        scrollEventThrottle={16}
        onContentSizeChange={(_width, height) => handleContentSizeChange(height)}
      />

      <View style={styles.inputDock}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRowContent}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="继续讲解下一节"
            disabled={!canContinue}
            onPress={() => void handleContinue()}
            style={({ pressed }) => [
              styles.continueChip,
              !canContinue && styles.continueChipDisabled,
              pressed && canContinue && styles.continueChipPressed
            ]}
          >
            <Text numberOfLines={1} style={styles.continueChipText}>
              {progress.currentSection === 0
                ? `开始第 1 节${nextSectionTitle ? ` · ${nextSectionTitle}` : ""}`
                : expectedNextSection > totalSections
                  ? "已学完所有节"
                  : `第 ${expectedNextSection} 节${nextSectionTitle ? ` · ${nextSectionTitle}` : ""}`}
            </Text>
          </Pressable>

          {currentQuickReplies?.status === "loading" ? (
            <View style={styles.quickReplyLoading}>
              <ActivityIndicator size="small" color={DEEPLY_INK_MUTED} />
              <Text style={styles.quickReplyLoadingText}>挑几个好奇点…</Text>
            </View>
          ) : null}

          {currentQuickReplies?.status === "ready" && currentQuickReplies.chips !== undefined
            ? currentQuickReplies.chips.map((chip, idx) => (
                <Pressable
                  key={`${chip.label}:${idx}`}
                  accessibilityRole="button"
                  accessibilityLabel={chip.sendText}
                  disabled={inputLocked}
                  onPress={() => void handleQuickReply(chip)}
                  style={({ pressed }) => [
                    styles.quickReplyChip,
                    inputLocked && styles.quickReplyChipDisabled,
                    pressed && !inputLocked && styles.quickReplyChipPressed
                  ]}
                >
                  <Text numberOfLines={1} style={styles.quickReplyChipLabel}>
                    {chip.label}
                  </Text>
                  <Text numberOfLines={1} style={styles.quickReplyChipContent}>
                    {chip.sendText}
                  </Text>
                </Pressable>
              ))
            : null}
        </ScrollView>
        <View style={styles.inputPanel}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={
              isLoadingBootstrap
                ? record.kind === "research"
                  ? "调研中,稍等…"
                  : record.kind === "book" || record.kind === "library"
                    ? "精读准备中,稍等…"
                    : "课程目录生成中,稍等…"
                : bootstrapError !== null
                  ? "课程目录生成失败,请关闭重新进入"
                  : isConnected
                    ? "在这节里问点什么…"
                    : "正在连接 OpenClaw,稍等一下…"
            }
            placeholderTextColor={DEEPLY_INK_MUTED}
            editable={!inputLocked}
            multiline
            style={styles.input}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="发送"
            disabled={!canSend}
            onPress={() => void handleSend()}
            style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.sendButtonText}>↑</Text>
            )}
          </Pressable>
        </View>
      </View>

      {/* 课程目录抽屉:右上角按钮(在 host route headerRight 里)调 open,
          这里 mount 监听 store 在 demo frame 内渲染。 */}
      <DeeplyCourseOutlineDrawerMount />
    </KeyboardAvoidingView>
  );
}

/**
 * Screen 自家的一行小字 sub-header:进度 + 课程副标题。
 * 课程标题已经在 host stack header 里,这里不再重复。
 */
function CourseSubHeader({
  record,
  progress,
  total
}: {
  record: DeeplyCourseSessionRecord;
  progress: number;
  total: number;
}): React.ReactElement | null {
  const segments: string[] = [];
  if (total > 0) {
    segments.push(`${progress}/${total} 节`);
  }
  if (record.subtitle.length > 0) {
    segments.push(record.subtitle);
  }
  if (segments.length === 0) return null;
  return (
    <View style={styles.subHeader}>
      <Text style={styles.subHeaderText} numberOfLines={1}>
        {segments.join(" · ")}
      </Text>
    </View>
  );
}

function EmptyState({ record }: { record: DeeplyCourseSessionRecord }): React.ReactElement {
  // 课程标题 / 副标题已经分别在 host stack header 和 sub-header 里露过了,
  // 这里只放介绍正文,让用户进来第一眼看到的就是"这门课讲什么"。
  // 「开始第 1 节」/「在这节里问点什么」的 CTA 提示完全交给底部 chip + 输入框,
  // 不在 empty state 里啰嗦,避免双重提示。
  return (
    <ScrollView
      style={styles.empty}
      contentContainerStyle={styles.emptyContent}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.emptyIntro}>{record.introduction}</Text>
    </ScrollView>
  );
}

function NotFoundState(): React.ReactElement {
  return (
    <View style={styles.notFound}>
      <Text style={styles.notFoundTitle}>找不到这节课</Text>
      <Text style={styles.notFoundHint}>
        本地 storage 可能被清掉了。回到 Deeply 知识探索,从推荐卡重新进入即可。
      </Text>
    </View>
  );
}

function renderMessage(
  info: ListRenderItemInfo<ChatMessage>,
  conversation: ConversationMeta,
  _record: DeeplyCourseSessionRecord
): React.ReactElement {
  const { item } = info;
  if (item.role === "user") {
    return (
      <View style={styles.userRow}>
        <View style={styles.userBubble}>
          <Text style={styles.userText}>{item.text}</Text>
        </View>
      </View>
    );
  }
  // Block-only message(text 空 + 有 blocks):比如 book candidates 卡片,
  // transformer 把每张候选拆成一条只带 blocks 的 message。要走 block render
  // path 而不是 MarkdownText(否则界面上完全什么也看不到)。
  const hasBlocks = item.blocks !== undefined && item.blocks.length > 0;
  const isBlockOnly = hasBlocks && item.text.length === 0 && item.streaming !== true;

  return (
    <View style={styles.agentRow} key={`${conversation.id}-${item.id}`}>
      {item.error !== undefined ? (
        <Text style={styles.errorText}>⚠️ {item.error}</Text>
      ) : isBlockOnly ? (
        <View style={styles.agentBlocksColumn}>
          {item.blocks!.map((block, i) => (
            <MessageBlockView
              key={`${block.type}:${block.version}:${i}`}
              block={block}
              conversation={conversation}
            />
          ))}
        </View>
      ) : item.text.length === 0 && item.streaming === true ? (
        // streaming 已经开始但第一段文字还没到 —— 显示思考呼吸动画,
        // 比起一个孤零零的闪烁 cursor 更能传达"agent 在准备开口"。
        // 文字一旦开始流就会切到下面的 MarkdownText + BlinkingCursor 分支。
        <DeeplyPulse />
      ) : (
        <View style={styles.agentBlocksColumn}>
          <MarkdownText
            text={item.text}
            color={DEEPLY_INK}
            // 课程讲解整体放大一号:正文 16 → 17.6,行高 26 → 28.6,
            // heading 同比例。Deeply 是"沉下心看长文"的场景,
            // 比 explore chat 那种短回复需要更大的字。
            scale={1.1}
            trailing={item.streaming === true ? <BlinkingCursor /> : undefined}
          />
          {hasBlocks
            ? item.blocks!.map((block, i) => (
                <MessageBlockView
                  key={`${block.type}:${block.version}:${i}`}
                  block={block}
                  conversation={conversation}
                />
              ))
            : null}
        </View>
      )}
    </View>
  );
}

/**
 * "下一节"的目标 N:
 * - currentSection == 0 → 第 1 节
 * - currentSection >= total → 越界(已学完)
 * - 否则 → currentSection + 1
 */
function computeNextSection(progress: { currentSection: number; totalSections: number }): number {
  if (progress.currentSection <= 0) return 1;
  return progress.currentSection + 1;
}

function findLastSettledAgentMessage(messages: ChatMessage[]): ChatMessage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.role !== "agent") continue;
    if (m.streaming === true) return null;
    if (m.text.length === 0) return null;
    return m;
  }
  return null;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: DEEPLY_BG
  },
  subHeader: {
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: DEEPLY_HAIRLINE
  },
  subHeaderText: {
    color: DEEPLY_INK_MUTED,
    fontSize: 12,
    fontWeight: "500",
    letterSpacing: 0.2
  },
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    margin: 16,
    padding: 14,
    backgroundColor: DEEPLY_PANEL,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: DEEPLY_PANEL_BORDER
  },
  bannerTextWrap: {
    flex: 1
  },
  bannerTitle: {
    color: DEEPLY_INK,
    fontSize: 13,
    fontWeight: "700"
  },
  bannerHint: {
    marginTop: 4,
    color: DEEPLY_INK_SECONDARY,
    fontSize: 12,
    lineHeight: 20
  },
  bannerError: {
    backgroundColor: "#FFE8DA",
    borderColor: "rgba(201,70,12,0.25)"
  },
  bannerErrorTitle: {
    color: "#7A2A05",
    fontSize: 13,
    fontWeight: "700"
  },
  bannerErrorBody: {
    color: "#7A2A05",
    fontSize: 12,
    lineHeight: 20,
    flex: 1
  },
  bannerActionsCol: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: 6
  },
  bannerActionButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center"
  },
  bannerActionButtonPrimary: {
    backgroundColor: "#7A2A05"
  },
  bannerActionButtonPrimaryPressed: {
    backgroundColor: "#5A1F03"
  },
  bannerActionButtonGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "rgba(122,42,5,0.3)"
  },
  bannerActionButtonGhostPressed: {
    backgroundColor: "rgba(122,42,5,0.08)"
  },
  bannerActionButtonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700"
  },
  bannerActionButtonGhostText: {
    color: "#7A2A05",
    fontSize: 12,
    fontWeight: "700"
  },
  listContent: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 18,
    flexGrow: 1
  },
  empty: {
    flex: 1
  },
  emptyContent: {
    paddingHorizontal: 4,
    paddingTop: 4,
    paddingBottom: 24
  },
  emptyIntro: {
    color: DEEPLY_INK_SECONDARY,
    fontSize: 15,
    lineHeight: 26
  },
  agentRow: {
    alignSelf: "stretch",
    marginTop: 18
  },
  agentBlocksColumn: {
    gap: 0
  },
  userRow: {
    alignSelf: "flex-end",
    maxWidth: "80%",
    marginTop: 16
  },
  userBubble: {
    paddingHorizontal: 16,
    paddingTop: 9,
    paddingBottom: 11,
    borderRadius: 22,
    backgroundColor: DEEPLY_INK,
    flexShrink: 1
  },
  userText: {
    color: "#FFFFFF",
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "500"
  },
  errorText: {
    color: "#C9460C",
    fontSize: 14,
    lineHeight: 20
  },
  inputDock: {
    borderTopWidth: 0.5,
    borderTopColor: DEEPLY_HAIRLINE,
    backgroundColor: DEEPLY_BG,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 8
  },
  chipRowContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 2,
    paddingVertical: 2
  },
  continueChip: {
    maxWidth: 300,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: DEEPLY_CONTINUE_BG
  },
  quickReplyChip: {
    maxWidth: 280,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "rgba(17,17,17,0.06)"
  },
  quickReplyChipDisabled: {
    opacity: 0.4
  },
  quickReplyChipPressed: {
    backgroundColor: "rgba(17,17,17,0.14)"
  },
  quickReplyChipLabel: {
    color: DEEPLY_INK,
    fontSize: 13,
    fontWeight: "700",
    flexShrink: 0
  },
  quickReplyChipContent: {
    color: DEEPLY_INK_MUTED,
    fontSize: 13,
    fontWeight: "500",
    flexShrink: 1
  },
  quickReplyLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  quickReplyLoadingText: {
    color: DEEPLY_INK_MUTED,
    fontSize: 12
  },
  continueChipDisabled: {
    backgroundColor: "rgba(17,17,17,0.18)"
  },
  continueChipPressed: {
    backgroundColor: "#000000"
  },
  continueChipText: {
    color: DEEPLY_CONTINUE_TEXT,
    fontSize: 13,
    fontWeight: "700"
  },
  inputPanel: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    backgroundColor: DEEPLY_PANEL,
    borderColor: DEEPLY_PANEL_BORDER,
    borderWidth: 1,
    borderRadius: 22,
    paddingLeft: 8,
    paddingRight: 6,
    paddingVertical: 6
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 140,
    paddingHorizontal: 8,
    paddingTop: 10,
    paddingBottom: 10,
    color: DEEPLY_INK,
    fontSize: 16,
    lineHeight: 22
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 999,
    backgroundColor: DEEPLY_INK,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-end"
  },
  sendButtonDisabled: {
    backgroundColor: "rgba(17,17,17,0.18)"
  },
  sendButtonText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 18
  },
  notFound: {
    flex: 1,
    backgroundColor: DEEPLY_BG,
    padding: 24,
    gap: 8,
    justifyContent: "center",
    alignItems: "center"
  },
  notFoundTitle: {
    color: DEEPLY_INK,
    fontSize: 17,
    fontWeight: "700"
  },
  notFoundHint: {
    color: DEEPLY_INK_SECONDARY,
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center"
  }
});
