import { useLayoutEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo
} from "react-native";
import Swipeable from "react-native-gesture-handler/Swipeable";
import { Ionicons } from "@expo/vector-icons";
import { router, useNavigation } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { CachedImage } from "@/components/CachedImage";
import { NewConversationSheet } from "@/components/NewConversationSheet";
import {
  getLauncherMiniApps,
  getMiniAppListGlyph,
  getMiniAppListImage,
  type MiniAppDescriptor
} from "@/runtime/miniApps";
import { openConversation } from "@/runtime/navigation";
import { buildSessionKey, useConversationStore, type ConversationMeta } from "@/state/conversations";
import { KokoColors, KokoRadius } from "@/theme/koko";

/**
 * Chat list — first tab.
 *
 * All conversations live in one ordered list, sorted by pin state (pinned
 * first, most recently pinned on top) and then by most recent activity.
 * The chat list never special-cases Koko: a brand-new install gets a
 * pinned Koko conversation seeded at startup, but the user is free to
 * unpin or delete it like any other thread. No dark mode.
 */
export default function ChatsTabScreen(): React.ReactElement {
  const conversations = useConversationStore((s) => s.list);
  const createConversation = useConversationStore((s) => s.create);
  const archiveConversation = useConversationStore((s) => s.archive);
  const renameConversation = useConversationStore((s) => s.rename);
  const togglePin = useConversationStore((s) => s.togglePin);

  const navigation = useNavigation();
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  // Custom "+ 新建会话" sheet (see .brand/new-conversation-mockups.html · 方案 E).
  // Replaces the previous iOS ActionSheet + Android Alert combo so the launcher
  // can host a GitHub-install placeholder row plus richer per-mini-app metadata.
  const [isNewChatSheetOpen, setIsNewChatSheetOpen] = useState(false);

  function handleNewChat(): void {
    setIsNewChatSheetOpen(true);
  }

  async function createFromLauncher(app: MiniAppDescriptor): Promise<void> {
    const launch = app.launch ?? { kind: "conversation" as const };
    if (launch.kind === "route") {
      router.push(launch.pathname as never);
      return;
    }
    if (launch.kind === "action") {
      await launch.run();
      return;
    }

    const mode = launch.mode ?? app.id;
    let meta: ConversationMeta;
    if (app.onCreate !== undefined) {
      meta = await app.onCreate();
    } else if (app.singletonSessionScope !== undefined) {
      const sessionKey = buildSessionKey(mode, app.singletonSessionScope);
      meta = conversations.find((item) => item.sessionKey === sessionKey) ?? createConversation({
        mode,
        sessionScope: app.singletonSessionScope
      });
    } else {
      meta = createConversation({ mode });
    }
    openConversation(meta.id);
  }

  function promptRename(conversation: ConversationMeta): void {
    Alert.prompt(
      "重命名",
      undefined,
      (text) => {
        if (typeof text === "string" && text.trim().length > 0) {
          renameConversation(conversation.id, text.trim());
        }
      },
      "plain-text",
      conversation.title
    );
  }

  function confirmDelete(conversation: ConversationMeta): void {
    Alert.alert("删除会话", `确定要删除 "${conversation.title}" 吗？`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => archiveConversation(conversation.id)
      }
    ]);
  }

  const renderRow = ({ item, index }: ListRenderItemInfo<ConversationMeta>) => {
    const isLast = index === conversations.length - 1;
    return (
      <ConversationRow
        item={item}
        isLast={isLast}
        onPress={() => openConversation(item.id)}
        onLongPress={() => promptRename(item)}
        onTogglePin={() => togglePin(item.id)}
        onDelete={() => confirmDelete(item)}
      />
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>聊天</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="新建会话"
          onPress={handleNewChat}
          hitSlop={12}
          style={styles.headerButton}
        >
          <Ionicons name="add-circle-outline" size={28} color={KokoColors.ink} />
        </Pressable>
      </View>

      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        renderItem={renderRow}
        style={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              还没有会话{"\n"}点右上角 + 开始一段新对话
            </Text>
          </View>
        }
      />

      {isNewChatSheetOpen ? (
        <NewConversationSheet
          apps={getLauncherMiniApps()}
          onPickApp={(app) => void createFromLauncher(app)}
          onClose={() => setIsNewChatSheetOpen(false)}
        />
      ) : null}
    </SafeAreaView>
  );
}

