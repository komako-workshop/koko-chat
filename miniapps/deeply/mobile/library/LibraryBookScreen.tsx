import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { useRouter } from "expo-router";

import { BookCoverImage } from "./BookCoverImage";
import { startDeeplyLibraryCourse, type SectionPreset } from "../courseSession";
import {
  getBookById,
  parseRelationString,
  type LibraryBook,
  type LibraryEdge
} from "./libraryData";
import {
  LIBRARY_ACCENT,
  LIBRARY_BG,
  LIBRARY_INK,
  LIBRARY_INK_2,
  LIBRARY_INK_3,
  LIBRARY_LINE,
  LIBRARY_WARM_100,
  LIBRARY_WARM_50,
  getCategoryStyle
} from "./libraryTheme";

interface Props {
  bookId: string;
}

interface PresetCard {
  id: Exclude<SectionPreset, "standard">;
  label: string;
  sub: string;
}
const SECTION_PRESETS: PresetCard[] = [
  { id: "auto", label: "自动", sub: "AI 决定" },
  { id: "light", label: "轻量", sub: "约 8 节" },
  { id: "deep", label: "深度", sub: "约 24 节" },
  { id: "custom", label: "自定义", sub: "你来定节数" }
];

type FetchStatus = "loading" | "ready" | "error" | "not_found";

/**
 * 单本课程详情页 — 数据走 server (`/library/books/:id`)。
 * book.p / book.e / book.ue / book.de 都是 server 端按需返回的完整字段;
 * 列表 API 不带这些。
 */
