import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Animated,
  Easing,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ListRenderItemInfo
} from "react-native";

import { useGatewayStore } from "@/state/gateway";
import { useConversationStore, type ChatMessage } from "@/state/conversations";

import {
  closeDeeplyCourseOutlineDrawer,
  useDeeplyCourseOutlineDrawerState
} from "./courseOutlineDrawerStore";
import { isDeeplyCourseBusy } from "./courseBusyState";
import {
  jumpDeeplyCourseToSection,
  useDeeplyCourseProgress
} from "./courseProgress";
import { loadDeeplyCourseOutline } from "./courseSession";
import type { DeeplyOutlineSection } from "./parseCourseOutline";

const EMPTY_MESSAGES: ChatMessage[] = [];

const DRAWER_BG = "#FFFFFF";
const DRAWER_INK = "#111111";
const DRAWER_INK_SECONDARY = "#1F2937";
const DRAWER_INK_MUTED = "#94A3B8";
const DRAWER_DIVIDER = "rgba(17,17,17,0.06)";
const DRAWER_BADGE_BG = "#F1F5F2";
const DRAWER_BADGE_TEXT = "#475569";
const DRAWER_BADGE_DONE_BG = "rgba(86,176,124,0.18)";
const DRAWER_BADGE_DONE_TEXT = "#1F7A4A";
const DRAWER_BADGE_CURRENT_BG = "#111111";
const DRAWER_BADGE_CURRENT_TEXT = "#FFFFFF";
const DRAWER_ROW_ACTIVE_BG = "#F4F1EA";

/**
 * 顶层桥:订阅 store,visible 时挂载真正的 drawer,close 时 unmount。
 *
 * 跟 sheet 一样,这个 mount 要被放在 DeeplyCourseScreen 的 root 里,
 * 因为我们用 absoluteFill overlay 而不是 RN Modal —— 不能让 drawer
 * 跳出 demo frame。
 */
export function DeeplyCourseOutlineDrawerMount(): React.ReactElement | null {
  const { isOpen, conversationId } = useDeeplyCourseOutlineDrawerState();
  if (!isOpen || conversationId === null) return null;
  return (
    <CourseOutlineDrawer
      conversationId={conversationId}
      onClose={closeDeeplyCourseOutlineDrawer}
    />
  );
}

function CourseOutlineDrawer({
  conversationId,
  onClose
}: {
  conversationId: string;
  onClose: () => void;
}): React.ReactElement {
  const outline = loadDeeplyCourseOutline(conversationId);
  const progress = useDeeplyCourseProgress(conversationId);
  const sendUserMessage = useGatewayStore((s) => s.sendUserMessage);
  // 跟 DeeplyCourseScreen 共用同一把"agent 正在流式" 锁:回复期间禁止
  // 目录跳转,避免连点两下并发两个 turn。
  const messages = useConversationStore((s) => s.messages[conversationId] ?? EMPTY_MESSAGES);
  const isAgentBusy = isDeeplyCourseBusy(messages);

  // Drawer 宽:按视口宽度 78%,clamp 在 [280, 360]。这样 iPhone 上左边能
  // 露出一截 chat(图 2 的半遮盖视觉),Demo Frame / iPad 上不会拉得太宽。
  // 用 useWindowDimensions 是因为它会跟着旋转 / 分屏自动 re-render。
  const { width: viewportWidth } = useWindowDimensions();
  const drawerWidth = useMemo(() => {
    const target = Math.round(viewportWidth * 0.78);
    return Math.max(280, Math.min(360, target));
  }, [viewportWidth]);

  // Slide-in 动画:0 = 完全在右侧屏幕外,1 = 完全 in place。
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start();
  }, [anim]);

  const handleClose = useCallback(() => {
    Animated.timing(anim, {
      toValue: 0,
      duration: 180,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true
    }).start(({ finished }) => {
      if (finished) onClose();
    });
  }, [anim, onClose]);

  const handleSectionPress = useCallback(
    async (item: DeeplyOutlineSection) => {
      if (isAgentBusy) return;
      jumpDeeplyCourseToSection(conversationId, item.index);
      handleClose();
      try {
        await sendUserMessage(
          conversationId,
          `请讲解第${item.index}节:${item.title}`
        );
      } catch (error) {
        console.error("[deeply-course] outline jump send failed", error);
      }
    },
    [conversationId, handleClose, isAgentBusy, sendUserMessage]
  );

  const sections = outline?.sections ?? [];
  const total = sections.length;
  const active = progress.activeSection > 0 ? progress.activeSection : progress.currentSection;
  const readSet = new Set(progress.readSections);

  const translateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [drawerWidth, 0],
    extrapolate: "clamp"
  });

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      {/* 不再用半透明 backdrop 全屏覆盖 chat;
          只在抽屉左边留一片透明的"点击关闭"热区,下面的 chat 仍然可见。 */}
      <Pressable
        accessibilityLabel="关闭目录"
        style={[StyleSheet.absoluteFillObject, { right: drawerWidth }]}
        onPress={handleClose}
      />
      <Animated.View
        style={[
          styles.panel,
          { width: drawerWidth, transform: [{ translateX }] }
        ]}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>课程目录</Text>
          <Text style={styles.headerMeta}>
            {isAgentBusy
              ? "正在回复中,讲完才能跳节"
              : total > 0
                ? `${progress.currentSection}/${total} 节`
                : "目录加载中"}
          </Text>
        </View>

        {sections.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              目录还没生成完,稍等一下再打开。
            </Text>
          </View>
        ) : (
          <FlatList
            data={sections}
            keyExtractor={(it) => String(it.index)}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            renderItem={(info) => renderRow(info, active, readSet, isAgentBusy, handleSectionPress)}
            ItemSeparatorComponent={Separator}
          />
        )}
      </Animated.View>
    </View>
  );
}

