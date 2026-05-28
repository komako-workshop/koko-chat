import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";

import { useConversationStore, type ChatMessage } from "@/state/conversations";

import {
  closeDeeplyCourseSheet,
  useDeeplyCourseSheetState
} from "./courseSheetStore";
import {
  inferCourseBrief,
  lookupCachedCourseBrief
} from "./inferCourseBrief";
import type { DeeplyCourseBrief } from "./parseCourseBrief";
import type { DeeplyRecommendationCard } from "./parseRecommendations";
import { startDeeplyCourseSession, type SectionPreset } from "./courseSession";

const SHEET_BG = "#FFFFFF";
const SHEET_BACKDROP = "rgba(17,17,17,0.45)";
const SHEET_INK = "#1E293B";
const SHEET_INK_SECONDARY = "#475569";
const SHEET_INK_MUTED = "#94A3B8";
const SHEET_CHIP_BG = "#F1F5F2";
const SHEET_CHIP_BG_ACTIVE = "#111111";
const SHEET_CHIP_TEXT_ACTIVE = "#FFFFFF";
const SHEET_DANGER = "#C9460C";
const CARD_BORDER = "rgba(17,17,17,0.08)";

/**
 * 顶层挂载的 sheet bridge:订阅 useDeeplyCourseSheetStore,sheet 打开时
 * 把卡片信息传给真正的 sheet 组件。挂在 DeeplyExploreScreen 的 root 里。
 *
 * 不使用 RN `Modal`:Modal 会 portal 到根视图外,跳出 web demo 的 420/480
 * 手机框。我们直接用一个 absoluteFill overlay,确保 sheet 始终活在 demo
 * frame 内。
 */
export function DeeplyCourseSheetMount(): React.ReactElement | null {
  const { isOpen, card, conversationId } = useDeeplyCourseSheetState();

  if (!isOpen || card === null) return null;
  return (
    <CourseDetailSheet
      card={card}
      conversationId={conversationId}
      onClose={closeDeeplyCourseSheet}
    />
  );
}

interface CourseDetailSheetProps {
  card: DeeplyRecommendationCard;
  /** Conversation id (the explore chat that owns this card). Used to read transcript context. */
  conversationId: string | null;
  onClose: () => void;
}

/**
 * 推荐卡点击后弹出的 commit-gate 弹窗。
 *
 * 流程:
 *   1. mount → 调 inferCourseBrief 拿"详细介绍 + AI 出的选项"。
 *   2. brief 返回后渲染:介绍 + 长度 preset(自动/轻量/深度/自定义) + AI 出的 option chips + 「开始讲解」。
 *   3. 点击「开始讲解」→ 走 startDeeplyCourseSession,创建 deeply-course conversation,
 *      把当前配置写进 mini-app storage,然后跳过去。
 *
 * 渲染容器是 DeeplyExploreScreen root 里的 absoluteFill overlay,而不是
 * RN `Modal`,所以 sheet 永远在 demo frame 内。
 */
