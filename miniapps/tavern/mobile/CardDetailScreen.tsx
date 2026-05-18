/**
 * Tavern Card detail screen: shown when the user taps a card in the
 * browse grid. Renders the bundled-in description and a preview of the
 * Chinese first_mes so the user can decide whether to start a chat
 * *before* a conversation is created.
 *
 * Data source: a single card object passed in via route params (encoded
 * as the URL-encoded `path`). We look it up from `browse-data.json`
 * synchronously — no network calls at all.
 */
import { useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";

import { CachedImage } from "@/components/CachedImage";
import { KokoColors, KokoRadius } from "@/theme/koko";

import { startTavernRoleplaySession } from "../../tavern-roleplay/mobile";
import browseData from "./assets/browse-data.json";

interface BrowseCard {
  path: string;
  pageUrl: string;
  imageUrl: string;
  name: string;
  inChatName: string;
  tagline: string;
  tags: string[];
  isNSFW: boolean;
  likes: number;
  downloads: number;
  description?: string;
  personality?: string;
  scenario?: string;
  firstMessage?: string;
  nameZh?: string;
  taglineZh?: string;
  tagsZh?: string[];
  descriptionZh?: string;
  firstMessageZh?: string;
}

interface BrowseData {
  categories: Array<{ id: string; labelZh: string; cards: BrowseCard[] }>;
}

const DATA = browseData as BrowseData;

function findCard(path: string): BrowseCard | null {
  for (const cat of DATA.categories) {
    for (const card of cat.cards) {
      if (card.path === path) return card;
    }
  }
  return null;
}

export function TavernCardDetailScreen({ path }: { path: string }): React.ReactElement {
  const card = useMemo(() => findCard(path), [path]);
  const [busy, setBusy] = useState(false);

  if (card === null) {
    return (
      <View style={[styles.screen, styles.center]}>
        <Text style={styles.notFoundTitle}>找不到这张卡片</Text>
        <Text style={styles.notFoundHint}>回到广场再试一次。</Text>
      </View>
    );
  }

  const displayName =
    (card.nameZh && card.nameZh.length > 0 && card.nameZh) ||
    (card.inChatName.length > 0 && card.inChatName) ||
    card.name;
  const englishName = card.inChatName.length > 0 ? card.inChatName : card.name;
  const showEnglish = displayName !== englishName;
  const tagline =
    (card.taglineZh && card.taglineZh.length > 0 && card.taglineZh) || card.tagline;
  const tags = card.tagsZh && card.tagsZh.length > 0 ? card.tagsZh : card.tags;
  const description = (card.descriptionZh && card.descriptionZh.length > 0
    ? card.descriptionZh
    : card.description) ?? "";
  const firstMessagePreview = (card.firstMessageZh && card.firstMessageZh.length > 0
    ? card.firstMessageZh
    : card.firstMessage) ?? "";

  function handleStart(): void {
    if (busy) return;
    setBusy(true);
    try {
      startTavernRoleplaySession({
        path: card!.path,
        pageUrl: card!.pageUrl,
        imageUrl: card!.imageUrl,
        name: card!.name,
        nameZh: displayName,
        tagline: card!.tagline,
        taglineZh: tagline,
        prefetched: {
          description: card!.description ?? "",
          personality: card!.personality ?? "",
          scenario: card!.scenario ?? "",
          firstMessage: card!.firstMessage ?? "",
          firstMessageZh: firstMessagePreview
        }
      });
    } catch (error) {
      Alert.alert("无法打开角色", error instanceof Error ? error.message : String(error));
    } finally {
      setTimeout(() => setBusy(false), 0);
    }
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.coverWrap}>
          <CachedImage
            source={{ uri: card.imageUrl }}
            style={styles.cover}
            contentFit="cover"
          />
        </View>

        <View style={styles.header}>
          <Text style={styles.name}>{displayName}</Text>
          {showEnglish ? <Text style={styles.nameEn}>{englishName}</Text> : null}
          {tagline.length > 0 ? <Text style={styles.tagline}>{tagline}</Text> : null}

          {tags.length > 0 ? (
            <View style={styles.tagRow}>
              {tags.map((tag, idx) => (
                <View key={`${tag}:${idx}`} style={styles.tagChip}>
                  <Text style={styles.tagChipText}>{tag}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.statsRow}>
            <Text style={styles.statsText}>
              ⬇ {card.downloads.toLocaleString()}   ❤ {card.likes.toLocaleString()}
            </Text>
          </View>
        </View>

        {description.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>角色简介</Text>
            <Text style={styles.body}>{description}</Text>
          </View>
        ) : null}

        {firstMessagePreview.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>TA 会怎么和你打招呼</Text>
            <View style={styles.firstMessageBox}>
              <Text style={styles.body}>{firstMessagePreview}</Text>
            </View>
            <Text style={styles.firstMessageHint}>
              开始聊天后，TA 会以这段话作为开场白。
            </Text>
          </View>
        ) : null}

        {/* spacer so the sticky CTA never covers content */}
        <View style={{ height: 84 }} />
      </ScrollView>

      <View style={styles.ctaDock}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="开始聊天"
          onPress={handleStart}
          disabled={busy}
          style={({ pressed }) => [
            styles.ctaButton,
            pressed && styles.ctaButtonPressed,
            busy && styles.ctaButtonBusy
          ]}
        >
          <Text style={styles.ctaButtonText}>开始聊天</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: KokoColors.bg
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32
  },
  notFoundTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: KokoColors.ink,
    marginBottom: 4
  },
  notFoundHint: {
    fontSize: 14,
    color: KokoColors.inkSecondary
  },
  scrollContent: {
    paddingBottom: 24
  },
  coverWrap: {
    width: "100%",
    aspectRatio: 1,
    backgroundColor: KokoColors.surfaceSoft
  },
  cover: {
    width: "100%",
    height: "100%"
  },
  header: {
    padding: 20,
    gap: 8
  },
  name: {
    fontSize: 22,
    fontWeight: "700",
    color: KokoColors.ink
  },
  nameEn: {
    fontSize: 13,
    color: KokoColors.inkMuted,
    marginTop: -4
  },
  tagline: {
    fontSize: 15,
    lineHeight: 22,
    color: KokoColors.inkSecondary,
    marginTop: 4
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8
  },
  tagChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: KokoRadius.pill,
    backgroundColor: KokoColors.primaryWash
  },
  tagChipText: {
    fontSize: 12,
    color: KokoColors.primaryDeep,
    fontWeight: "500"
  },
  statsRow: {
    marginTop: 8
  },
  statsText: {
    fontSize: 12,
    color: KokoColors.inkMuted
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 20,
    gap: 8
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: KokoColors.inkSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.4
  },
  body: {
    fontSize: 15,
    lineHeight: 24,
    color: KokoColors.ink
  },
  firstMessageBox: {
    backgroundColor: KokoColors.surface,
    borderRadius: KokoRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: KokoColors.border,
    padding: 16
  },
  firstMessageHint: {
    fontSize: 12,
    color: KokoColors.inkMuted,
    paddingHorizontal: 4
  },
  ctaDock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: KokoColors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: KokoColors.border
  },
  ctaButton: {
    height: 50,
    borderRadius: KokoRadius.pill,
    backgroundColor: KokoColors.primary,
    alignItems: "center",
    justifyContent: "center"
  },
  ctaButtonPressed: {
    backgroundColor: KokoColors.primaryDeep
  },
  ctaButtonBusy: {
    opacity: 0.6
  },
  ctaButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: 1
  }
});
