/**
 * Tavern Browse: a static grid of character-tavern.com cards grouped by
 * Chinese category chips. The catalogue is shipped with the app bundle
 * (see `assets/browse-data.json`) so there's no runtime fetch — the page
 * is browsable offline. Tapping a card runs the same fast-path used by
 * the chat-side recommendations: `startTavernRoleplaySession` creates
 * the conversation, pushes the route, then loads the full card in the
 * background while the chat page shows its bootstrap banner.
 */
import { useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ListRenderItemInfo
} from "react-native";

import { CachedImage } from "@/components/CachedImage";
import { KokoColors, KokoRadius } from "@/theme/koko";
import { openTavernCardDetail } from "@/runtime/navigation";

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
  // Optional Chinese localisations, written by translate-browse-data.mjs.
  nameZh?: string;
  taglineZh?: string;
  tagsZh?: string[];
}

interface BrowseCategory {
  id: string;
  labelZh: string;
  cards: BrowseCard[];
}

interface BrowseData {
  version: number;
  fetchedAt: string;
  categories: BrowseCategory[];
}

const DATA = browseData as BrowseData;

const COLUMN_GAP = 12;
const ROW_GAP = 16;
const HORIZONTAL_PADDING = 16;

export function TavernBrowseScreen(): React.ReactElement {
  const categories = DATA.categories;
  const [activeId, setActiveId] = useState<string>(() => categories[0]?.id ?? "");

  const activeCategory = useMemo(
    () => categories.find((c) => c.id === activeId) ?? categories[0],
    [categories, activeId]
  );

  const { width: windowWidth } = useWindowDimensions();
  // Two columns. Card width = (screenWidth - 2*padding - gap) / 2.
  const cardWidth = Math.floor((windowWidth - HORIZONTAL_PADDING * 2 - COLUMN_GAP) / 2);

  return (
    <View style={styles.screen}>
      <View style={styles.chipsBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsContent}
        >
          {categories.map((cat) => {
            const active = cat.id === activeCategory?.id;
            return (
              <Pressable
                key={cat.id}
                accessibilityRole="button"
                accessibilityLabel={cat.labelZh}
                onPress={() => setActiveId(cat.id)}
                style={({ pressed }) => [
                  styles.chip,
                  active && styles.chipActive,
                  pressed && styles.chipPressed
                ]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {cat.labelZh}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <FlatList
        data={activeCategory?.cards ?? []}
        key={activeCategory?.id ?? "empty"}
        keyExtractor={(card) => card.path}
        numColumns={2}
        renderItem={({ item }: ListRenderItemInfo<BrowseCard>) => (
          <BrowseCardCell card={item} width={cardWidth} />
        )}
        columnWrapperStyle={styles.columnWrapper}
        contentContainerStyle={styles.gridContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>这个分类还没有角色</Text>
            <Text style={styles.emptyHint}>稍后再来看看，或者切到别的分类。</Text>
          </View>
        }
        ListFooterComponent={
          activeCategory !== undefined && activeCategory.cards.length > 0 ? (
            <View style={styles.footer}>
              <Text style={styles.footerHint}>
                想要更多/更具体的，回酒馆助手用一句话描述吧。
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

interface BrowseCardCellProps {
  card: BrowseCard;
  width: number;
}

function BrowseCardCell({ card, width }: BrowseCardCellProps): React.ReactElement {
  const [busy, setBusy] = useState(false);

  function handlePress(): void {
    if (busy) return;
    // Tap = navigate to the card's detail screen. The detail screen renders
    // the bundled description + first_mes preview, then offers a "开始聊天"
    // CTA which is what actually creates the roleplay conversation.
    setBusy(true);
    try {
      openTavernCardDetail(card.path);
    } catch (error) {
      Alert.alert("无法打开角色", error instanceof Error ? error.message : String(error));
    } finally {
      // Release the press lock on the next macrotask so the route push is
      // applied before this component re-renders.
      setTimeout(() => setBusy(false), 0);
    }
  }

  // Prefer the pre-translated Chinese fields when present; fall back to
  // the original English when the translate-browse-data.mjs pass hasn't
  // covered this card yet.
  const displayName =
    card.nameZh && card.nameZh.length > 0
      ? card.nameZh
      : card.inChatName.length > 0
        ? card.inChatName
        : card.name;
  const displayTagline =
    card.taglineZh && card.taglineZh.length > 0 ? card.taglineZh : card.tagline;
  const displayTags =
    card.tagsZh && card.tagsZh.length > 0 ? card.tagsZh : card.tags;
  const tagsShown = displayTags.slice(0, 2);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={displayName}
      onPress={handlePress}
      disabled={busy}
      style={({ pressed }) => [
        styles.card,
        { width },
        pressed && styles.cardPressed,
        busy && styles.cardBusy
      ]}
    >
      <View style={[styles.cover, { width, height: width }]}>
        <CachedImage
          source={{ uri: card.imageUrl }}
          style={styles.coverImage}
          contentFit="cover"
        />
      </View>
      <View style={styles.body}>
        <Text style={styles.cardName} numberOfLines={1}>
          {displayName}
        </Text>
        {displayTagline.length > 0 ? (
          <Text style={styles.cardTagline} numberOfLines={2}>
            {displayTagline}
          </Text>
        ) : null}
        {tagsShown.length > 0 ? (
          <View style={styles.tagRow}>
            {tagsShown.map((tag) => (
              <View key={tag} style={styles.tagChip}>
                <Text style={styles.tagChipText} numberOfLines={1}>
                  {tag}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: KokoColors.bg
  },
  chipsBar: {
    backgroundColor: KokoColors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: KokoColors.border
  },
  chipsContent: {
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingVertical: 12,
    gap: 8
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: KokoRadius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: KokoColors.border,
    backgroundColor: KokoColors.surface
  },
  chipActive: {
    borderColor: KokoColors.primary,
    backgroundColor: KokoColors.primarySoft
  },
  chipPressed: {
    opacity: 0.7
  },
  chipText: {
    fontSize: 14,
    color: KokoColors.inkSecondary,
    fontWeight: "500"
  },
  chipTextActive: {
    color: KokoColors.primaryDeep,
    fontWeight: "600"
  },
  gridContent: {
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: 16,
    paddingBottom: 32,
    gap: ROW_GAP
  },
  columnWrapper: {
    gap: COLUMN_GAP
  },
  card: {
    backgroundColor: KokoColors.surface,
    borderRadius: KokoRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: KokoColors.border,
    overflow: "hidden"
  },
  cardPressed: {
    opacity: 0.85
  },
  cardBusy: {
    opacity: 0.6
  },
  cover: {
    backgroundColor: KokoColors.surfaceSoft
  },
  coverImage: {
    width: "100%",
    height: "100%"
  },
  body: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 4
  },
  cardName: {
    fontSize: 14,
    fontWeight: "600",
    color: KokoColors.ink
  },
  cardTagline: {
    fontSize: 12,
    lineHeight: 16,
    color: KokoColors.inkSecondary,
    minHeight: 32
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 2
  },
  tagChip: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: KokoRadius.pill,
    backgroundColor: KokoColors.primaryWash
  },
  tagChipText: {
    fontSize: 10,
    color: KokoColors.primaryDeep,
    fontWeight: "500"
  },
  emptyState: {
    paddingTop: 80,
    paddingHorizontal: 32,
    alignItems: "center",
    gap: 8
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: KokoColors.ink
  },
  emptyHint: {
    fontSize: 13,
    color: KokoColors.inkSecondary,
    textAlign: "center"
  },
  footer: {
    paddingTop: 16,
    paddingHorizontal: 16,
    alignItems: "center"
  },
  footerHint: {
    fontSize: 12,
    color: KokoColors.inkMuted,
    textAlign: "center"
  }
});
