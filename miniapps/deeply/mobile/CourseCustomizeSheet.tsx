import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";

import {
  closeDeeplyCustomizeSheet,
  useDeeplyCustomizeSheetState
} from "./customizeSheetStore";
import { useGatewayStore } from "@/state/gateway";
import {
  startDeeplyBookCourse,
  startDeeplyMaterialCourse,
  startDeeplyResearchCourse,
  type SectionPreset
} from "./courseSession";

// 本地文件上传暂时下线 —— OpenClaw `chat.send.attachments` 只支持图片
// (5MB / 25MB WebSocket frame 限制),PDF 等长文件没法直接 base64 走过去。
// MVP 阶段先只保留 URL 入口,后续如果做服务端抽取再恢复本地文件入口。

const SHEET_BG = "#FFFFFF";
const SHEET_BACKDROP = "rgba(17,17,17,0.45)";
const SHEET_INK = "#1E293B";
const SHEET_INK_SECONDARY = "#475569";
const SHEET_INK_MUTED = "#94A3B8";
const SHEET_CHIP_BG = "#F1F5F2";
const SHEET_CHIP_BG_ACTIVE = "#111111";
const SHEET_CHIP_TEXT_ACTIVE = "#FFFFFF";
const CARD_BORDER = "rgba(17,17,17,0.08)";
const CARD_BORDER_ACTIVE = "#111111";

const SHEET_TRANSLATE_INITIAL = 540;

type CustomizeMode = "research" | "material" | "book" | "interest";
type EntryKey = CustomizeMode;

interface EntryDef {
  key: EntryKey;
  icon: string;
  title: string;
  subtitle: string;
  /** Entries that are not implemented yet show as ghost-only and cannot be expanded. */
  comingSoon?: boolean;
}

const ENTRIES: EntryDef[] = [
  {
    key: "research",
    icon: "🔍",
    title: "深度调研一个主题",
    subtitle: "我会先去做调研,综合多方资料后再为你定一份带引用的课程"
  },
  {
    key: "material",
    icon: "🔗",
    title: "基于一个链接",
    subtitle: "贴一个文章/报告/视频的链接,我会把它读完再拆成课程"
  },
  {
    key: "book",
    icon: "📚",
    title: "从一本书入门",
    subtitle: "给一本书,agent 找它的章节解读 + 权威书评,拆成精读课"
  },
  {
    key: "interest",
    icon: "💡",
    title: "基于你的兴趣",
    subtitle: "让 AI 在 Deeply 主页给你推几张课程卡片(可指定方向也可完全交给 AI)"
  }
];

/**
 * "讲多长" 4 个 preset。
 *
 * - `auto`:不指定节数;sections=0 喂给 startDeeply*。
 * - `light` / `deep`:固定节数 preset(8 / 24)。
 * - `custom`:让用户自己填一个 3-40 之间的整数。
 *
 * 注:`standard` 是 legacy preset(只有老 sheet / record 用),新 sheet
 * 不再渲染它。type `SectionPreset` 仍保留 standard 是为了反序列化老 record。
 */
interface SectionPresetCard {
  id: Exclude<SectionPreset, "standard">;
  label: string;
  sub: string;
  /** 0 表示 auto / 由用户输入决定。 */
  sections: number;
}

const SECTION_PRESETS: SectionPresetCard[] = [
  { id: "auto", label: "自动", sub: "", sections: 0 },
  { id: "light", label: "轻量", sub: "约 8 节", sections: 8 },
  { id: "deep", label: "深度", sub: "约 24 节", sections: 24 },
  { id: "custom", label: "自定义", sub: "", sections: 0 }
];

/**
 * 顶层挂载的 sheet bridge:订阅 customizeSheetStore,sheet 打开时
 * 把当前 explore conversationId 传给真正的 sheet 组件。
 *
 * 不使用 RN Modal:Modal 会 portal 到根视图外,跳出 web demo 的 480 手机框。
 * 这里跟 DeeplyCourseSheetMount 同构 —— 都挂在 DeeplyExploreScreen 的 root 内,
 * sheet 永远活在 demo frame 里。
 */
