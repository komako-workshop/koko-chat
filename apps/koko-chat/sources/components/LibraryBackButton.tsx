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
