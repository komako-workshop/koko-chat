/**
 * Host route: `/deeply/course/[id]`
 *
 * 薄壳路由,把 Deeply mini-app 的课程讲解 surface 接进 expo-router。
 * Conversation 的 mode 是 `deeply-course`,由 mini-app 注册成 route 形式的
 * conversation mode,所以 `openConversation(meta.id)` 会自动跳到这里。
 */
import { useLayoutEffect } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useConversationStore } from "@/state/conversations";
import { KokoColors, KokoRadius } from "@/theme/koko";

import { deeplyAvatarLearning } from "../../../../../miniapps/deeply/mobile/avatars";
import { openDeeplyCourseOutlineDrawer } from "../../../../../miniapps/deeply/mobile/courseOutlineDrawerStore";
import { DeeplyCourseScreen } from "../../../../../miniapps/deeply/mobile/DeeplyCourseScreen";

export default function DeeplyCourseRoute(): React.ReactElement {
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ id?: string }>();
  const conversationId = typeof params.id === "string" ? params.id : null;
  const conversationTitle = useConversationStore((s) => {
    if (conversationId === null) return "课程讲解";
    const meta = s.list.find((m) => m.id === conversationId);
    return meta?.title ?? "课程讲解";
  });
  // 跟 /deeply 同样,把 stack header 高度传给 mini-app 给 KeyboardAvoidingView 用。
  const headerHeight = useHeaderHeight();

  useLayoutEffect(() => {
    navigation.setOptions({
      // Header title = 课程名(取代 "课程讲解"),进度小字交给 screen 自己渲染,
      // 避免 host header / screen 头像区双层重复信息。
      title: conversationTitle,
      // headerLeft 自定义同时放 back chevron + Deeply 头像。RN Navigation
      // 默认 headerLeft 只在没 set headerLeft 时才显示返回按钮 —— 我们 set 了
      // 头像就把它顶掉了,所以这里手动加回 chevron。
      headerLeft: () => (
        <View style={styles.headerLeftRow}>
          {navigation.canGoBack() ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="返回"
              hitSlop={10}
              onPress={() => navigation.goBack()}
              style={({ pressed }) => [
                styles.headerBackButton,
                pressed && styles.headerBackButtonPressed
              ]}
            >
              <Text style={styles.headerBackGlyph}>‹</Text>
            </Pressable>
          ) : null}
          <Image source={deeplyAvatarLearning} style={styles.headerAvatar} resizeMode="cover" />
        </View>
      ),
      headerRight: () =>
        conversationId === null ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="课程目录"
            onPress={() => openDeeplyCourseOutlineDrawer(conversationId)}
            hitSlop={10}
            style={({ pressed }) => [
              styles.headerOutlineButton,
              pressed && styles.headerOutlineButtonPressed
            ]}
          >
            <Text style={styles.headerOutlineGlyph}>≡</Text>
          </Pressable>
        )
    });
  }, [navigation, conversationId, conversationTitle]);

  return (
    <SafeAreaView style={styles.screen} edges={["left", "right", "bottom"]}>
      <DeeplyCourseScreen conversationId={conversationId} headerHeight={headerHeight} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F9F9F7"
  },
  headerLeftRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 4,
    paddingRight: 4,
    gap: 4
  },
  headerBackButton: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: KokoRadius.pill
  },
  headerBackButtonPressed: {
    opacity: 0.5
  },
  headerBackGlyph: {
    fontSize: 26,
    color: "#111111",
    fontWeight: "300",
    lineHeight: 28
  },
  headerAvatar: {
    width: 28,
    height: 28,
    borderRadius: KokoRadius.pill,
    backgroundColor: KokoColors.surfaceSoft
  },
  headerOutlineButton: {
    paddingHorizontal: 14,
    paddingVertical: 4,
    marginRight: 4,
    borderRadius: KokoRadius.pill,
    alignItems: "center",
    justifyContent: "center"
  },
  headerOutlineButtonPressed: {
    backgroundColor: "rgba(17,17,17,0.06)"
  },
  headerOutlineGlyph: {
    fontSize: 22,
    color: "#111111",
    fontWeight: "700",
    lineHeight: 22
  }
});
