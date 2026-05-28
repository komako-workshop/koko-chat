import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
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
import { useAndroidKeyboardSpacerHeight } from "@/components/useAndroidKeyboardSpacerHeight";
import { MessageBlockView } from "@/runtime/messageBlocks";
import { openPairingScreen } from "@/runtime/navigation";
import { useGatewayStore } from "@/state/gateway";
import {
  useConversationStore,
  type ChatMessage,
  type ConversationMeta
} from "@/state/conversations";

import { deeplyAvatarChatBuddy } from "./avatars";
import { BlinkingCursor, DeeplyPulse } from "./DeeplyPulse";
import { DEEPLY_MINI_APP_ID } from "./constants";
import {
  startDeeplyMaterialCourse,
  startDeeplyResearchCourse
} from "./courseSession";
import { DeeplyCourseSheetMount } from "./CourseDetailSheet";
import { useDeeplyCourseSheetState } from "./courseSheetStore";
import { DeeplyCustomizeSheetMount } from "./CourseCustomizeSheet";
import { openDeeplyCustomizeSheet } from "./customizeSheetStore";

/**
 * CourseDetailSheet 的 maxHeight(见 CourseDetailSheet.tsx,目前 88%)。
 * Explore 用这个常量算出 sheet 顶部在屏幕上的 y,把被点击的卡 scroll 到
 * sheet 上方时用得上。保守按 maxHeight 算(即使 sheet 实际更矮也只会让卡
 * 多露一截,不会被遮)。
 */
const COURSE_SHEET_MAX_HEIGHT_RATIO = 0.88;
/** 卡底与 sheet 顶之间留出来的可呼吸距离(pt)。 */
const COURSE_SHEET_REVEAL_GAP = 16;

/**
 * Deeply 知识探索 chat surface。
 *
 * 这是 Deeply mini-app 自己拥有的聊天屏,不复用 host 的共享 chat 页。
 * 它仍然依附 conversation store + outbound builder + gateway 这些共享原语,
 * 只是 UI / 输入区 / 推荐课程按钮等产品形态完全由 mini-app 决定。
 *
 * 视觉哲学(对齐 deeply.plus 原版):
 *  - 暖纸张白底,黑灰文字。
 *  - AI 不戴气泡、不戴头像,纯 markdown 平铺,像在读一篇短信。
 *  - 用户消息是右对齐的深色胶囊气泡,黑底白字。
 *  - 输入栏是浅灰胶囊容器,内嵌「推荐课程」chip + 多行输入 + 圆形发送钮。
 *
 * 行为:
 *  - mount 时找 mode === "deeply" 的单例会话,没有就创建一个。
 *  - 普通发送走 outbound builder 注入持续 reminder。
 *  - 推荐课程按钮 = 发送一句固定的"推荐"意图文本,由 outbound builder
 *    在 gatewayText 里替换成专用推荐 prompt。
 */

const DEEPLY_BG = "#F9F9F7";
const DEEPLY_INK = "#111111";
const DEEPLY_INK_MUTED = "#6B6B66";
const DEEPLY_HAIRLINE = "rgba(17,17,17,0.06)";
const DEEPLY_PANEL = "#F5F5F5";
const DEEPLY_PANEL_BORDER = "rgba(17,17,17,0.07)";
const DEEPLY_RECOMMEND_BG = "rgba(17,17,17,0.06)";
const DEEPLY_RECOMMEND_BG_PRESSED = "rgba(17,17,17,0.12)";

const EMPTY: ChatMessage[] = [];

/**
 * 滚动位置恢复:跟 host /chat/[id] + DeeplyCourseScreen 同构。
 *
 * 用 module-level Map(而非 host 那份)出于两点理由:
 *   1. deeply 是独立 package,跨 package 拉 host module state 既不干净
 *      也容易在 hot reload 之后出问题。
 *   2. NEAR_BOTTOM_THRESHOLD 允许跟 host / course 有差(explore 底部
 *      chip row + 输入框更厚,留一点缓冲更安全)。
 */
interface ExploreScrollSnapshot {
  contentHeight: number;
  viewportHeight: number;
  offsetY: number;
  isNearBottom: boolean;
}
const NEAR_BOTTOM_THRESHOLD_PX = 56;
const exploreScrollSnapshots = new Map<string, ExploreScrollSnapshot>();