export function LibraryBookScreen({ bookId }: Props): React.ReactElement {
  const router = useRouter();
  const [book, setBook] = useState<LibraryBook | null>(null);
  const [status, setStatus] = useState<FetchStatus>("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setBook(null);
    setErrorMsg("");
    (async () => {
      try {
        const data = await getBookById(bookId);
        if (cancelled) return;
        if (data === null) {
          setStatus("not_found");
        } else {
          setBook(data);
          setStatus("ready");
        }
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId, reloadKey]);

  const [starting, setStarting] = useState(false);
  const [sectionPreset, setSectionPreset] = useState<SectionPreset>("auto");
  const [customSectionsRaw, setCustomSectionsRaw] = useState<string>("12");

  const customSectionsNum = (() => {
    const n = Number(customSectionsRaw.trim());
    return Number.isFinite(n) ? Math.trunc(n) : NaN;
  })();
  const customSectionsValid =
    sectionPreset !== "custom"
      ? true
      : Number.isFinite(customSectionsNum) && customSectionsNum >= 1;

  const onStart = useCallback(async () => {
    if (book === null || starting) return;
    if (!customSectionsValid) return;
    setStarting(true);
    const sections =
      sectionPreset === "auto"
        ? 0
        : sectionPreset === "light"
          ? 8
          : sectionPreset === "deep"
            ? 24
            : customSectionsNum;
    try {
      await startDeeplyLibraryCourse({
        bookId: book.id,
        title: book.t,
        author: book.a,
        category: book.c,
        hook: book.h,
        pitch: book.p ?? "",
        sections,
        parentConversationId: null
      });
    } catch (err) {
      console.error("[deeply-library] start course failed", err);
      setStarting(false);
    }
  }, [book, starting, sectionPreset, customSectionsNum, customSectionsValid]);

  const handleRelationPress = useCallback(
    (relatedId: string) => {
      router.push(`/deeply/library/b/${encodeURIComponent(relatedId)}`);
    },
    [router]
  );

  if (status === "loading") {
    return (
      <View style={styles.notFoundRoot}>
        <ActivityIndicator color={LIBRARY_INK_3} />
      </View>
    );
  }
  if (status === "not_found") {
    return (
      <View style={styles.notFoundRoot}>
        <Text style={styles.notFoundText}>这本书不存在或已下架</Text>
      </View>
    );
  }
  if (status === "error" || book === null) {
    return (
      <View style={styles.notFoundRoot}>
        <Text style={styles.notFoundTitle}>加载失败</Text>
        <Text style={styles.notFoundText}>{errorMsg}</Text>
        <Pressable
          onPress={() => setReloadKey((k) => k + 1)}
          style={({ pressed }) => [styles.retry, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.retryText}>重试</Text>
        </Pressable>
      </View>
    );
  }

  const catStyle = getCategoryStyle(book.c);
  const pitch = book.p ?? "";
  const echo = book.e ?? "";
  const ue = book.ue ?? [];
  const de = book.de ?? [];
  const legacyU = book.u ?? [];
  const legacyDw = book.dw ?? [];

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brandBlock}>
          <Text style={styles.brandLogo}>Deeply</Text>
          {book.h.length > 0 ? (
            <Text style={styles.brandTagline} numberOfLines={2}>
              {book.h}
            </Text>
          ) : null}
        </View>

        <View style={styles.bookLine}>
          <BookCoverImage imgUrl={book.img} title={book.t} category={book.c} size="s" />
          <View style={styles.bookLineInfo}>
            <Text style={styles.bookLineTitle} numberOfLines={2}>
              {book.t}
            </Text>
            <Text style={styles.bookLineAuthor} numberOfLines={1}>
              {book.a}
            </Text>
            <View style={styles.bookLineTagWrap}>
              <Text style={styles.bookLineTag}>{book.c}</Text>
            </View>
          </View>
        </View>

        {pitch.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.pitchText}>{pitch}</Text>
          </View>
        ) : null}

        {echo.length > 0 ? (
          <View style={styles.echoCard}>
            <Text style={styles.echoTag}>TODAY'S ECHO</Text>
            <Text style={styles.echoText}>{echo}</Text>
          </View>
        ) : null}

        <View style={styles.ctaBlock}>
          <Text style={styles.presetLabel}>讲多长</Text>
          <View style={styles.presetRow}>
            {SECTION_PRESETS.map((preset) => {
              const active = preset.id === sectionPreset;
              return (
                <Pressable
                  key={preset.id}
                  onPress={() => setSectionPreset(preset.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [
                    styles.presetChip,
                    active && styles.presetChipActive,
                    pressed && styles.presetChipPressed
                  ]}
                >
                  <Text style={[styles.presetChipLabel, active && styles.presetChipLabelActive]}>
                    {preset.label}
                  </Text>
                  <Text style={[styles.presetChipMeta, active && styles.presetChipMetaActive]}>
                    {preset.sub}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {sectionPreset === "auto" ? (
            <Text style={styles.presetHint}>
              AI 看完资料后,根据这本书的内容自然决定节数。
            </Text>
          ) : null}

          {sectionPreset === "custom" ? (
            <View style={styles.customRow}>
              <TextInput
                value={customSectionsRaw}
                onChangeText={(t) => setCustomSectionsRaw(t.replace(/[^0-9]/g, ""))}
                placeholder="12"
                placeholderTextColor={LIBRARY_INK_3}
                keyboardType="number-pad"
                inputMode="numeric"
                maxLength={3}
                style={styles.customInput}
              />
              <Text style={styles.customSuffix}>节</Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="开始学习"
            disabled={starting || !customSectionsValid}
            onPress={() => void onStart()}
            style={({ pressed }) => [
              styles.cta,
              (starting || !customSectionsValid) && styles.ctaDisabled,
              pressed && !starting && customSectionsValid && styles.ctaPressed
            ]}
          >
            <Text style={styles.ctaText}>
              {starting ? "正在准备..." : "开始学习"}
            </Text>
          </Pressable>
        </View>

        {(() => {
          const useEdgeData = ue.length > 0 || de.length > 0;
          const hasLegacy = legacyU.length > 0 || legacyDw.length > 0;
          if (!useEdgeData && !hasLegacy) return null;
          return (
            <View style={styles.graph}>
              <Text style={styles.graphTitle}>知识谱系</Text>
              <Text style={styles.graphSub}>这本书在思想长河里的位置</Text>

              {useEdgeData ? (
                <>
                  {ue.length > 0 ? (
                    <EdgeGraphSection
                      arrow="←"
                      label="这本书继承自"
                      edges={ue}
                      catColor={catStyle.colorStart}
                      onPressRelated={handleRelationPress}
                    />
                  ) : null}
                  {de.length > 0 ? (
                    <EdgeGraphSection
                      arrow="→"
                      label="这本书启发了"
                      edges={de}
                      catColor={catStyle.colorStart}
                      onPressRelated={handleRelationPress}
                    />
                  ) : null}
                </>
              ) : (
                <>
                  {legacyU.length > 0 ? (
                    <LegacyGraphSection
                      arrow="←"
                      label="这本书继承自"
                      items={legacyU}
                      catColor={catStyle.colorStart}
                    />
                  ) : null}
                  {legacyDw.length > 0 ? (
                    <LegacyGraphSection
                      arrow="→"
                      label="这本书启发了"
                      items={legacyDw}
                      catColor={catStyle.colorStart}
                    />
                  ) : null}
                </>
              )}
            </View>
          );
        })()}

        <View style={styles.footerSpacer} />
      </ScrollView>
    </View>
  );
}

const REL_LABEL: Record<LibraryEdge["rel"], string> = {
  inherit: "继承",
  inspire: "启发",
  respond: "回应",
  critique: "批评",
  transform: "改造",
  synthesize: "综合"
};

function EdgeGraphSection({
  arrow,
  label,
  edges,
  catColor,
  onPressRelated
}: {
  arrow: string;
  label: string;
  edges: LibraryEdge[];
  catColor: string;
  onPressRelated: (relatedId: string) => void;
}): React.ReactElement {
  return (
    <View style={styles.graphSection}>
      <Text style={styles.graphSectionLabel}>
        <Text style={styles.graphArrow}>{arrow} </Text>
        {label}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.graphCardsRow}
      >
        {edges.map((edge, idx) => (
          <EdgeCard
            key={`${idx}-${edge.t}`}
            edge={edge}
            catColor={catColor}
            onPressRelated={onPressRelated}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function EdgeCard({
  edge,
  catColor,
  onPressRelated
}: {
  edge: LibraryEdge;
  catColor: string;
  onPressRelated: (relatedId: string) => void;
}): React.ReactElement {
  // edge.img 由 server 端 inline,直接显示;没有就用本书分类色块 fallback。
  const hasImg = typeof edge.img === "string" && edge.img.length > 0;
  const cardContent = (
    <>
      <View style={styles.edgeCoverWrap}>
        {hasImg ? (
          <BookCoverImage imgUrl={edge.img!} title={edge.t} category="" size="xs" />
        ) : (
          <View style={[styles.relMiniCoverFallback, { backgroundColor: catColor }]}>
            <Text style={styles.relMiniCoverText} numberOfLines={3}>
              {edge.t}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.edgeMeta}>
        <View style={styles.edgeRelChipWrap}>
          <Text style={styles.edgeRelChip}>{REL_LABEL[edge.rel]}</Text>
        </View>
        <Text style={styles.relTitle} numberOfLines={2}>
          {edge.t}
        </Text>
        <Text style={styles.relAuthor} numberOfLines={1}>
          {edge.a}
        </Text>
      </View>
    </>
  );

  if (edge.pid === undefined) {
    return <View style={[styles.relCard, styles.relCardDisabled]}>{cardContent}</View>;
  }
  return (
    <Pressable
      onPress={() => onPressRelated(edge.pid!)}
      accessibilityRole="button"
      accessibilityLabel={`打开:${edge.t}`}
      style={({ pressed }) => [styles.relCard, pressed && styles.relCardPressed]}
    >
      {cardContent}
    </Pressable>
  );
}

/**
 * Legacy u / dw 字符串 fallback。客户端不再 fuzzy match(没全量 pool),
 * 直接显示色块 + 标题作者文本,不可点。绝大多数书都有 ue/de,这条 fallback
 * 实际上极少走到。
 */
function LegacyGraphSection({
  arrow,
  label,
  items,
  catColor
}: {
  arrow: string;
  label: string;
  items: string[];
  catColor: string;
}): React.ReactElement {
  return (
    <View style={styles.graphSection}>
      <Text style={styles.graphSectionLabel}>
        <Text style={styles.graphArrow}>{arrow} </Text>
        {label}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.graphCardsRow}
      >
        {items.map((item, idx) => {
          const { title, author } = parseRelationString(item);
          return (
            <View key={`${idx}-${item}`} style={[styles.relCard, styles.relCardDisabled]}>
              <View style={[styles.relMiniCoverFallback, { backgroundColor: catColor }]}>
                <Text style={styles.relMiniCoverText} numberOfLines={3}>
                  {title}
                </Text>
              </View>
              <View style={styles.relMeta}>
                <Text style={styles.relTitle} numberOfLines={2}>
                  {title}
                </Text>
                {author.length > 0 ? (
                  <Text style={styles.relAuthor} numberOfLines={1}>
                    {author}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: LIBRARY_BG },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 60 },

  notFoundRoot: {
    flex: 1,
    backgroundColor: LIBRARY_BG,
    justifyContent: "center",
    alignItems: "center",
    padding: 24
  },
  notFoundTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: LIBRARY_INK,
    marginBottom: 6
  },
  notFoundText: {
    fontSize: 13,
    color: LIBRARY_INK_2,
    textAlign: "center"
  },
  retry: {
    marginTop: 16,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: LIBRARY_INK,
    borderRadius: 999
  },
  retryText: { color: "#FFFFFF", fontWeight: "700" },

  brandBlock: {
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 8,
    alignItems: "center"
  },
  brandLogo: {
    fontSize: 32,
    fontWeight: "700",
    color: LIBRARY_INK,
    letterSpacing: -0.5,
    fontFamily: "serif"
  },
  brandTagline: {
    fontSize: 14,
    color: LIBRARY_INK,
    fontWeight: "700",
    marginTop: 8,
    textAlign: "center",
    fontFamily: "serif",
    lineHeight: 20
  },

  bookLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 6
  },
  bookLineInfo: {
    flex: 1,
    minWidth: 0
  },
  bookLineTitle: {
    fontSize: 19,
    fontWeight: "700",
    color: LIBRARY_INK,
    letterSpacing: -0.3,
    fontFamily: "serif",
    lineHeight: 25
  },
  bookLineAuthor: {
    fontSize: 13,
    color: LIBRARY_INK_2,
    marginTop: 4
  },
  bookLineTagWrap: {
    marginTop: 8,
    alignSelf: "flex-start"
  },
  bookLineTag: {
    fontSize: 12,
    color: LIBRARY_INK_3,
    paddingHorizontal: 9,
    paddingVertical: 3,
    backgroundColor: LIBRARY_WARM_100,
    borderRadius: 999,
    overflow: "hidden"
  },

  section: {
    paddingHorizontal: 22,
    paddingVertical: 14
  },
  pitchText: {
    fontSize: 14,
    color: LIBRARY_INK,
    lineHeight: 26,
    fontFamily: "serif"
  },

  echoCard: {
    marginHorizontal: 22,
    marginTop: 4,
    marginBottom: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "#FAF3E0",
    borderLeftWidth: 3,
    borderLeftColor: "#C9A24D",
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8
  },
  echoTag: {
    fontSize: 10,
    fontWeight: "700",
    color: "#8C6A2E",
    letterSpacing: 1.5,
    marginBottom: 4
  },
  echoText: {
    fontSize: 13,
    color: LIBRARY_INK,
    lineHeight: 21,
    fontFamily: "serif"
  },

  ctaBlock: {
    paddingHorizontal: 22,
    paddingTop: 6,
    paddingBottom: 28
  },
  presetLabel: {
    fontSize: 12,
    color: LIBRARY_INK_3,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginBottom: 8,
    textTransform: "uppercase"
  },
  presetRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 6
  },
  presetChip: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: LIBRARY_WARM_100,
    alignItems: "center",
    gap: 2
  },
  presetChipPressed: { opacity: 0.75 },
  presetChipActive: { backgroundColor: LIBRARY_ACCENT },
  presetChipLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: LIBRARY_INK
  },
  presetChipLabelActive: {
    color: "#FFFFFF"
  },
  presetChipMeta: {
    fontSize: 10,
    fontWeight: "600",
    color: LIBRARY_INK_2
  },
  presetChipMetaActive: {
    color: "rgba(255,255,255,0.85)"
  },
  presetHint: {
    fontSize: 12,
    color: LIBRARY_INK_2,
    lineHeight: 18,
    marginTop: 8
  },
  customRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    gap: 8
  },
  customInput: {
    width: 64,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: LIBRARY_LINE,
    backgroundColor: "#FFFFFF",
    color: LIBRARY_INK,
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center"
  },
  customSuffix: {
    color: LIBRARY_INK_2,
    fontSize: 14,
    fontWeight: "600"
  },
  cta: {
    backgroundColor: LIBRARY_ACCENT,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 16
  },
  ctaDisabled: {
    opacity: 0.5
  },
  ctaPressed: {
    opacity: 0.85
  },
  ctaText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 1,
    fontFamily: "serif"
  },

  graph: {
    paddingTop: 24,
    paddingBottom: 12,
    backgroundColor: LIBRARY_WARM_50,
    borderTopWidth: 1,
    borderTopColor: LIBRARY_LINE
  },
  graphTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: LIBRARY_INK,
    paddingHorizontal: 22,
    fontFamily: "serif",
    letterSpacing: -0.2
  },
  graphSub: {
    fontSize: 12,
    color: LIBRARY_INK_2,
    paddingHorizontal: 22,
    paddingTop: 4,
    paddingBottom: 14,
    fontFamily: "serif",
    lineHeight: 19
  },

  graphSection: {
    marginBottom: 18
  },
  graphSectionLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: LIBRARY_INK,
    paddingHorizontal: 22,
    paddingTop: 6,
    paddingBottom: 10,
    fontFamily: "serif"
  },
  graphArrow: {
    fontSize: 16,
    color: LIBRARY_INK_2,
    fontWeight: "400"
  },
  graphCardsRow: {
    gap: 10,
    paddingHorizontal: 22,
    paddingBottom: 14
  },

  relCard: {
    width: 220,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: LIBRARY_LINE,
    borderRadius: 12,
    padding: 12,
    flexDirection: "row",
    gap: 10
  },
  relCardPressed: {
    backgroundColor: "#FBFAF7"
  },
  relCardDisabled: {
    opacity: 0.55
  },
  edgeCoverWrap: {
    flex: 0,
    alignSelf: "flex-start"
  },
  edgeMeta: {
    flex: 1,
    minWidth: 0
  },
  edgeRelChipWrap: {
    marginBottom: 6
  },
  edgeRelChip: {
    fontSize: 10,
    fontWeight: "700",
    color: LIBRARY_INK_2,
    paddingHorizontal: 7,
    paddingVertical: 2,
    backgroundColor: LIBRARY_WARM_100,
    borderRadius: 4,
    alignSelf: "flex-start",
    overflow: "hidden",
    letterSpacing: 0.5
  },
  relMiniCoverFallback: {
    width: 50,
    height: 70,
    borderRadius: 4,
    padding: 6,
    justifyContent: "flex-end"
  },
  relMiniCoverText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "700",
    lineHeight: 11
  },
  relMeta: {
    flex: 1,
    minWidth: 0
  },
  relTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: LIBRARY_INK,
    lineHeight: 17,
    marginBottom: 3,
    fontFamily: "serif"
  },
  relAuthor: {
    fontSize: 10,
    color: LIBRARY_INK_3
  },

  footerSpacer: {
    height: 8
  }
});

