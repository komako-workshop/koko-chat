/**
 * Host route: `/deeply`
 *
 * 薄壳路由,把 Deeply mini-app 的探索 chat 接进 expo-router。Deeply 不
 * 复用 host 的共享聊天屏幕,launcher 直接打开这个 route,后续的课程讲解
 * 等也都在 Deeply 自己的 surface 完成。
 */
import { useEffect, useLayoutEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { KokoColors, KokoRadius } from "@/theme/koko";
import { deeplyAvatarChatBuddy } from "../../../../miniapps/deeply/mobile/avatars";
import { DeeplyExploreScreen } from "../../../../miniapps/deeply/mobile/DeeplyExploreScreen";

export default function DeeplyHomeRoute(): React.ReactElement {
  // header 里左边渲染 Deeply 头像,告诉用户这里是 Deeply 而不是泛 KokoChat。
  const navigation = useNavigation();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const routeConversationId = typeof params.id === "string"
    ? params.id
    : Array.isArray(params.id)
      ? params.id[0] ?? null
      : null;
  // KeyboardAvoidingView 的 keyboardVerticalOffset 需要等于 stack header
  // 高度,否则 iOS 上键盘弹起会把输入框遮住(跟 host /chat/[id] 同一原因)。
  // mini-app 不直接依赖 @react-navigation/elements,host route 壳读完
  // 当 prop 传下去。
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
      headerLeft: () => (
        <View style={styles.headerLeft}>
          <Image source={deeplyAvatarChatBuddy} style={styles.headerAvatar} resizeMode="cover" />
        </View>
      ),
      headerRight: () => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="课程库"
          hitSlop={10}
          onPress={() => router.push("/deeply/library")}
          style={({ pressed }) => [
            styles.headerLibraryButton,
            pressed && styles.headerLibraryButtonPressed
          ]}
        >
          <Text style={styles.headerLibraryGlyph}>📚</Text>
        </Pressable>
      )
    });
  }, [navigation, router]);

  return (
    <SafeAreaView style={styles.screen} edges={["left", "right", "bottom"]}>
      <DeeplyExploreScreen
        conversationIdOverride={routeConversationId}
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
  headerLeft: {
    paddingLeft: 12,
    paddingRight: 4
  },
  headerAvatar: {
    width: 28,
    height: 28,
    borderRadius: KokoRadius.pill,
    backgroundColor: KokoColors.surfaceSoft
  },
  headerLibraryButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginRight: 4,
    borderRadius: KokoRadius.pill,
    alignItems: "center",
    justifyContent: "center"
  },
  headerLibraryButtonPressed: {
    opacity: 0.5
  },
  headerLibraryGlyph: {
    fontSize: 18,
    lineHeight: 22
  }
});