function Separator(): React.ReactElement {
  return <View style={styles.separator} />;
}

function renderRow(
  info: ListRenderItemInfo<DeeplyOutlineSection>,
  active: number,
  readSet: Set<number>,
  busy: boolean,
  onPress: (item: DeeplyOutlineSection) => void
): React.ReactElement {
  const { item } = info;
  const isCurrent = active > 0 && item.index === active;
  const isRead = readSet.has(item.index);
  const isUnread = !isRead && !isCurrent;
  const badgeStyle = isCurrent
    ? styles.badgeCurrent
    : isRead
      ? styles.badgeDone
      : styles.badgeUnread;
  const badgeTextStyle = isCurrent
    ? styles.badgeTextCurrent
    : isRead
      ? styles.badgeTextDone
      : styles.badgeTextUnread;
  const badgeContent = isCurrent ? "▶" : isRead ? "✓" : String(item.index);

  return (
    <Pressable
      onPress={() => void onPress(item)}
      disabled={busy}
      style={({ pressed }) => [
        styles.row,
        isCurrent && styles.rowActive,
        busy && styles.rowDisabled,
        pressed && !busy && styles.rowPressed
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled: busy }}
      accessibilityLabel={`第 ${item.index} 节 ${item.title}${isCurrent ? "(正在讲)" : isRead ? "(已读)" : ""}`}
    >
      <View style={[styles.badge, badgeStyle]}>
        <Text style={[styles.badgeText, badgeTextStyle]}>{badgeContent}</Text>
      </View>
      <Text
        style={[
          styles.rowTitle,
          isCurrent && styles.rowTitleActive,
          isUnread && styles.rowTitleUnread
        ]}
        numberOfLines={2}
      >
        {item.title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row-reverse",
    zIndex: 60
  },
  panel: {
    // width 现在跟着视口动态算,通过 inline style 传入。这里只放跨视口共通
    // 的样式。不设 flex,否则会被 row-reverse 容器拉满覆盖 width。
    height: "100%",
    backgroundColor: DRAWER_BG,
    borderLeftWidth: 1,
    borderLeftColor: "rgba(17,17,17,0.08)",
    shadowColor: "#000",
    shadowOffset: { width: -2, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    paddingTop: 18,
    paddingBottom: 14
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: DRAWER_DIVIDER
  },
  headerTitle: {
    color: DRAWER_INK,
    fontSize: 17,
    fontWeight: "700"
  },
  headerMeta: {
    marginTop: 4,
    color: DRAWER_INK_MUTED,
    fontSize: 12
  },
  empty: {
    paddingHorizontal: 20,
    paddingTop: 24
  },
  emptyText: {
    color: DRAWER_INK_MUTED,
    fontSize: 13,
    lineHeight: 22
  },
  listContent: {
    paddingTop: 8,
    paddingBottom: 24
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12
  },
  rowActive: {
    backgroundColor: DRAWER_ROW_ACTIVE_BG
  },
  rowPressed: {
    backgroundColor: "rgba(17,17,17,0.04)"
  },
  rowDisabled: {
    opacity: 0.4
  },
  badge: {
    width: 26,
    height: 26,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center"
  },
  badgeUnread: {
    backgroundColor: DRAWER_BADGE_BG
  },
  badgeDone: {
    backgroundColor: DRAWER_BADGE_DONE_BG
  },
  badgeCurrent: {
    backgroundColor: DRAWER_BADGE_CURRENT_BG
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "700"
  },
  badgeTextUnread: {
    color: DRAWER_BADGE_TEXT
  },
  badgeTextDone: {
    color: DRAWER_BADGE_DONE_TEXT
  },
  badgeTextCurrent: {
    color: DRAWER_BADGE_CURRENT_TEXT
  },
  rowTitle: {
    flex: 1,
    color: DRAWER_INK_SECONDARY,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600"
  },
  rowTitleActive: {
    color: DRAWER_INK,
    fontWeight: "700"
  },
  rowTitleUnread: {
    color: DRAWER_INK_MUTED,
    fontWeight: "500"
  },
  separator: {
    height: 0.5,
    backgroundColor: DRAWER_DIVIDER,
    marginHorizontal: 20
  }
});
