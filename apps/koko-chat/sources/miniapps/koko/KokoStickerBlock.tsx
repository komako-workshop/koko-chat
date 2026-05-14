import { Image, StyleSheet, Text, View } from "react-native";

import type { BlockRenderProps } from "@/runtime/messageBlocks";
import { KokoColors } from "@/theme/koko";
import {
  KOKO_STICKERS,
  type KokoStickerBlockData
} from "./stickers";

export function KokoStickerBlock({
  block
}: BlockRenderProps<KokoStickerBlockData>): React.ReactElement {
  const sticker = KOKO_STICKERS[block.data.id];

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Koko 表情包：${sticker.label}`}
      style={styles.wrap}
    >
      <Image
        source={sticker.source}
        style={styles.image}
        resizeMode="contain"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <Text
        style={styles.label}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {sticker.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "flex-start"
  },
  image: {
    width: 136,
    height: 136,
    borderRadius: 20
  },
  label: {
    marginTop: 2,
    fontSize: 11,
    color: KokoColors.inkMuted
  }
});
