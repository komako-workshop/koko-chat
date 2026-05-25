import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import { getCategoryStyle } from "./libraryTheme";

/**
 * 封面图组件 — 一律 fixed aspect(2:3),自带分类色 fallback。
 *
 * 419 / 5569 本(7.5%)没有图;另外远程图 URL 也可能 fail。两种情况都
 * fallback 到分类色块 + 书名缩字。
 *
 * 调用方传 `size` 决定尺寸(s/m/l 三档,跟 mockup 里 thumb / mini cover /
 * big cover 对应),也可以 explicit 传 width。
 */
type Size = "xs" | "s" | "m" | "l";

const SIZES: Record<Size, { width: number; height: number; titleFontSize: number }> = {
  xs: { width: 50, height: 70, titleFontSize: 9 },
  s:  { width: 64, height: 88, titleFontSize: 10 },
  m:  { width: 88, height: 124, titleFontSize: 11 },
  l:  { width: 140, height: 196, titleFontSize: 14 }
};

export interface BookCoverImageProps {
  imgUrl: string;
  title: string;
  category: string;
  size?: Size;
  /** 强制 hide cover image,只显示色块版本(详情页 hero 已经有大封面,卡里就不再重复)。 */
  forceFallback?: boolean;
}

export function BookCoverImage({
  imgUrl,
  title,
  category,
  size = "s",
  forceFallback = false
}: BookCoverImageProps): React.ReactElement {
  const dims = SIZES[size];
  const style = getCategoryStyle(category);
  const [failed, setFailed] = useState(false);
  const showFallback = forceFallback || imgUrl.length === 0 || failed;

  if (showFallback) {
    return (
      <View
        style={[
          styles.fallback,
          {
            width: dims.width,
            height: dims.height,
            backgroundColor: style.colorStart
          }
        ]}
      >
        <Text
          style={[styles.fallbackTitle, { fontSize: dims.titleFontSize }]}
          numberOfLines={4}
        >
          {title}
        </Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri: imgUrl }}
      style={[
        styles.image,
        {
          width: dims.width,
          height: dims.height,
          backgroundColor: style.colorStart
        }
      ]}
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  );
}

const styles = StyleSheet.create({
  image: {
    borderRadius: 4
  },
  fallback: {
    borderRadius: 4,
    padding: 8,
    justifyContent: "flex-end"
  },
  fallbackTitle: {
    color: "#FFFFFF",
    fontWeight: "700",
    lineHeight: 14
  }
});
