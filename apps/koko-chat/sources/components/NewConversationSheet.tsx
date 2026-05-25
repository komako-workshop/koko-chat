/**
 * "+ 新建会话" Spotlight 浮岛面板。
 *
 * 参照 `.brand/new-conversation-mockups.html` 方案 E:
 *   - 整屏深色 backdrop(点击外部关闭)
 *   - 一个**居中浮岛**式的白色圆角面板,距离屏幕上下都有 margin,
 *     不贴底也不全宽,像 macOS Spotlight / iOS share sheet 的命令面板
 *   - 顶部一条"粘 GitHub 链接装新 mini-app"占位入口(灰态、不可点),
 *     KokoChat 是 mini-app 容器,先把视觉信号占住
 *   - 下方 "已安装" mini-app 列表;条目之间细分隔线
 *   - "取消"按钮**漂浮在面板下方独立位置**,白色字、无容器,跟面板分开
 *
 * 不用 RN `Modal`:Modal portal 到根视图外,会跳出 deeply web demo 的 480
 * 手机框。这里用 absolute fill 在父 root 渲染,跟其它 sheet 一致。
 */
import { useCallback, useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { BlurView } from "expo-blur";

import { CachedImage } from "@/components/CachedImage";
import {
  getMiniAppListGlyph,
  type MiniAppDescriptor
} from "@/runtime/miniApps";
import { KokoColors } from "@/theme/koko";

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

export interface NewConversationSheetProps {
  apps: MiniAppDescriptor[];
  onPickApp: (app: MiniAppDescriptor) => void;
  onClose: () => void;
}

export function NewConversationSheet({
  apps,
  onPickApp,
  onClose
}: NewConversationSheetProps): React.ReactElement {
  // anim 0 → 1:backdrop 渐显 + 面板 fade+scale-in(从 0.94 弹到 1)。
  // Spotlight 那种"突然出现的浮岛"质感,不用底部滑入的动作。
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start();
  }, [anim]);

  const closeAndThen = useCallback(
    (after?: () => void) => {
      Animated.timing(anim, {
        toValue: 0,
        duration: 140,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true
      }).start(({ finished }) => {
        if (finished) {
          after?.();
          onClose();
        }
      });
    },
    [anim, onClose]
  );

  const handleClose = useCallback(() => closeAndThen(), [closeAndThen]);
  const handlePick = useCallback(
    (app: MiniAppDescriptor) => closeAndThen(() => onPickApp(app)),
    [closeAndThen, onPickApp]
  );

  const backdropOpacity = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
    extrapolate: "clamp"
  });
  const panelScale = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.94, 1],
    extrapolate: "clamp"
  });

  return (
    <View style={styles.backdrop} pointerEvents="auto">
      {/* 真·毛玻璃 backdrop:expo-blur 给到 native 平台 UIVisualEffectView /
          Android 12+ RenderEffect 实现,web 走 backdrop-filter。tint dark
          + intensity 32 拉出和深色 dim 一致的高级感。Animated 包装让 mount
          时 opacity 渐显,跟面板 fade-scale 同步。 */}
      <AnimatedBlurView
        intensity={32}
        tint="dark"
        style={[styles.backdropBlur, { opacity: backdropOpacity }]}
        pointerEvents="none"
      />
      <Pressable style={styles.backdropPressable} onPress={handleClose} />

      {/* 居中浮岛主体。Spotlight 风:左右离屏幕 16,纵向偏下让面板接近
          内容区中央偏下,既不贴底也不顶天,跟 + 按钮拉开距离,视觉重心
          下沉一点更稳。 */}
      <Animated.View
        style={[
          styles.panel,
          { opacity: backdropOpacity, transform: [{ scale: panelScale }] }
        ]}
      >
        <View style={styles.installRow}>
          <View style={styles.installLead}>
            <Text style={styles.installLeadGlyph}>+</Text>
          </View>
          <Text style={styles.installPlaceholder} numberOfLines={1}>
            粘 GitHub 链接装新 mini-app
          </Text>
          <View style={styles.installBadge}>
            <Text style={styles.installBadgeText}>即将开放</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>已安装</Text>

        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          {apps.map((app, index) => (
            <AppRow
              key={app.id}
              app={app}
              onPress={() => handlePick(app)}
              divider={index > 0}
            />
          ))}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

function AppRow({
  app,
  onPress,
  divider
}: {
  app: MiniAppDescriptor;
  onPress: () => void;
  divider: boolean;
}): React.ReactElement {
  const glyph = app.listGlyph ?? getMiniAppListGlyph(app.id) ?? "·";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={app.displayName}
      onPress={onPress}
      style={({ pressed }) => [
        styles.appRow,
        divider && styles.appRowDivider,
        pressed && styles.appRowPressed
      ]}
    >
      <View style={styles.appIcon}>
        {app.listImage !== undefined ? (
          <CachedImage
            source={app.listImage}
            style={styles.appIconImage}
            contentFit="cover"
          />
        ) : (
          <Text style={styles.appIconGlyph}>{glyph}</Text>
        )}
      </View>
      <View style={styles.appBody}>
        <Text style={styles.appTitle} numberOfLines={1}>
          {app.displayName}
        </Text>
        {app.launcherSubtitle !== undefined ? (
          <Text style={styles.appSubtitle} numberOfLines={1}>
            {app.launcherSubtitle}
          </Text>
        ) : null}
      </View>
      <Text style={styles.appChevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 60
  },
  backdropBlur: {
    ...StyleSheet.absoluteFillObject
  },
  backdropPressable: {
    ...StyleSheet.absoluteFillObject
  },
  // 居中偏下的浮岛:left/right 离屏幕 16,top 25%(从 12% 下移),让面板
  // 远离屏幕顶 + 按钮,视觉重心稳一些。圆角 22 + 阴影偏柔,叠在 blur backdrop
  // 上时跟 Spotlight 命令面板观感对齐。
  panel: {
    position: "absolute",
    left: 16,
    right: 16,
    top: "25%",
    backgroundColor: "rgba(255,255,255,0.94)",
    borderRadius: 22,
    paddingTop: 6,
    paddingHorizontal: 10,
    paddingBottom: 8,
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
    elevation: 24,
    maxHeight: "58%",
    overflow: "hidden"
  },
  installRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: KokoColors.surfaceSoft,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 6,
    marginBottom: 12
  },
  installLead: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.06)",
    alignItems: "center",
    justifyContent: "center"
  },
  installLeadGlyph: {
    fontSize: 16,
    color: KokoColors.inkSecondary,
    lineHeight: 18
  },
  installPlaceholder: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    color: KokoColors.inkMuted
  },
  installBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.06)"
  },
  installBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: KokoColors.inkSecondary,
    letterSpacing: 0.2
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: KokoColors.inkSecondary,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    paddingHorizontal: 6,
    marginBottom: 4
  },
  list: {
    flexGrow: 0,
    flexShrink: 1
  },
  listContent: {
    paddingBottom: 2
  },
  appRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 6
  },
  appRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: KokoColors.hairline
  },
  appRowPressed: {
    backgroundColor: KokoColors.surfaceSoft
  },
  appIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: KokoColors.surfaceSoft,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden"
  },
  appIconImage: {
    width: "100%",
    height: "100%"
  },
  appIconGlyph: {
    fontSize: 20,
    fontWeight: "600",
    color: KokoColors.inkSecondary
  },
  appBody: {
    flex: 1,
    minWidth: 0
  },
  appTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: KokoColors.ink
  },
  appSubtitle: {
    fontSize: 12,
    color: KokoColors.inkMuted,
    marginTop: 3
  },
  appChevron: {
    fontSize: 20,
    color: KokoColors.inkMuted,
    fontWeight: "300",
    paddingHorizontal: 2
  }
});
