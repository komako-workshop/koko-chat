import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
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
import { useGatewayStore, type OpenClawChatAttachment } from "@/state/gateway";
import {
  startDeeplyMaterialCourse,
  startDeeplyResearchCourse
} from "./courseSession";

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

type SectionPreset = "light" | "standard" | "deep";
type CustomizeMode = "research" | "material";

const SECTION_PRESETS: { id: SectionPreset; label: string; sections: number; hint: string }[] = [
  { id: "light", label: "轻量", sections: 12, hint: "通勤路上能听完" },
  { id: "standard", label: "标准", sections: 24, hint: "一个周末沉下心" },
  { id: "deep", label: "深度", sections: 36, hint: "想把它学透" }
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
 * "定制课程" 入口弹窗。当前只放了「深度调研一个主题」一张实卡,旁边给两张
 * 占位卡示意"更多入口陆续上线"(基于你的兴趣 / 从一本书入门 / 解开一个困惑)。
 *
 * 后续 phase 把占位卡换成可选实卡时,会改成"卡片二选一 → 展开对应表单"
 * 形态(类似 iOS 系统弹窗的 selection group)。这里 phase A 只有一张实卡,
 * 输入区直接挂在卡下面,不做选中态切换。
 */
function CourseCustomizeSheet({
  conversationId,
  onClose
}: CourseCustomizeSheetProps): React.ReactElement {
  const prepareFileAttachments = useGatewayStore((s) => s.prepareFileAttachments);
  const [mode, setMode] = useState<CustomizeMode>("research");
  const [topic, setTopic] = useState("");
  const [materialUrl, setMaterialUrl] = useState("");
  const [materialFiles, setMaterialFiles] = useState<File[]>([]);
  const [sectionPreset, setSectionPreset] = useState<SectionPreset>("standard");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const hasMaterial = materialUrlTrimmed.length > 0 || materialFiles.length > 0;
  const canStart =
    !starting &&
    (mode === "research" ? trimmed.length >= 2 : hasMaterial);

  const handleStart = useCallback(async () => {
    if (!canStart) return;
    setStarting(true);
    setError(null);
    try {
      const preset = SECTION_PRESETS.find((p) => p.id === sectionPreset);
      const sections = preset?.sections ?? 24;
      if (mode === "research") {
        await startDeeplyResearchCourse({
          topic: trimmed,
          sectionPreset,
          sections,
          parentConversationId: conversationId
        });
      } else {
        let attachments: OpenClawChatAttachment[] = [];
        if (materialFiles.length > 0) {
          attachments = await prepareFileAttachments(materialFiles);
        }
        const label = materialUrlTrimmed.length > 0
          ? materialUrlTrimmed
          : materialFiles.map((f) => f.name).join("、");
        await startDeeplyMaterialCourse({
          label,
          sourceKind: materialUrlTrimmed.length > 0 ? "url" : "file",
          ...(materialUrlTrimmed.length > 0 ? { url: materialUrlTrimmed } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
          sectionPreset,
          sections,
          parentConversationId: conversationId
        });
      }
      handleClose();
    } catch (err) {
      console.error("[deeply] start research course failed", err);
      setError(err instanceof Error ? err.message : String(err));
      setStarting(false);
    }
  }, [
    canStart,
    conversationId,
    handleClose,
    materialFiles,
    materialUrlTrimmed,
    mode,
    sectionPreset,
    trimmed,
    prepareFileAttachments
  ]);

  const handlePickFiles = useCallback(() => {
    if (typeof document === "undefined") {
      setError("当前移动端文件选择还没接 expo-document-picker；先用链接或 Web 端上传文件。");
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = () => {
      setMaterialFiles(Array.from(input.files ?? []));
    };
    input.click();
  }, []);

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
      <Animated.View style={[styles.sheet, { transform: [{ translateY: sheetTranslateY }] }]}>
        <View style={styles.grabber} />
        <View style={styles.header}>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>定制课程</Text>
            <Text style={styles.headerSubtitle}>
              告诉我你想学什么,我来定一份课。
            </Text>
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

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.modeGrid}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: mode === "research" }}
              onPress={() => setMode("research")}
              style={({ pressed }) => [
                styles.modeCard,
                mode === "research" && styles.modeCardActive,
                pressed && styles.modeCardPressed
              ]}
            >
              <Text style={styles.modeIcon}>🔍</Text>
              <Text style={styles.modeTitle}>深度调研</Text>
              <Text style={styles.modeSubtitle}>围绕主题搜资料定课</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: mode === "material" }}
              onPress={() => setMode("material")}
              style={({ pressed }) => [
                styles.modeCard,
                mode === "material" && styles.modeCardActive,
                pressed && styles.modeCardPressed
              ]}
            >
              <Text style={styles.modeIcon}>📎</Text>
              <Text style={styles.modeTitle}>基于你的资料</Text>
              <Text style={styles.modeSubtitle}>链接或本地文件</Text>
            </Pressable>
          </View>

          <View style={styles.activeCard}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardIcon}>{mode === "research" ? "🔍" : "📎"}</Text>
              <View style={styles.cardHeaderText}>
                <Text style={styles.cardTitle}>
                  {mode === "research" ? "深度调研一个主题" : "基于你的资料"}
                </Text>
                <Text style={styles.cardSubtitle}>
                  {mode === "research"
                    ? "我会先去做调研,综合多方资料后再为你定一份带引用的课程"
                    : "贴一个链接,或选择本地文件,我会把它交给 OpenClaw 读成课程"}
                </Text>
              </View>
            </View>

            {mode === "research" ? (
              <View style={styles.formBlock}>
                <Text style={styles.formLabel}>主题</Text>
                <TextInput
                  value={topic}
                  onChangeText={setTopic}
                  placeholder="比如:GLP-1 减肥药的争议 / 中东冲突最近三个月的演变"
                  placeholderTextColor={SHEET_INK_MUTED}
                  editable={!starting}
                  multiline
                  style={styles.topicInput}
                />
                <Text style={styles.formHint}>
                  越具体越好。带时间范围 / 视角 / 想解决的问题,调研质量会高很多。
                </Text>
              </View>
            ) : (
              <View style={styles.formBlock}>
                <Text style={styles.formLabel}>资料链接</Text>
                <TextInput
                  value={materialUrl}
                  onChangeText={setMaterialUrl}
                  placeholder="https://example.com/article 或留空只上传文件"
                  placeholderTextColor={SHEET_INK_MUTED}
                  editable={!starting}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.topicInput}
                />
                <Pressable
                  accessibilityRole="button"
                  onPress={handlePickFiles}
                  disabled={starting}
                  style={({ pressed }) => [
                    styles.fileButton,
                    pressed && styles.fileButtonPressed
                  ]}
                >
                  <Text style={styles.fileButtonText}>
                    {materialFiles.length === 0
                      ? "选择本地文件"
                      : `已选择 ${materialFiles.length} 个文件`}
                  </Text>
                </Pressable>
                {materialFiles.length > 0 ? (
                  <Text style={styles.formHint} numberOfLines={2}>
                    {materialFiles.map((f) => f.name).join("、")}
                  </Text>
                ) : (
                  <Text style={styles.formHint}>
                    文件会先上传到 OpenClaw Gateway,agent 会拿到 MEDIA 路径后读取/解析。
                  </Text>
                )}
              </View>
            )}

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
                      <Text style={[styles.chipMeta, active && styles.chipMetaActive]}>
                        约 {preset.sections} 节
                      </Text>
                      <Text style={[styles.chipHint, active && styles.chipHintActive]}>
                        {preset.hint}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>

          <Text style={styles.comingSoonLabel}>更多入口陆续上线</Text>
          <View style={styles.ghostCard}>
            <Text style={styles.ghostIcon}>📚</Text>
            <View style={styles.ghostBody}>
              <Text style={styles.ghostTitle}>从一本书入门</Text>
              <Text style={styles.ghostSubtitle}>
                给一本书,agent 把它拆成 N 节精读
              </Text>
            </View>
          </View>
          <View style={styles.ghostCard}>
            <Text style={styles.ghostIcon}>💡</Text>
            <View style={styles.ghostBody}>
              <Text style={styles.ghostTitle}>基于你的兴趣</Text>
              <Text style={styles.ghostSubtitle}>
                从你的对话画像里挑你大概率会喜欢的方向
              </Text>
            </View>
          </View>
          {error !== null ? (
            <Text style={styles.errorBody}>启动失败:{error}</Text>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={mode === "research" ? "开始调研" : "开始读取资料"}
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
                {mode === "research" ? "开始调研" : "开始读取资料"}
              </Text>
            )}
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    zIndex: 50
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
  headerSubtitle: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 20,
    color: SHEET_INK_MUTED
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
    flexGrow: 0,
    paddingHorizontal: 20
  },
  scrollContent: {
    paddingTop: 8,
    paddingBottom: 16
  },
  modeGrid: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 12
  },
  modeCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "#FFFFFF"
  },
  modeCardActive: {
    borderColor: CARD_BORDER_ACTIVE,
    backgroundColor: "#FAFAF8"
  },
  modeCardPressed: {
    opacity: 0.75
  },
  modeIcon: {
    fontSize: 18,
    lineHeight: 22,
    marginBottom: 6
  },
  modeTitle: {
    color: SHEET_INK,
    fontSize: 13,
    fontWeight: "700"
  },
  modeSubtitle: {
    marginTop: 2,
    color: SHEET_INK_MUTED,
    fontSize: 11,
    lineHeight: 16
  },
  activeCard: {
    borderWidth: 1.5,
    borderColor: CARD_BORDER_ACTIVE,
    borderRadius: 18,
    padding: 16,
    backgroundColor: "#FAFAF8",
    gap: 16
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
  formHint: {
    color: SHEET_INK_MUTED,
    fontSize: 12,
    lineHeight: 18
  },
  fileButton: {
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: SHEET_CHIP_BG_ACTIVE,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  fileButtonPressed: {
    opacity: 0.8
  },
  fileButtonText: {
    color: SHEET_CHIP_TEXT_ACTIVE,
    fontSize: 13,
    fontWeight: "700"
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
  chipHint: {
    color: SHEET_INK_MUTED,
    fontSize: 10
  },
  chipHintActive: {
    color: "rgba(255,255,255,0.6)"
  },
  comingSoonLabel: {
    marginTop: 22,
    marginBottom: 8,
    fontSize: 12,
    fontWeight: "600",
    color: SHEET_INK_MUTED,
    letterSpacing: 0.4,
    textTransform: "uppercase"
  },
  ghostCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderStyle: "dashed",
    marginBottom: 8,
    opacity: 0.55
  },
  ghostIcon: {
    fontSize: 18,
    lineHeight: 22
  },
  ghostBody: {
    flex: 1
  },
  ghostTitle: {
    color: SHEET_INK,
    fontSize: 14,
    fontWeight: "600"
  },
  ghostSubtitle: {
    color: SHEET_INK_MUTED,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2
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
