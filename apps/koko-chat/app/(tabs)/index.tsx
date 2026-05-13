import { useLayoutEffect } from "react";
import {
  ActionSheetIOS,
  Alert,
  FlatList,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useNavigation } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { openKokoHome } from "@/miniapps/koko";
import {
  getLauncherMiniApps,
  getMiniAppListGlyph,
  getMiniAppListImage,
  type MiniAppDescriptor
} from "@/runtime/miniApps";
import { useGatewayStore } from "@/state/gateway";
import { buildSessionKey, useConversationStore, type ConversationMeta } from "@/state/conversations";
import { KokoColors, KokoRadius } from "@/theme/koko";

/**
 * Chat list — first tab.
 *
 * Pinned Koko home row at the top, then user-created conversations
 * (newest first). The Koko palette gives the screen a warm off-white
 * feel; user messages use the Koko orange and agent rows stay on white
 * cards. No dark mode.
 */
export default function ChatsTabScreen(): React.ReactElement {
  const conversations = useConversationStore((s) => s.list);
  const createConversation = useConversationStore((s) => s.create);
  const archiveConversation = useConversationStore((s) => s.archive);
  const renameConversation = useConversationStore((s) => s.rename);
  const gatewayStatus = useGatewayStore((s) => s.status);

  const navigation = useNavigation();
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  function handleNewChat(): void {
    const launchers = getLauncherMiniApps();
    const options = ["取消", ...launchers.map((app) => app.displayName)];
    const onSelect = (index: number): void => {
      if (index <= 0) return;
      const app = launchers[index - 1];
      if (app === undefined) return;
      void createFromLauncher(app);
    };
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: 0, title: "新建会话" },
        onSelect
      );
    } else {
      Alert.alert("新建会话", undefined, [
        ...launchers.map((app, index) => ({
          text: app.displayName,
          onPress: () => onSelect(index + 1)
        })),
        { text: "取消", style: "cancel" }
      ]);
    }
  }

  async function createFromLauncher(app: MiniAppDescriptor): Promise<void> {
    let meta: ConversationMeta;
    if (app.onCreate !== undefined) {
      meta = await app.onCreate();
    } else if (app.singletonSessionScope !== undefined) {
      const sessionKey = buildSessionKey(app.id, app.singletonSessionScope);
      meta = conversations.find((item) => item.sessionKey === sessionKey) ?? createConversation({
        mode: app.id,
        sessionScope: app.singletonSessionScope
      });
    } else {
      meta = createConversation({ mode: app.id });
    }
    router.push({ pathname: "/chat/[id]", params: { id: meta.id } });
  }

  async function handleOpenKokoHome(): Promise<void> {
    if (gatewayStatus !== "connected") {
      Alert.alert("OpenClaw 未连接", "请先配对并连接 Gateway，然后再打开 Koko。");
      return;
    }
    try {
      await openKokoHome((conversationId) => {
        router.push({ pathname: "/chat/[id]", params: { id: conversationId } });
      });
    } catch (error) {
      Alert.alert("打开 Koko 失败", error instanceof Error ? error.message : String(error));
    }
  }

  function handleLongPress(conversation: ConversationMeta): void {
    const options = ["取消", "重命名", "删除会话"];
    const onSelect = (index: number): void => {
      if (index === 1) {
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
      } else if (index === 2) {
        Alert.alert("删除会话", `确定要删除 "${conversation.title}" 吗？`, [
          { text: "取消", style: "cancel" },
          {
            text: "删除",
            style: "destructive",
            onPress: () => archiveConversation(conversation.id)
          }
        ]);
      }
    };
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex: 0,
          destructiveButtonIndex: 2
        },
        onSelect
      );
    } else {
      Alert.alert(conversation.title, undefined, [
        { text: "重命名", onPress: () => onSelect(1) },
        { text: "删除会话", style: "destructive", onPress: () => onSelect(2) },
        { text: "取消", style: "cancel" }
      ]);
    }
  }

  const renderRow = ({ item, index }: ListRenderItemInfo<ConversationMeta>) => {
    const isLast = index === conversations.length - 1;
    const listImage = getMiniAppListImage(item.mode);
    return (
      <Pressable
        onPress={() => router.push({ pathname: "/chat/[id]", params: { id: item.id } })}
        onLongPress={() => handleLongPress(item)}
        delayLongPress={350}
        android_ripple={{ color: KokoColors.surfaceSoft }}
        style={({ pressed }) => [
          styles.row,
          pressed && { backgroundColor: KokoColors.surfaceSoft }
        ]}
      >
        <View style={styles.avatar}>
          {listImage !== undefined ? (
            <Image
              source={listImage}
              style={styles.avatarImage}
              resizeMode="cover"
            />
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
          <Text style={styles.rowTime}>{formatRelative(item.updatedAt)}</Text>
        </View>

        {isLast ? null : <View style={styles.separator} />}
      </Pressable>
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
        ListHeaderComponent={
          <KokoPinnedRow onPress={() => void handleOpenKokoHome()} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              还没有会话{"\n"}点右上角 + 开始一段新对话
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

function KokoPinnedRow({ onPress }: { onPress: () => void }): React.ReactElement {
  const listImage = getMiniAppListImage("koko");
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      android_ripple={{ color: KokoColors.surfaceSoft }}
      style={({ pressed }) => [
        styles.row,
        styles.pinnedRow,
        pressed && { backgroundColor: KokoColors.primarySoft }
      ]}
    >
      <View style={[styles.avatar, styles.pinnedAvatar]}>
        {listImage !== undefined ? (
          <Image source={listImage} style={styles.avatarImage} resizeMode="cover" />
        ) : (
          <Text style={styles.avatarGlyph}>K</Text>
        )}
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowText}>
          <Text numberOfLines={1} style={styles.rowTitle}>
            Koko
          </Text>
          <Text numberOfLines={1} style={styles.rowPreview}>
            你的 KokoChat 主助手
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={KokoColors.inkMuted} />
      </View>
      <View style={styles.separator} />
    </Pressable>
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
  pinnedRow: {
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
  rowTime: {
    fontSize: 13,
    color: KokoColors.inkMuted
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