export function DeeplyCustomizeSheetMount(): React.ReactElement | null {
  const { isOpen, conversationId } = useDeeplyCustomizeSheetState();
  if (!isOpen) return null;
  return (
    <CourseCustomizeSheet
      conversationId={conversationId}
      onClose={closeDeeplyCustomizeSheet}
    />
  );
}

interface CourseCustomizeSheetProps {
  conversationId: string | null;
  onClose: () => void;
}

/**
 * "定制课程" 入口弹窗。四张实卡:
 *
 * - **深度调研一个主题** —— agent 主动用托管搜索/web_fetch,综合多方资料后出课
 * - **基于一个链接** —— 用户贴 URL,agent web_fetch 后围绕这份资料拆课
 * - **从一本书入门** —— 用户给书名,agent 先 disambiguate 再围绕章节拆精读课
 * - **基于你的兴趣** —— 不创建 course,直接在主聊里 dispatch 推荐请求
 *
 * 卡片是 accordion 形态:点哪张展开哪张的表单,其它收起。
 *
 * 历史:material 入口曾支持本地文件上传(PDF/txt 等),但 OpenClaw
 * `chat.send.attachments` 只支持图片(5MB/25MB 帧限),长文件没法直接 base64
 * 走 WebSocket。MVP 阶段已下线本地文件入口,仅保留 URL 输入。
 */
