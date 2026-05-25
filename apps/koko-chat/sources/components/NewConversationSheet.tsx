/**
 * "+ 新建会话" 弹出面板。
 *
 * 替代了之前的 iOS ActionSheet + Android Alert 原生组合。设计参考
 * `.brand/new-conversation-mockups.html` 方案 E:磨砂感的底部 sheet,
 * 顶部一条"粘 GitHub 链接装新 mini-app"的占位入口(灰态、不可点,
 * 给用户一个"以后可以装更多 mini-app"的扩展信号),下面是"已安装" mini-app
 * 列表,挑一个就开始新会话。
 *
 * 视觉上跟 KokoChat 暖纸调一致(白底 + 米色描边),区别于 deeply / tavern
 * 自家弹窗的圆头像风格 — 这里 mini-app icon 用 squircle 圆角方,呼应
 * 启动器 UI 的语义(挑一个"应用")。
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

import { CachedImage } from "@/components/CachedImage";
import {
  getMiniAppListGlyph,
  type MiniAppDescriptor
} from "@/runtime/miniApps";
import { KokoColors, KokoRadius } from "@/theme/koko";

const SHEET_TRANSLATE_INITIAL = 480;

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
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start();
  }, [anim]);

  const handleClose = useCallback(() => {
    Animated.timing(anim, {
      toValue: 0,
      duration: 180,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true
    }).start(({ finished }) => {
      if (finished) onClose();
    });
  }, [anim, onClose]);

  const handlePick = useCallback(
    (app: MiniAppDescriptor) => {
      Animated.timing(anim, {
        toValue: 0,
        duration: 160,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true
      }).start(({ finished }) => {
        if (finished) {
          onPickApp(app);
          onClose();
        }
      });
    },
    [anim, onClose, onPickApp]
  );

  const backdropOpacity = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
    extrapolate: "clamp"
  });
  const sheetTranslateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [SHEET_TRANSLATE_INITIAL, 0],
    extrapolate: "clamp"
  });

  return (
    <View style={styles.backdrop} pointerEvents="auto">
      <Animated.View
        pointerEvents="none"
        style={[styles.backdropFill, { opacity: backdropOpacity }]}
      />
      <Pressable style={styles.backdropPressable} onPress={handleClose} />
      <Animated.View
        style={[styles.sheet, { transform: [{ translateY: sheetTranslateY }] }]}
      >
        <View style={styles.grabber} />

        {/* 顶部占位 install 入口:从 mockup 方案 E 来。视觉上等同于
            Spotlight 的搜索条,但语义换成"装新 mini-app",符合 KokoChat
            的容器哲学。当前 disabled,点了不响应。 */}
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
          {apps.map((app) => (
            <AppRow key={app.id} app={app} onPress={() => handlePick(app)} />
          ))}
        </ScrollView>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="取消"
          onPress={handleClose}
          style={({ pressed }) => [
            styles.cancelButton,
            pressed && styles.cancelButtonPressed
          ]}
        >
          <Text style={styles.cancelButtonText}>取消</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

function AppRow({
  app,
  onPress
}: {
  app: MiniAppDescriptor;
  onPress: () => void;
}): React.ReactElement {
  const glyph = app.listGlyph ?? getMiniAppListGlyph(app.id) ?? "·";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={app.displayName}
      onPress={onPress}
      style={({ pressed }) => [styles.appRow, pressed && styles.appRowPressed]}
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
    justifyContent: "flex-end",
    zIndex: 60
  },
  backdropFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(20,20,28,0.42)"
  },
  backdropPressable: {
    ...StyleSheet.absoluteFillObject
  },
  sheet: {
    backgroundColor: KokoColors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 6,
    paddingHorizontal: 16,
    paddingBottom: 24,
    maxHeight: "82%"
  },
  grabber: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(0,0,0,0.18)",
    marginTop: 6,
    marginBottom: 14
  },
  installRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: KokoColors.surfaceSoft,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14
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
    paddingHorizontal: 4,
    marginBottom: 6
  },
  list: {
    flexGrow: 0,
    flexShrink: 1
  },
  listContent: {
    paddingBottom: 6
  },
  appRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 10,
    paddingHorizontal: 4
  },
  appRowPressed: {
    backgroundColor: KokoColors.surfaceSoft,
    borderRadius: 12
  },
  appIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
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
    fontSize: 22,
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
    fontSize: 22,
    color: KokoColors.inkMuted,
    fontWeight: "300",
    paddingHorizontal: 4
  },
  cancelButton: {
    marginTop: 14,
    paddingVertical: 14,
    borderRadius: KokoRadius.lg,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(17,17,17,0.06)"
  },
  cancelButtonPressed: {
    backgroundColor: KokoColors.surfaceSoft
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: KokoColors.ink
  }
});