function CourseDetailSheet({
  card,
  conversationId,
  onClose
}: CourseDetailSheetProps): React.ReactElement {
  const transcriptMessages = useConversationStore((s) =>
    conversationId === null ? EMPTY_MESSAGES : s.messages[conversationId] ?? EMPTY_MESSAGES
  );

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [brief, setBrief] = useState<DeeplyCourseBrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 默认 "auto" = 不指定节数,让 outline prompt 自由拆。
  // 手动 preset 保持:轻量 8 / 深度 24 / 自定义。
  const [sectionPreset, setSectionPreset] = useState<SectionPreset>("auto");
  const [customSectionsRaw, setCustomSectionsRaw] = useState<string>("12");
  const [starting, setStarting] = useState(false);

  // Slide-up + backdrop fade 动画:mount 时从 0 推到 1,
  // 用户点关闭时反向跑一遍再 unmount。
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

  // Sheet 关闭时 store 会卸载组件,重开一定会再跑一次这个 effect。
  //
  // Cache 命中:同步把 cached brief 喂进去 → 立刻 ready,不发 LLM 请求。
  //  这条路径下用户会看到大约 1 帧的 loading state(useState 初值是 loading),
  //  16ms 基本无感,换来代码简单 + 跟原 async path 走一条 codepath 不分叉。
  //
  // Cache miss:走 inferCourseBrief async,返回后 setStatus + setBrief。
  //  inferCourseBrief 内部成功时会自动把结果写进 cache,下次再开同卡走 hit。
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setBrief(null);
    setError(null);
    setSectionPreset("auto");
    setCustomSectionsRaw("12");

    const cached = lookupCachedCourseBrief(card);
    if (cached !== null) {
      setBrief(cached);
      setStatus("ready");
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      const result = await inferCourseBrief({
        card,
        messages: transcriptMessages
      });
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error);
        setStatus("error");
        return;
      }
      setBrief(result.brief);
      setStatus("ready");
    })();
    return () => {
      cancelled = true;
    };
    // brief should refresh whenever the card identity changes, not on every
    // transcript update; the transcript value we use is the current one when
    // the effect actually runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.title, card.subtitle, card.kind]);

  const customSectionsNum = (() => {
    const n = Number(customSectionsRaw.trim());
    return Number.isFinite(n) ? Math.trunc(n) : NaN;
  })();
  const customSectionsValid =
    sectionPreset !== "custom" ? true : Number.isFinite(customSectionsNum) && customSectionsNum >= 1;

  const sections = (() => {
    switch (sectionPreset) {
      case "auto":
        return 0;
      case "light":
        return 8;
      case "deep":
        return 24;
      case "custom":
        return Number.isFinite(customSectionsNum) && customSectionsNum >= 1 ? customSectionsNum : 1;
      // legacy "standard" 从老 record 反序列化时可能出现:按 24 节兼容。
      case "standard":
      default:
        return 24;
    }
  })();

  const onStart = useCallback(async () => {
    if (brief === null || starting) return;
    if (!customSectionsValid) return;
    setStarting(true);
    try {
      await startDeeplyCourseSession({
        card,
        brief,
        sections,
        sectionPreset,
        optionChoices: {},
        parentConversationId: conversationId
      });
      handleClose();
    } catch (err) {
      console.error("[deeply] start course failed", err);
      setStarting(false);
    }
  }, [brief, card, conversationId, customSectionsValid, handleClose, sectionPreset, sections, starting]);

  const startButtonLabel =
    status !== "ready"
      ? "开始讲解"
      : sectionPreset === "auto"
        ? "开始讲解"
        : `开始讲解 · 约 ${sections} 节`;

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
      <KeyboardAvoidingView
        behavior="padding"
        style={styles.keyboardAvoid}
        pointerEvents="box-none"
      >
      <Animated.View style={[styles.sheet, { transform: [{ translateY: sheetTranslateY }] }]}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {card.title}
              </Text>
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                {card.subtitle.length > 0 ? card.subtitle : kindLabel(card.kind)}
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
          >
            {status === "loading" ? (
              <LoadingState />
            ) : status === "error" ? (
              <ErrorState
                message={error ?? "未知错误"}
                onRetry={handleClose}
              />
            ) : brief !== null ? (
              <ReadyState
                brief={brief}
                sections={sections}
                sectionPreset={sectionPreset}
                setSectionPreset={setSectionPreset}
                customSectionsRaw={customSectionsRaw}
                setCustomSectionsRaw={setCustomSectionsRaw}
              />
            ) : null}
          </ScrollView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="开始讲解"
            disabled={status !== "ready" || starting}
            onPress={() => void onStart()}
            style={({ pressed }) => [
              styles.startButton,
              (status !== "ready" || starting) && styles.startButtonDisabled,
              pressed && status === "ready" && !starting && styles.startButtonPressed
            ]}
          >
            {starting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.startButtonText}>
                {startButtonLabel}
              </Text>
            )}
          </Pressable>
        </View>
      </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

function LoadingState(): React.ReactElement {
  return (
    <View style={styles.loadingState}>
      <ActivityIndicator size="small" color={SHEET_INK_MUTED} />
      <Text style={styles.loadingText}>正在为你展开这门课的介绍…</Text>
    </View>
  );
}

function ErrorState({
  message,
  onRetry
}: {
  message: string;
  onRetry: () => void;
}): React.ReactElement {
  return (
    <View style={styles.errorState}>
      <Text style={styles.errorTitle}>展开失败</Text>
      <Text style={styles.errorBody}>{message}</Text>
      <Pressable onPress={onRetry} style={styles.errorRetry} hitSlop={8}>
        <Text style={styles.errorRetryText}>关闭重试</Text>
      </Pressable>
    </View>
  );
}

interface ReadyStateProps {
  brief: DeeplyCourseBrief;
  sections: number;
  sectionPreset: SectionPreset;
  setSectionPreset: (preset: SectionPreset) => void;
  customSectionsRaw: string;
  setCustomSectionsRaw: (value: string) => void;
}