export function DeeplyExploreScreen({
  conversationIdOverride = null,
  headerHeight = 0,
  isRouteFocused = true,
  focusEpoch = 0
}: {
  /**
   * When opened from the chat list, host navigation calls `openConversation`,
   * which pushes `/deeply?id=<conversationId>`. Use that stable route id
   * instead of rediscovering the singleton from store; this mirrors host
   * `/chat/[id]` and avoids a first render with `conversationId=null`.
   */
  conversationIdOverride?: string | null;
  /**
   * Stack header 高度,由 host route 壳通过 `useHeaderHeight` 拿到。
   * 用于 KeyboardAvoidingView 的 keyboardVerticalOffset —— 不传的话
   * iOS 键盘弹起会把输入框遮住。
   */
  headerHeight?: number;
  /**
   * Host route focus state. The mini-app package cannot import expo-router /
   * @react-navigation hooks directly without risking a second router copy, so
   * the route shell passes focus/blur down explicitly.
   */
  isRouteFocused?: boolean;
  /** Incremented by the host route every time `/deeply` receives focus. */
  focusEpoch?: number;
} = {}): React.ReactElement {
  const singletonConversationId = useSingletonConversation(conversationIdOverride === null);
  const conversationId = conversationIdOverride ?? singletonConversationId;
  const conversation = useConversationStore((s) =>
    s.list.find((m) => m.id === conversationId) ?? null
  );
  const messages = useConversationStore((s) =>
    conversationId === null ? EMPTY : s.messages[conversationId] ?? EMPTY
  );
  const keyboardSpacerHeight = useAndroidKeyboardSpacerHeight();
  const status = useGatewayStore((s) => s.status);
  const sendUserMessage = useGatewayStore((s) => s.sendUserMessage);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  // 滚动位置恢复:跟 host /chat/[id] + DeeplyCourseScreen 同构。切到别的
  // mini-app / 进 sheet / 后台再回来时,FlatList 重新挂载,有 snapshot
  // 就还原到当时位置;贴底过的用户继续跟随新消息,中间位置的用户停在原处。
  //
  // scrollMetricsRef.offsetY 顺带承担之前那块 sheet-reveal 逻辑里
  // scrollOffsetRef 的角色:reveal 副作用直接读它即可,不再单独维护。
  const isNearBottomRef = useRef(true);
  const scrollMetricsRef = useRef({
    contentHeight: 0,
    viewportHeight: 0,
    offsetY: 0
  });
  const pendingScrollRestoreRef = useRef<ExploreScrollSnapshot | null>(
    conversationId === null ? null : exploreScrollSnapshots.get(conversationId) ?? null
  );
  const hasRestoredScrollRef = useRef(pendingScrollRestoreRef.current === null);
  const lastConversationIdRef = useRef<string | null>(conversationId);

  // useSingletonConversation() can return null for the first render and then
  // produce the real Deeply conversation id on the next render. If we wait for
  // a useEffect to swap in that conversation's snapshot, FlatList may already
  // emit onLayout/onContentSizeChange with isNearBottom still at its default
  // `true`, which triggers an eager scrollToEnd and overwrites the saved
  // position. Do the conversation-id handoff synchronously during render so
  // the very first layout pass for the real id sees the pending snapshot.
  if (lastConversationIdRef.current !== conversationId) {
    lastConversationIdRef.current = conversationId;
    const snapshot = conversationId === null
      ? null
      : exploreScrollSnapshots.get(conversationId) ?? null;
    pendingScrollRestoreRef.current = snapshot;
    hasRestoredScrollRef.current = snapshot === null;
    if (snapshot !== null) {
      isNearBottomRef.current = snapshot.isNearBottom;
    }
  }
  if (pendingScrollRestoreRef.current !== null) {
    isNearBottomRef.current = pendingScrollRestoreRef.current.isNearBottom;
  }

  const updateNearBottom = (): void => {
    const { contentHeight, viewportHeight, offsetY } = scrollMetricsRef.current;
    // metrics 不完整时(mount 后 onLayout 先到、contentSize 还没 emit)就别
    // 改 isNearBottom。否则 mount 期 onLayout 会把 isNearBottom 强行翻成 true,
    // 紧接其后的 messages effect 又会 scrollToEnd 抢走刚 restore 的滚动位置。
    if (contentHeight <= 0 || viewportHeight <= 0) return;
    const distanceToBottom = contentHeight - (offsetY + viewportHeight);
    isNearBottomRef.current = distanceToBottom <= NEAR_BOTTOM_THRESHOLD_PX;
  };

  const saveCurrentScrollSnapshot = (): void => {
    if (conversationId === null) return;
    const snapshot = {
      ...scrollMetricsRef.current,
      offsetY: Math.max(0, scrollMetricsRef.current.offsetY),
      isNearBottom: isNearBottomRef.current
    };
    exploreScrollSnapshots.set(conversationId, snapshot);
  };

  const scrollToBottomSoon = (animated: boolean): void => {
    // Programmatic scrolls do not reliably emit `onScroll` on all RN targets.
    // If we only persist from onScroll, an auto-follow-to-bottom can leave
    // scrollMetricsRef.offsetY stuck at an older manual position, then leaving
    // the page saves that stale offset. Update the ref optimistically first.
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
  };

  const tryRestoreSavedScroll = (): boolean => {
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
    // RN/Expo Go can report partial content heights during remount. If we
    // restore too early, `snapshot.offsetY` gets clamped to the bottom of that
    // partial content, which flips `isNearBottom` to true; as more rows mount,
    // the auto-follow logic then scrolls all the way to the real bottom. Wait
    // until the current content is tall enough to actually represent the saved
    // offset before marking restore as complete.
    if (maxOffset + 1 < snapshot.offsetY) {
      return true;
    }
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
  };

  const handleListScroll = (e: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
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
  };

  const handleListLayout = (height: number): void => {
    scrollMetricsRef.current = {
      ...scrollMetricsRef.current,
      viewportHeight: height
    };
    updateNearBottom();
    tryRestoreSavedScroll();
  };

  const handleContentSizeChange = (height: number): void => {
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
  };

  // 切换 conversationId 时把待恢复的 snapshot 指向新对话(同 host /chat 的
  // 处理:同一组件实例如果跨 conversation 切,不会拿旧 snapshot 误恢复新对话)。
  //
  // 另外在 conversation mount / 切换的瞬间排几次 retry —— 单靠 onLayout +
  // onContentSizeChange 在 RN web demo frame + KeyboardAvoidingView 组合下
  // 不总是稳定:有时 contentSize 在第一次 emit 时高度还不准,scrollToOffset
  // 命中早期帧会被 FlatList 后续的内部 layout reset 掉,人就回到底了。
  // 多排几帧 retry,直到 hasRestoredScrollRef 翻成 true 或者用户开始滚动。
  useEffect(() => {
    const snapshot = conversationId === null
      ? null
      : exploreScrollSnapshots.get(conversationId) ?? null;
    pendingScrollRestoreRef.current = snapshot;
    hasRestoredScrollRef.current = snapshot === null;
    if (snapshot !== null) {
      isNearBottomRef.current = snapshot.isNearBottom;
    }
    if (snapshot === null) return;

    const RESTORE_RETRY_DELAYS_MS = [16, 80, 200, 400, 800];
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    for (const delay of RESTORE_RETRY_DELAYS_MS) {
      const t = setTimeout(() => {
        if (hasRestoredScrollRef.current) return;
        tryRestoreSavedScroll();
      }, delay);
      timers.push(t);
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [conversationId]);

  // `launcher -> Deeply` does not always unmount this component; sometimes it
  // is merely blurred and later focused again. Relying on cleanup / mount then
  // misses the exact moment the user leaves. The host route forwards focus
  // events so we can persist on blur and re-run restore on focus.
  useEffect(() => {
    if (conversationId === null) return;
    if (!isRouteFocused) {
      saveCurrentScrollSnapshot();
      return;
    }

    const snapshot = exploreScrollSnapshots.get(conversationId) ?? null;
    pendingScrollRestoreRef.current = snapshot;
    hasRestoredScrollRef.current = snapshot === null;
    if (snapshot !== null) {
      isNearBottomRef.current = snapshot.isNearBottom;
    }
    if (snapshot === null) return;

    const RESTORE_RETRY_DELAYS_MS = [0, 16, 80, 200, 400, 800];
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    for (const delay of RESTORE_RETRY_DELAYS_MS) {
      const t = setTimeout(() => {
        if (hasRestoredScrollRef.current) return;
        tryRestoreSavedScroll();
      }, delay);
      timers.push(t);
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
    // The scroll helpers intentionally read refs and current conversation
    // state. `focusEpoch` is the event token; don't re-run because function
    // identities changed during ordinary renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRouteFocused, focusEpoch, conversationId]);

  // 卸载之前再 save 一次兜底极端情况(没滑过但 contentSize 改过)。
  useEffect(() => {
    return () => {
      saveCurrentScrollSnapshot();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // 监听 CourseDetailSheet 打开事件:卡片在 onPress 时已经把自己屏幕底边的
  // y 坐标塞进 store,这里读出来 → 算出"sheet 顶部 - 20px"作为期望卡底位置
  // → list 加上 delta scroll,把卡完整推到 sheet 上方。
  //
  // 保守按 sheet maxHeight(75%) 算 sheet 顶部 —— 即便 sheet 实际更矮,
  // list 也只是多 scroll 了一点点,效果是卡片更靠上、不会被遮。
  const sheetState = useDeeplyCourseSheetState();
  const sheetIsOpen = sheetState.isOpen;
  const sheetCardBottomY = sheetState.cardBottomY;
  useEffect(() => {
    if (!sheetIsOpen) return;
    if (sheetCardBottomY === null) return;
    const winHeight = Dimensions.get("window").height;
    const sheetTopY = winHeight * (1 - COURSE_SHEET_MAX_HEIGHT_RATIO);
    const desiredCardBottomY = sheetTopY - COURSE_SHEET_REVEAL_GAP;
    const delta = sheetCardBottomY - desiredCardBottomY;
    if (delta <= 0) return;
    const nextOffset = Math.max(0, scrollMetricsRef.current.offsetY + delta);
    scrollMetricsRef.current = {
      ...scrollMetricsRef.current,
      offsetY: nextOffset
    };
    updateNearBottom();
    saveCurrentScrollSnapshot();
    listRef.current?.scrollToOffset({
      offset: nextOffset,
      animated: true
    });
  }, [sheetIsOpen, sheetCardBottomY]);

  const isConnected = status === "connected";
  const canSend = isConnected && !sending && draft.trim().length > 0;
  // 打开「定制课程」sheet 本身不依赖 sending —— sheet 是独立的 UI 操作,
  // 用户在等回复时也应该能起一个新的 research course。只在没连上 gateway
  // 时禁(sheet 里"开始调研"也跑不动)。
  const canOpenCustomize = isConnected;

  // 新消息到达:仅在用户当前就贴底时跟随到底(跟 host /chat 同款行为)。
  // 这避免了用户向上翻看老消息时被新消息"抢回"到最底,也保证 onContentSizeChange
  // 还没触发的极端情况下也能滚到位。
  useEffect(() => {
    if (messages.length === 0) return;
    if (pendingScrollRestoreRef.current !== null && !hasRestoredScrollRef.current) return;
    if (!isNearBottomRef.current) return;
    const t = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 16);
    return () => clearTimeout(t);
  }, [messages.length]);

  // Dev auto-trigger:agent 用 osascript 改 URL hash 触发 kickoff 用。
  // 支持:
  //   - `koko_run_research_topic`
  //   - `koko_run_material_url`
  // 等 gateway connected 后自动 start course → 清 query param。
  // 只在 web + 已连接时跑,一次性,刷掉 query 后不会再触发。
  //
  // 守卫必须用 Platform.OS === "web":Hermes 在 iOS 上也定义了 window 全局
  // (空对象),`typeof window === "undefined"` 不够,会在真机 mount 时直接抛
  // "Cannot read property 'search' of undefined"。
  const autoRunFiredRef = useRef(false);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (typeof window === "undefined" || window.location === undefined) return;
    if (autoRunFiredRef.current) return;
    if (!isConnected) return;
    if (conversationId === null) return;
    const params = new URLSearchParams(window.location.search);
    const topic = params.get("koko_run_research_topic");
    const sectionsRaw = params.get("koko_run_research_sections");
    if (topic !== null && topic.length > 0) {
      const sections = Number(sectionsRaw);
      if (!Number.isFinite(sections) || sections <= 0) return;
      autoRunFiredRef.current = true;
      params.delete("koko_run_research_topic");
      params.delete("koko_run_research_sections");
      const qs = params.toString();
      history.replaceState(
        null,
        "",
        `${window.location.pathname}${qs.length > 0 ? `?${qs}` : ""}`
      );
      void startDeeplyResearchCourse({
        topic,
        sections,
        sectionPreset: "standard",
        parentConversationId: conversationId
      });
      return;
    }

    const materialUrl = params.get("koko_run_material_url");
    const materialSectionsRaw = params.get("koko_run_material_sections");
    if (materialUrl === null || materialUrl.length === 0) return;
    const sections = Number(materialSectionsRaw);
    if (!Number.isFinite(sections) || sections <= 0) return;
    autoRunFiredRef.current = true;
    params.delete("koko_run_material_url");
    params.delete("koko_run_material_sections");
    const qs = params.toString();
    history.replaceState(
      null,
      "",
      `${window.location.pathname}${qs.length > 0 ? `?${qs}` : ""}`
    );
    void startDeeplyMaterialCourse({
      label: materialUrl,
      url: materialUrl,
      sections,
      sectionPreset: "standard",
      parentConversationId: conversationId
    });
  }, [isConnected, conversationId]);

  async function dispatch(text: string): Promise<void> {
    const trimmed = text.trim();
    if (conversationId === null || trimmed.length === 0) return;
    setSending(true);
    try {
      await sendUserMessage(conversationId, trimmed);
    } catch (error) {
      console.error("[deeply] send failed", error);
    } finally {
      setSending(false);
    }
  }

  async function handleSend(): Promise<void> {
    if (!canSend) return;
    const text = draft;
    setDraft("");
    await dispatch(text);
  }

  function handleOpenCustomize(): void {
    if (!canOpenCustomize) return;
    openDeeplyCustomizeSheet(conversationId);
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? headerHeight : 0}
    >
      <ConnectionBanner
        isConnected={isConnected}
      />

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={(info) => renderMessage(info, conversation)}
        ListHeaderComponent={messages.length === 0 ? <EmptyState /> : null}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        onScroll={handleListScroll}
        scrollEventThrottle={16}
        onLayout={(event) => {
          handleListLayout(event.nativeEvent.layout.height);
        }}
        onContentSizeChange={(_width, height) => {
          handleContentSizeChange(height);
        }}
      />

      <View style={styles.inputDock}>
        {/* 行动 chip 排成一行,横滚预留扩展位(以后可能加"继续上次的课"
            "我有自己的主题"之类的入口)。视觉上跟 course screen 的 chip
            row + inputPanel 形态对齐,焦点完全留给输入框本身。 */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRowContent}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="定制课程"
            disabled={!canOpenCustomize}
            onPress={handleOpenCustomize}
            style={({ pressed }) => [
              styles.recommendButton,
              !canOpenCustomize && styles.recommendButtonDisabled,
              pressed && canOpenCustomize && styles.recommendButtonPressed
            ]}
          >
            <Text
              style={[styles.recommendText, !canOpenCustomize && styles.recommendTextDisabled]}
              numberOfLines={1}
            >
              定制课程
            </Text>
          </Pressable>
        </ScrollView>

        <View style={styles.inputPanel}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={
              isConnected
                ? "今天又在好奇些什么呢…"
                : "正在连接 OpenClaw,稍等一下…"
            }
            placeholderTextColor={DEEPLY_INK_MUTED}
            editable={isConnected && !sending}
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
      {keyboardSpacerHeight > 0 ? <View style={{ height: keyboardSpacerHeight }} /> : null}

      {/* CourseDetailSheet 由推荐卡点击触发;CourseCustomizeSheet 由
          「定制课程」chip 触发。两者都挂在 explore root 里走 absoluteFill
          overlay 而不是 RN Modal,确保 sheet 始终活在 demo frame 内。
          同一时间最多打开一个,store 是分开的、不会互锁。 */}
      <DeeplyCourseSheetMount />
      <DeeplyCustomizeSheetMount />
    </KeyboardAvoidingView>
  );
}

function useSingletonConversation(enabled = true): string | null {
  const create = useConversationStore((s) => s.create);
  const existingId = useConversationStore((s) => {
    const found = s.list.find((m) => m.mode === DEEPLY_MINI_APP_ID);
    return found?.id ?? null;
  });

  useEffect(() => {
    if (!enabled) return;
    if (existingId !== null) return;
    create({
      mode: DEEPLY_MINI_APP_ID,
      title: "Deeply 知识探索",
      sessionScope: "explore",
      listSnapshot: {
        title: "Deeply 知识探索",
        subtitle: "陪你引经据典地聊一聊"
      }
    });
  }, [enabled, existingId, create]);

  return enabled ? existingId : null;
}

function ConnectionBanner({
  isConnected
}: {
  isConnected: boolean;
}): React.ReactElement | null {
  if (isConnected) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="前往配对 OpenClaw"
      onPress={openPairingScreen}
      style={({ pressed }) => [styles.banner, pressed && styles.bannerPressed]}
    >
      <Text style={styles.bannerTitle}>未连接 OpenClaw</Text>
      <Text style={styles.bannerHint}>
        需要在 KokoChat 里完成 OpenClaw 配对,Deeply 才能开口 · 点这里去配对
      </Text>
    </Pressable>
  );
}

function EmptyState(): React.ReactElement {
  return (
    <View style={styles.emptyState}>
      <Image source={deeplyAvatarChatBuddy} style={styles.emptyAvatar} resizeMode="cover" />
      <Text style={styles.emptyTitle}>今天,你又在好奇些什么呢?</Text>
      <Text style={styles.emptyHint}>
        我是 Deeply 的知识探索助手。
        把你最近的困惑、想搞懂的话题丢过来,
        我会像博学的朋友那样陪你聊一聊。
      </Text>
    </View>
  );
}

function renderMessage(
  info: ListRenderItemInfo<ChatMessage>,
  conversation: ConversationMeta | null
): React.ReactElement {
  const { item } = info;
  if (item.role === "user") {
    return <UserBubble message={item} />;
  }
  return <AgentBubble message={item} conversation={conversation} />;
}

function UserBubble({ message }: { message: ChatMessage }): React.ReactElement {
  return (
    <View style={styles.userRow}>
      <View style={styles.userBubble}>
        <Text style={styles.userText}>{message.text}</Text>
      </View>
    </View>
  );
}

function AgentBubble({
  message,
  conversation
}: {
  message: ChatMessage;
  conversation: ConversationMeta | null;
}): React.ReactElement {
  const hasBlocks = Array.isArray(message.blocks) && message.blocks.length > 0;
  const hasText = message.text.length > 0;

  return (
    <View style={styles.agentRow}>
      {message.error !== undefined ? (
        <Text style={styles.errorText}>⚠️ {message.error}</Text>
      ) : (
        <>
          {hasText ? (
            <MarkdownText
              text={message.text}
              color={DEEPLY_INK}
              trailing={message.streaming === true && !hasBlocks ? <BlinkingCursor /> : undefined}
            />
          ) : null}
          {hasBlocks && conversation !== null ? (
            <View style={hasText ? styles.blocksAfterText : null}>
              {message.blocks!.map((block, index) => (
                <MessageBlockView
                  key={`${block.type}:${block.version}:${index}`}
                  block={block}
                  conversation={conversation}
                />
              ))}
            </View>
          ) : null}
          {!hasText && !hasBlocks && message.streaming === true ? (
            // 等 agent 开口:呼吸 halo,比静态 cursor 更明确地传达
            // "正在思考"。文字一旦出现就走上面的 MarkdownText + BlinkingCursor。
            <DeeplyPulse />
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: DEEPLY_BG
  },
  banner: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    backgroundColor: DEEPLY_PANEL,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: DEEPLY_PANEL_BORDER
  },
  bannerPressed: {
    backgroundColor: DEEPLY_RECOMMEND_BG_PRESSED
  },
  bannerTitle: {
    color: DEEPLY_INK,
    fontSize: 13,
    fontWeight: "600"
  },
  bannerHint: {
    marginTop: 2,
    color: DEEPLY_INK_MUTED,
    fontSize: 12,
    lineHeight: 18
  },
  listContent: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 24,
    flexGrow: 1
  },
  emptyState: {
    alignItems: "center",
    paddingTop: 36,
    paddingHorizontal: 18,
    gap: 14
  },
  emptyAvatar: {
    width: 76,
    height: 76,
    borderRadius: 999,
    backgroundColor: DEEPLY_PANEL
  },
  emptyTitle: {
    color: DEEPLY_INK,
    fontSize: 19,
    fontWeight: "700",
    textAlign: "center"
  },
  emptyHint: {
    color: DEEPLY_INK_MUTED,
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center"
  },
  agentRow: {
    alignSelf: "stretch",
    marginTop: 18
  },
  blocksAfterText: {
    marginTop: 4
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
  recommendButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: DEEPLY_RECOMMEND_BG
  },
  recommendButtonDisabled: {
    opacity: 0.4
  },
  recommendButtonPressed: {
    backgroundColor: DEEPLY_RECOMMEND_BG_PRESSED
  },
  recommendText: {
    color: DEEPLY_INK,
    fontSize: 13,
    fontWeight: "600"
  },
  recommendTextDisabled: {
    color: DEEPLY_INK_MUTED
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
  }
});