function CourseCustomizeSheet({
  conversationId,
  onClose
}: CourseCustomizeSheetProps): React.ReactElement {
  const [mode, setMode] = useState<CustomizeMode>("research");
  const [topic, setTopic] = useState("");
  const [materialUrl, setMaterialUrl] = useState("");
  // book mode 只要书名;作者 / 版本的 disambiguation 交给 chat 里 agent 候选卡片去做。
  const [bookTitle, setBookTitle] = useState("");
  // interest mode 的方向输入(可空)。空 = 完全交给 AI 推荐;有值 = narrow 到该方向。
  const [interestDirection, setInterestDirection] = useState("");
  // interest 走的是把推荐 dispatch 到 explore conversation 的路径,
  // 不创建新 course conversation,所以需要 gateway store 的 sendUserMessage。
  const sendUserMessage = useGatewayStore((s) => s.sendUserMessage);
  const [sectionPreset, setSectionPreset] = useState<SectionPreset>("auto");
  // custom preset 选中时用户输入的节数(字符串以方便保留半成品 input)。
  const [customSectionsRaw, setCustomSectionsRaw] = useState<string>("12");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const customSectionsNum = (() => {
    const n = Number(customSectionsRaw.trim());
    if (!Number.isFinite(n)) return NaN;
    return Math.trunc(n);
  })();
  // 不卡 min/max,只挡住 0 / 负数 / 非数(0 是 auto sentinel,会把"自定义"
  // 误标成"自动";其它非法值留到 button disable 就够了)。
  const customSectionsValid =
    sectionPreset !== "custom"
      ? true
      : Number.isFinite(customSectionsNum) && customSectionsNum >= 1;

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

  const trimmed = topic.trim();
  const materialUrlTrimmed = materialUrl.trim();
  const bookTitleTrimmed = bookTitle.trim();
  const interestDirectionTrimmed = interestDirection.trim();
  // interest mode 不需要 section preset(它不创建 course),也允许空输入。
  const canStart =
    !starting &&
    (mode === "interest"
      ? true
      : customSectionsValid &&
        (mode === "research"
          ? trimmed.length >= 2
          : mode === "material"
            ? materialUrlTrimmed.length > 0
            : bookTitleTrimmed.length >= 2));

  const handleStart = useCallback(async () => {
    if (!canStart) return;
    setStarting(true);
    setError(null);
    try {
      // 算出最终 sections:auto → 0, custom → 用户输入, 其它 → preset 固定值。
      const preset = SECTION_PRESETS.find((p) => p.id === sectionPreset);
      const sections =
        sectionPreset === "auto"
          ? 0
          : sectionPreset === "custom"
            ? customSectionsNum
            : (preset?.sections ?? 0);
      if (mode === "research") {
        await startDeeplyResearchCourse({
          topic: trimmed,
          sectionPreset,
          sections,
          parentConversationId: conversationId
        });
      } else if (mode === "material") {
        await startDeeplyMaterialCourse({
          label: materialUrlTrimmed,
          url: materialUrlTrimmed,
          sectionPreset,
          sections,
          parentConversationId: conversationId
        });
      } else if (mode === "book") {
        await startDeeplyBookCourse({
          title: bookTitleTrimmed,
          sectionPreset,
          sections,
          parentConversationId: conversationId
        });
      } else {
        // mode === "interest" —— 完全不同的路径:不创建 course conversation,
        // 直接把"给我推荐课程"的 visible text 发到当前 explore conversation。
        // agent 走现有 explore outbound builder + koko.deeply.recommendations
        // transformer 链路,在 chat 里出推荐卡片。用户点卡片走 CourseDetailSheet
        // → 开课。整条 disambiguation 链路免写。
        if (conversationId === null) {
          throw new Error("没找到主页对话,关 sheet 后从 Deeply 主页再点这个按钮一次");
        }
        const visible = interestDirectionTrimmed.length > 0
          ? `围绕「${interestDirectionTrimmed}」给我推荐几个值得学的课程`
          : `给我推荐几个值得学的课程吧`;
        await sendUserMessage(conversationId, visible);
      }
      handleClose();
    } catch (err) {
      console.error("[deeply] start research course failed", err);
      setError(err instanceof Error ? err.message : String(err));
      setStarting(false);
    }
  }, [
    bookTitleTrimmed,
    canStart,
    conversationId,
    customSectionsNum,
    handleClose,
    interestDirectionTrimmed,
    materialUrlTrimmed,
    mode,
    sectionPreset,
    sendUserMessage,
    trimmed
  ]);

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
      {/* 底部 sheet/input dock 需要 padding 避让键盘。Android 不带 header
          offset,避免旧的 height 模式把内容额外压短。 */}
      <KeyboardAvoidingView
        behavior="padding"
        style={styles.keyboardAvoid}
        pointerEvents="box-none"
      >
      <Animated.View style={[styles.sheet, { transform: [{ translateY: sheetTranslateY }] }]}>
        {/* 点 grabber + header 空白处时收键盘 — sheet 区不必滚到底部 */}
        <Pressable onPress={() => Keyboard.dismiss()} accessibilityRole="none">
          <View style={styles.grabber} />
          <View style={styles.header}>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.headerTitle}>定制课程</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭"
              onPress={handleClose}
              hitSlop={12}
              style={({ pressed }) => [styles.closeButton, pressed && styles.closeButtonPressed]}
            >
              <Text style={styles.closeButtonText}>×</Text>
            </Pressable>
          </View>
        </Pressable>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        >
          {ENTRIES.map((entry) => {
            const expanded = !entry.comingSoon && entry.key === mode;
            const onPress = entry.comingSoon
              ? undefined
              : () => setMode(entry.key as CustomizeMode);
            return (
              <Pressable
                key={entry.key}
                accessibilityRole={entry.comingSoon ? "text" : "button"}
                accessibilityState={{ selected: expanded, disabled: entry.comingSoon }}
                onPress={onPress}
                disabled={entry.comingSoon === true}
                style={({ pressed }) => [
                  styles.entryCard,
                  expanded && styles.entryCardExpanded,
                  entry.comingSoon && styles.entryCardComingSoon,
                  pressed && !entry.comingSoon && !expanded && styles.entryCardPressed
                ]}
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.cardIcon}>{entry.icon}</Text>
                  <View style={styles.cardHeaderText}>
                    <Text style={styles.cardTitle}>{entry.title}</Text>
                    {/* 展开后隐藏副标题 — 用户已经在这卡里操作了,不需要再读说明 */}
                    {expanded ? null : (
                      <Text style={styles.cardSubtitle}>{entry.subtitle}</Text>
                    )}
                  </View>
                  {entry.comingSoon ? (
                    <Text style={styles.entryComingSoonBadge}>即将上线</Text>
                  ) : null}
                </View>

                {expanded && entry.key === "research" ? (
                  <View style={styles.formBlock}>
                    <TextInput
                      value={topic}
                      onChangeText={setTopic}
                      placeholder="比如:GLP-1 减肥药的争议 / 中东冲突最近三个月的演变"
                      placeholderTextColor={SHEET_INK_MUTED}
                      editable={!starting}
                      multiline
                      style={styles.topicInput}
                    />
                  </View>
                ) : null}

                {expanded && entry.key === "interest" ? (
                  <View style={styles.formBlock}>
                    <TextInput
                      value={interestDirection}
                      onChangeText={setInterestDirection}
                      placeholder="对什么方向感兴趣?(可留空,完全交给 AI)"
                      placeholderTextColor={SHEET_INK_MUTED}
                      editable={!starting}
                      style={styles.topicInput}
                    />
                  </View>
                ) : null}

                {expanded && entry.key === "book" ? (
                  <View style={styles.formBlock}>
                    <TextInput
                      value={bookTitle}
                      onChangeText={setBookTitle}
                      placeholder="书名 — 比如《穷查理宝典》/《活着》/ Sapiens"
                      placeholderTextColor={SHEET_INK_MUTED}
                      editable={!starting}
                      style={styles.topicInput}
                    />
                  </View>
                ) : null}

                {expanded && entry.key === "material" ? (
                  <View style={styles.formBlock}>
                    <TextInput
                      value={materialUrl}
                      onChangeText={setMaterialUrl}
                      placeholder="贴一个链接 — 比如一篇文章/论文/Wiki 页面"
                      placeholderTextColor={SHEET_INK_MUTED}
                      editable={!starting}
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={styles.topicInput}
                    />
                  </View>
                ) : null}

                {expanded && entry.key !== "interest" ? (
                  <View style={styles.formBlock}>
                    <Text style={styles.formLabel}>讲多长</Text>
                    <View style={styles.chipRow}>
                      {SECTION_PRESETS.map((preset) => {
                        const active = preset.id === sectionPreset;
                        return (
                          <Pressable
                            key={preset.id}
                            onPress={() => setSectionPreset(preset.id)}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                            style={({ pressed }) => [
                              styles.chip,
                              active && styles.chipActive,
                              pressed && styles.chipPressed
                            ]}
                          >
                            <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                              {preset.label}
                            </Text>
                            {preset.sub.length > 0 ? (
                              <Text style={[styles.chipMeta, active && styles.chipMetaActive]}>
                                {preset.sub}
                              </Text>
                            ) : null}
                          </Pressable>
                        );
                      })}
                    </View>

                    {sectionPreset === "custom" ? (
                      <View style={styles.customSectionsRow}>
                        <TextInput
                          value={customSectionsRaw}
                          onChangeText={(t) => setCustomSectionsRaw(t.replace(/[^0-9]/g, ""))}
                          placeholder="12"
                          placeholderTextColor={SHEET_INK_MUTED}
                          editable={!starting}
                          keyboardType="number-pad"
                          inputMode="numeric"
                          maxLength={3}
                          style={styles.customSectionsInput}
                        />
                        <Text style={styles.customSectionsSuffix}>节</Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </Pressable>
            );
          })}

          {error !== null ? (
            <Text style={styles.errorBody}>启动失败:{error}</Text>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              mode === "research"
                ? "开始调研"
                : mode === "book"
                  ? "开始精读"
                  : mode === "interest"
                    ? "让 AI 推荐"
                    : "开始读取链接"
            }
            disabled={!canStart}
            onPress={() => void handleStart()}
            style={({ pressed }) => [
              styles.startButton,
              !canStart && styles.startButtonDisabled,
              pressed && canStart && styles.startButtonPressed
            ]}
          >
            {starting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.startButtonText}>
                {mode === "research"
                  ? "开始调研"
                  : mode === "book"
                    ? "开始精读"
                    : mode === "interest"
                      ? "让 AI 推荐"
                      : "开始读取链接"}
              </Text>
            )}
          </Pressable>
        </View>
      </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    zIndex: 50
  },
  keyboardAvoid: {
    width: "100%",
    justifyContent: "flex-end"
  },
  backdropFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: SHEET_BACKDROP
  },
  backdropPressable: {
    ...StyleSheet.absoluteFillObject
  },
  sheet: {
    backgroundColor: SHEET_BG,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
    paddingBottom: 16,
    maxHeight: "92%"
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(17,17,17,0.18)",
    marginBottom: 8
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 20,
    paddingVertical: 8
  },
  headerTitleWrap: {
    flex: 1,
    paddingRight: 12
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: SHEET_INK
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(17,17,17,0.06)"
  },
  closeButtonPressed: {
    backgroundColor: "rgba(17,17,17,0.14)"
  },
  closeButtonText: {
    fontSize: 22,
    lineHeight: 24,
    color: SHEET_INK
  },
  scroll: {
    // flexGrow:0 让 ScrollView 高度等于内容高度,撑开 sheet。
    // flex:1 会让它 collapse(父没固定高度)→ sheet 只剩 header+footer 空壳。
    flexGrow: 0,
    flexShrink: 1,
    paddingHorizontal: 20
  },
  scrollContent: {
    paddingTop: 8,
    paddingBottom: 16
  },
  entryCard: {
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    backgroundColor: "#FFFFFF",
    gap: 14
  },
  entryCardPressed: {
    backgroundColor: "#F5F5F4"
  },
  entryCardExpanded: {
    borderColor: CARD_BORDER_ACTIVE,
    borderWidth: 1.5,
    backgroundColor: "#FAFAF8",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 16
  },
  entryCardComingSoon: {
    borderStyle: "dashed",
    backgroundColor: "transparent",
    opacity: 0.65
  },
  entryComingSoonBadge: {
    alignSelf: "flex-start",
    color: SHEET_INK_MUTED,
    fontSize: 11,
    fontWeight: "600",
    backgroundColor: "rgba(17,17,17,0.06)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: "hidden"
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12
  },
  cardIcon: {
    fontSize: 22,
    lineHeight: 26
  },
  cardHeaderText: {
    flex: 1
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: SHEET_INK
  },
  cardSubtitle: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 20,
    color: SHEET_INK_SECONDARY
  },
  formBlock: {
    gap: 8
  },
  formLabel: {
    color: SHEET_INK,
    fontSize: 13,
    fontWeight: "700"
  },
  topicInput: {
    minHeight: 64,
    maxHeight: 160,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: CARD_BORDER,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    lineHeight: 22,
    color: SHEET_INK,
    textAlignVertical: "top"
  },
  chipRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap"
  },
  chip: {
    flex: 1,
    minWidth: 84,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: SHEET_CHIP_BG,
    alignItems: "center",
    gap: 2
  },
  chipPressed: {
    opacity: 0.75
  },
  chipActive: {
    backgroundColor: SHEET_CHIP_BG_ACTIVE
  },
  chipLabel: {
    color: SHEET_INK,
    fontSize: 14,
    fontWeight: "700"
  },
  chipLabelActive: {
    color: SHEET_CHIP_TEXT_ACTIVE
  },
  chipMeta: {
    color: SHEET_INK_SECONDARY,
    fontSize: 11,
    fontWeight: "600"
  },
  chipMetaActive: {
    color: "rgba(255,255,255,0.85)"
  },
  customSectionsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    gap: 8
  },
  customSectionsInput: {
    width: 64,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: "#FFFFFF",
    color: SHEET_INK,
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center"
  },
  customSectionsSuffix: {
    color: SHEET_INK_SECONDARY,
    fontSize: 14,
    fontWeight: "600"
  },
  errorBody: {
    marginTop: 12,
    color: "#C9460C",
    fontSize: 13,
    lineHeight: 20
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
    borderTopWidth: 0.5,
    borderTopColor: "rgba(17,17,17,0.08)"
  },
  startButton: {
    backgroundColor: "#111111",
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center"
  },
  startButtonDisabled: {
    backgroundColor: "rgba(17,17,17,0.2)"
  },
  startButtonPressed: {
    backgroundColor: "#000000"
  },
  startButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700"
  }
});
