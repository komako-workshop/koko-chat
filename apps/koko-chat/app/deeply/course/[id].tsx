/**
 * Host route: `/deeply/course/[id]`
 *
 * 薄壳路由,把 Deeply mini-app 的课程讲解 surface 接进 expo-router。
 * Conversation 的 mode 是 `deeply-course`,由 mini-app 注册成 route 形式的
 * conversation mode,所以 `openConversation(meta.id)` 会自动跳到这里。
 */
import { useEffect, useLayoutEffect, useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useConversationStore } from "@/state/conversations";
import { KokoRadius } from "@/theme/koko";

import { openDeeplyCourseOutlineDrawer } from "../../../../../miniapps/deeply/mobile/courseOutlineDrawerStore";
import { DeeplyCourseScreen } from "../../../../../miniapps/deeply/mobile/DeeplyCourseScreen";
import { LibraryBackButton } from "../library/_backButton";

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
  const [isFocused, setIsFocused] = useState(() => navigation.isFocused());
  const [focusEpoch, setFocusEpoch] = useState(0);

  useEffect(() => {
    const unsubscribeFocus = navigation.addListener("focus", () => {
      setIsFocused(true);
      setFocusEpoch((x) => x + 1);
    });
    const unsubscribeBlur = navigation.addListener("blur", () => {
      setIsFocused(false);
    });
    return () => {
      unsubscribeFocus();
      unsubscribeBlur();
    };
  }, [navigation]);

  useLayoutEffect(() => {
    navigation.setOptions({
      // Header title = 课程名(取代 "课程讲解"),进度小字交给 screen 自己渲染。
      title: conversationTitle,
      // 跟 Deeply 主页 / library 三个子页统一用 LibraryBackButton 圆角 ‹,
      // 不再夹一个不可点的 Deeply 头像把入口位置抢走 — 之前 chevron 跟头像
      // 并排,用户经常按到头像,以为返回坏了。
      headerLeft: () =>
        navigation.canGoBack() ? (
          <LibraryBackButton onPress={() => navigation.goBack()} />
        ) : null,
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
      <DeeplyCourseScreen
        conversationId={conversationId}
        headerHeight={headerHeight}
        isRouteFocused={isFocused}
        focusEpoch={focusEpoch}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F9F9F7"
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