interface ConversationRowProps {
  item: ConversationMeta;
  isLast: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}

function ConversationRow({
  item,
  isLast,
  onPress,
  onLongPress,
  onTogglePin,
  onDelete
}: ConversationRowProps): React.ReactElement {
  const swipeRef = useRef<Swipeable>(null);
  // Avatar precedence:
  //   1. listSnapshot.avatarUri — real remote/local image (e.g. a character
  //      portrait, a real book cover).
  //   2. listSnapshot.avatarFallback — coloured swatch + short label, used by
  //      deeply library courses whose book has no cover URL. Keeps each book
  //      visually distinct instead of collapsing every uncovered book onto the
  //      same default mini-app icon.
  //   3. mini-app's bundled listImage (e.g. deeply learning brain).
  //   4. listGlyph / first-character glyph as a last-resort text avatar.
  const avatarUri = item.listSnapshot?.avatarUri;
  const avatarFallback = item.listSnapshot?.avatarFallback;
  const listImage =
    avatarUri !== undefined && avatarUri.length > 0
      ? { uri: avatarUri }
      : avatarFallback === undefined
        ? getMiniAppListImage(item.mode)
        : undefined;
  const isPinned = item.pinned === true;

  function handlePinPress(): void {
    swipeRef.current?.close();
    onTogglePin();
  }

  function handleDeletePress(): void {
    swipeRef.current?.close();
    onDelete();
  }

  return (
    <Swipeable
      ref={swipeRef}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={() => (
        <View style={styles.swipeActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isPinned ? "取消置顶" : "置顶"}
            onPress={handlePinPress}
            style={({ pressed }) => [
              styles.swipeAction,
              styles.swipeActionPin,
              pressed && styles.swipeActionPressed
            ]}
          >
            <Text style={styles.swipeActionText}>
              {isPinned ? "取消置顶" : "置顶"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="删除"
            onPress={handleDeletePress}
            style={({ pressed }) => [
              styles.swipeAction,
              styles.swipeActionDelete,
              pressed && styles.swipeActionPressed
            ]}
          >
            <Text style={[styles.swipeActionText, styles.swipeActionTextOnDark]}>
              删除
            </Text>
          </Pressable>
        </View>
      )}
    >
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={350}
        android_ripple={{ color: KokoColors.surfaceSoft }}
        style={({ pressed }) => [
          styles.row,
          isPinned && styles.rowPinned,
          pressed && { backgroundColor: KokoColors.surfaceSoft }
        ]}
      >
        <View
          style={[
            styles.avatar,
            avatarFallback !== undefined && {
              backgroundColor: avatarFallback.fillColor
            }
          ]}
        >
          {listImage !== undefined ? (
            <CachedImage
              source={listImage}
              style={styles.avatarImage}
              contentFit="cover"
            />
          ) : avatarFallback !== undefined ? (
            <Text style={styles.avatarFallbackLabel} numberOfLines={1}>
              {avatarFallback.label}
            </Text>
          ) : (
            <Text style={styles.avatarGlyph}>
              {getMiniAppListGlyph(item.mode) ?? avatarGlyph(item.title)}
            </Text>
          )}
        </View>

        <View style={styles.rowBody}>
          <View style={styles.rowText}>
            <Text numberOfLines={1} style={styles.rowTitle}>
              {item.title}
            </Text>
            <Text numberOfLines={1} style={styles.rowPreview}>
              {item.lastPreview ?? "暂无消息"}
            </Text>
          </View>
          <View style={styles.rowMeta}>
            {isPinned ? (
              <Ionicons
                name="pin"
                size={12}
                color={KokoColors.inkMuted}
                style={styles.rowPinIcon}
              />
            ) : null}
            <Text style={styles.rowTime}>{formatRelative(item.updatedAt)}</Text>
          </View>
        </View>

        {isLast ? null : <View style={styles.separator} />}
      </Pressable>
    </Swipeable>
  );
}

function avatarGlyph(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) return "✨";
  const firstCodePoint = trimmed[Symbol.iterator]().next();
  return typeof firstCodePoint.value === "string" ? firstCodePoint.value : "✨";
}

