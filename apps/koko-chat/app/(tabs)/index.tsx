import { useLayoutEffect } from "react";
import {
  ActionSheetIOS,
  Alert,
  FlatList,
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
import tw from "twrnc";

import { useConversationStore, type ConversationMeta } from "@/state/conversations";
import { useSettingsStore } from "@/state/settings";

/**
 * WeChat-like conversation list. First tab in the bottom tab bar.
 *
 * Visual targets:
 *   - Rounded square avatar placeholder on the left
 *   - Two-line content on the right (title + last preview)
 *   - Timestamp in the top-right of each row
 *   - Hairline separators that start after the avatar (WeChat pattern)
 *   - Large bold "聊天" header at the top with a "+" button on the right
 */
export default function ChatsTabScreen(): React.ReactElement {
  const conversations = useConversationStore((s) => s.list);
  const createConversation = useConversationStore((s) => s.create);
  const archiveConversation = useConversationStore((s) => s.archive);
  const renameConversation = useConversationStore((s) => s.rename);
  const isDark = useSettingsStore((s) => s.darkMode);

  const navigation = useNavigation();
  useLayoutEffect(() => {
    // The tabs layout hides the header; we render our own.
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  function handleNewChat(): void {
    const meta = createConversation();
    router.push({ pathname: "/chat/[id]", params: { id: meta.id } });
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
      // Simple Alert-based fallback for Android until we add a cross-platform sheet.
      Alert.alert(conversation.title, undefined, [
        { text: "重命名", onPress: () => onSelect(1) },
        { text: "删除会话", style: "destructive", onPress: () => onSelect(2) },
        { text: "取消", style: "cancel" }
      ]);
    }
  }

  const renderRow = ({ item, index }: ListRenderItemInfo<ConversationMeta>) => {
    const isLast = index === conversations.length - 1;
    return (
      <Pressable
        onPress={() => router.push({ pathname: "/chat/[id]", params: { id: item.id } })}
        onLongPress={() => handleLongPress(item)}
        delayLongPress={350}
        android_ripple={{ color: isDark ? "#1c1c1e" : "#e5e5ea" }}
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: isDark ? "#000" : "#fff" },
          pressed && { backgroundColor: isDark ? "#1c1c1e" : "#ececec" }
        ]}
      >
        <View
          style={[
            styles.avatar,
            { backgroundColor: isDark ? "#1f2937" : "#e5e7eb" }
          ]}
        >
          <Text
            style={[
              styles.avatarGlyph,
              { color: isDark ? "#9ca3af" : "#64748b" }
            ]}
          >
            {avatarGlyph(item.title)}
          </Text>
        </View>

        <View style={styles.rowBody}>
          <View style={styles.rowText}>
            <Text
              numberOfLines={1}
              style={[
                styles.rowTitle,
                { color: isDark ? "#f8fafc" : "#0f172a" }
              ]}
            >
              {item.title}
            </Text>
            <Text
              numberOfLines={1}
              style={[
                styles.rowPreview,
                { color: isDark ? "#94a3b8" : "#8e8e93" }
              ]}
            >
              {item.lastPreview ?? "暂无消息"}
            </Text>
          </View>
          <Text
            style={[
              styles.rowTime,
              { color: isDark ? "#64748b" : "#8e8e93" }
            ]}
          >
            {formatRelative(item.updatedAt)}
          </Text>
        </View>

        {isLast ? null : (
          <View
            style={[
              styles.separator,
              { backgroundColor: isDark ? "#1f2937" : "#e5e5ea" }
            ]}
          />
        )}
      </Pressable>
    );
  };

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: isDark ? "#000" : "#fff" }]}
      edges={["top", "left", "right"]}
    >
      <View style={styles.header}>
        <Text
          style={[styles.headerTitle, { color: isDark ? "#f8fafc" : "#0f172a" }]}
        >
          聊天
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New chat"
          onPress={handleNewChat}
          hitSlop={12}
          style={styles.headerButton}
        >
          <Ionicons
            name="add-circle-outline"
            size={28}
            color={isDark ? "#f8fafc" : "#0f172a"}
          />
        </Pressable>
      </View>

      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        renderItem={renderRow}
        style={{ backgroundColor: isDark ? "#000" : "#fff" }}
        ListEmptyComponent={
          <View style={tw`mt-24 items-center px-6`}>
            <Text
              style={tw`text-center text-sm text-slate-400 dark:text-slate-500`}
            >
              还没有会话{"\n"}点右上角 + 开始一段新对话
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

function avatarGlyph(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) return "🦞";
  const firstCodePoint = trimmed[Symbol.iterator]().next();
  return typeof firstCodePoint.value === "string" ? firstCodePoint.value : "🦞";
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

// WeChat-style dimensions. Avatar 52, row height 82, body indent = avatar + gap.
const AVATAR_SIZE = 52;
const ROW_HORIZONTAL_PADDING = 14;
const AVATAR_RIGHT_GAP = 14;
const SEPARATOR_INSET = ROW_HORIZONTAL_PADDING + AVATAR_SIZE + AVATAR_RIGHT_GAP;

const styles = StyleSheet.create({
  screen: {
    flex: 1
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
    fontWeight: "700"
  },
  headerButton: {
    padding: 4,
    borderRadius: 999
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    height: 82,
    paddingLeft: ROW_HORIZONTAL_PADDING,
    paddingRight: ROW_HORIZONTAL_PADDING,
    position: "relative"
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginRight: AVATAR_RIGHT_GAP
  },
  avatarGlyph: {
    fontSize: 21,
    fontWeight: "600"
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
    fontWeight: "600"
  },
  rowPreview: {
    marginTop: 5,
    fontSize: 14
  },
  rowTime: {
    fontSize: 13
  },
  separator: {
    position: "absolute",
    left: SEPARATOR_INSET,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth
  }
});
