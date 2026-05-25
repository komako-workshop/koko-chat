/**
 * 共享的 ‹ 返回按钮。
 *
 * 三个 library route(home / category / book)都通过 `navigation.setOptions
 * ({ headerLeft })` 用它替换默认 header back,确保在 web 平台 / 没有 stack
 * back 标题时也始终能看到一个可点的返回控件。行为跟 deeply course route
 * 里那个返回按钮保持一致。
 */
import { Pressable, StyleSheet, Text } from "react-native";

import { KokoRadius } from "@/theme/koko";

export function LibraryBackButton({
  onPress
}: {
  onPress: () => void;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="返回"
      hitSlop={10}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        pressed && styles.pressed
      ]}
    >
      <Text style={styles.glyph}>‹</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: 10,
    paddingVertical: 2,
    marginLeft: 4,
    borderRadius: KokoRadius.pill
  },
  pressed: {
    opacity: 0.5
  },
  glyph: {
    fontSize: 26,
    color: "#111111",
    fontWeight: "300",
    lineHeight: 28
  }
});