function formatRelative(timestamp: number): string {
  const now = Date.now();
  const diffMs = Math.max(0, now - timestamp);
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin}分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24 && sameDay(now, timestamp)) {
    const date = new Date(timestamp);
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  const nowDate = new Date(now);
  const then = new Date(timestamp);
  const yesterday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - 1);
  if (sameDay(yesterday.getTime(), timestamp)) return "昨天";
  const diffDay = Math.floor(diffMs / 86_400_000);
  if (diffDay < 7) return `${diffDay}天前`;
  return `${then.getFullYear()}/${String(then.getMonth() + 1).padStart(2, "0")}/${String(then.getDate()).padStart(2, "0")}`;
}

function sameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

const AVATAR_SIZE = 52;
const ROW_HORIZONTAL_PADDING = 14;
const AVATAR_RIGHT_GAP = 14;
const SEPARATOR_INSET = ROW_HORIZONTAL_PADDING + AVATAR_SIZE + AVATAR_RIGHT_GAP;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: KokoColors.bg
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "700",
    color: KokoColors.ink
  },
  headerButton: {
    padding: 4,
    borderRadius: KokoRadius.pill
  },
  list: {
    backgroundColor: KokoColors.bg
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    height: 82,
    paddingLeft: ROW_HORIZONTAL_PADDING,
    paddingRight: ROW_HORIZONTAL_PADDING,
    position: "relative",
    backgroundColor: KokoColors.bg
  },
  rowPinned: {
    backgroundColor: KokoColors.primaryWash
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: KokoRadius.lg,
    alignItems: "center",
    justifyContent: "center",
    marginRight: AVATAR_RIGHT_GAP,
    backgroundColor: KokoColors.surfaceSoft,
    overflow: "hidden"
  },
  pinnedAvatar: {
    backgroundColor: KokoColors.primarySoft
  },
  avatarGlyph: {
    fontSize: 21,
    fontWeight: "600",
    color: KokoColors.inkSecondary
  },
  avatarImage: {
    width: "100%",
    height: "100%"
  },
  // Coloured-swatch fallback label (book name initials when a library course
  // has no cover image). White, bold, slightly tracked — matches the inset
  // BookCoverImage label style used inside the library itself.
  avatarFallbackLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
    paddingHorizontal: 4,
    textAlign: "center",
    letterSpacing: 0.2
  },
  rowBody: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    height: "100%"
  },
  rowText: {
    flex: 1,
    justifyContent: "center",
    paddingRight: 8
  },
  rowTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: KokoColors.ink
  },
  rowPreview: {
    marginTop: 5,
    fontSize: 14,
    color: KokoColors.inkSecondary
  },
  rowMeta: {
    flexDirection: "row",
    alignItems: "center"
  },
  rowPinIcon: {
    marginRight: 4
  },
  rowTime: {
    fontSize: 13,
    color: KokoColors.inkMuted
  },
  swipeActions: {
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: KokoColors.bg
  },
  swipeAction: {
    width: 84,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8
  },
  swipeActionPin: {
    backgroundColor: KokoColors.primarySoft
  },
  swipeActionDelete: {
    backgroundColor: KokoColors.danger
  },
  swipeActionPressed: {
    opacity: 0.85
  },
  swipeActionText: {
    fontSize: 15,
    fontWeight: "600",
    color: KokoColors.ink,
    textAlign: "center"
  },
  swipeActionTextOnDark: {
    color: "#FFFFFF"
  },
  separator: {
    position: "absolute",
    left: SEPARATOR_INSET,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: KokoColors.hairline
  },
  empty: {
    marginTop: 96,
    alignItems: "center",
    paddingHorizontal: 24
  },
  emptyText: {
    textAlign: "center",
    fontSize: 14,
    color: KokoColors.inkMuted,
    lineHeight: 22
  }
});