interface SectionPresetCard {
  id: Exclude<SectionPreset, "standard">;
  label: string;
  sub: string;
}
const SECTION_PRESETS: SectionPresetCard[] = [
  { id: "auto", label: "自动", sub: "" },
  { id: "light", label: "轻量", sub: "约 8 节" },
  { id: "deep", label: "深度", sub: "约 24 节" },
  { id: "custom", label: "自定义", sub: "" }
];

function ReadyState({
  brief,
  sections,
  sectionPreset,
  setSectionPreset,
  customSectionsRaw,
  setCustomSectionsRaw
}: ReadyStateProps): React.ReactElement {
  return (
    <View>
      <Text style={styles.introduction}>{brief.introduction}</Text>

      <View style={styles.configBlock}>
        <Text style={styles.configLabel}>希望讲多少节</Text>
        <View style={styles.chipRow}>
          {SECTION_PRESETS.map((preset) => {
            const active = preset.id === sectionPreset;
            return (
              <Pressable
                key={preset.id}
                onPress={() => setSectionPreset(preset.id)}
                style={({ pressed }) => [
                  styles.chip,
                  active && styles.chipActive,
                  pressed && styles.chipPressed
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={preset.sub.length > 0 ? `${preset.label} ${preset.sub}` : preset.label}
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
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={3}
              style={styles.customSectionsInput}
            />
            <Text style={styles.customSectionsSuffix}>节</Text>
          </View>
        ) : sectionPreset === "auto" ? null : (
          <Text style={styles.configHint}>当前选择:约 {sections} 节</Text>
        )}
      </View>
    </View>
  );
}

const EMPTY_MESSAGES: ChatMessage[] = [];

function kindLabel(kind: string): string {
  switch (kind) {
    case "book":
      return "书";
    case "person":
      return "思想家";
    case "theory":
      return "理论";
    case "topic":
    default:
      return "课题";
  }
}

const SHEET_TRANSLATE_INITIAL = 540;

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
    // maxHeight 88%(留 12% 让 list 把被点击的卡片 reveal 出来)。
    // DeeplyExploreScreen 里的 COURSE_SHEET_MAX_HEIGHT_RATIO 必须跟这个值
    // 同步,否则 sheet-reveal 的 scroll 计算会偏。
    //
    // sheet 高度由 children 内容决定。Loading 时 LoadingState 自己撑了一个
    // 较大的 minHeight(见 styles.loadingState),让 sheet 一弹出就接近 ready
    // 状态的高度,避免 brief 加载完成那一刻 sheet "蹦"高。
    maxHeight: "88%"
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
    alignItems: "center",
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
    marginTop: 2,
    fontSize: 13,
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
    paddingTop: 4,
    paddingBottom: 8
  },
  loadingState: {
    // 把 ScrollView 的内容撑到一个比单行 spinner 大不少的高度,让 sheet
    // 一弹出就接近 ready 状态的高度,brief 到位时不会"蹦高"。240pt 大约
    // 是 ready-state introduction 的下半截高度,sheet 总高比之前提升
    // ~150pt(约 2-3cm)。spinner + 文字在该区块内居中。
    minHeight: 240,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 4
  },
  loadingText: {
    color: SHEET_INK_SECONDARY,
    fontSize: 14
  },
  errorState: {
    paddingVertical: 24,
    gap: 10
  },
  errorTitle: {
    color: SHEET_DANGER,
    fontSize: 15,
    fontWeight: "700"
  },
  errorBody: {
    color: SHEET_INK_SECONDARY,
    fontSize: 14,
    lineHeight: 22
  },
  errorRetry: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: SHEET_CHIP_BG
  },
  errorRetryText: {
    color: SHEET_INK,
    fontSize: 13,
    fontWeight: "600"
  },
  introduction: {
    color: SHEET_INK_SECONDARY,
    fontSize: 15,
    lineHeight: 26
  },
  configBlock: {
    marginTop: 22
  },
  configLabel: {
    color: SHEET_INK,
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 4
  },
  configSubtle: {
    color: SHEET_INK_MUTED,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 8
  },
  configHint: {
    color: SHEET_INK_MUTED,
    fontSize: 12,
    marginTop: 6
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
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: SHEET_CHIP_BG,
    alignItems: "center",
    gap: 2
  },
  chipPressed: {
    opacity: 0.7
  },
  chipActive: {
    backgroundColor: SHEET_CHIP_BG_ACTIVE
  },
  chipLabel: {
    color: SHEET_INK,
    fontSize: 14,
    fontWeight: "600"
  },
  chipLabelActive: {
    color: SHEET_CHIP_TEXT_ACTIVE
  },
  chipMeta: {
    color: SHEET_INK_MUTED,
    fontSize: 11
  },
  chipMetaActive: {
    color: "rgba(255,255,255,0.75)"
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
