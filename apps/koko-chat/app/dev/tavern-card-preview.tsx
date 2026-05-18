/**
 * Dev-only preview page for tavern card rendering.
 *
 * Loads with mock data so you can iterate on the card / bubble layout
 * without running an OpenClaw round-trip. Reachable at /dev/tavern-card-preview
 * in dev builds.
 *
 * Layout under test: the chat surface renders a card-only agent message as
 * a "block-only bubble" (transparent, no padding/border), so the card owns
 * its full presentation. We also render the card inside the *default* agent
 * bubble for a side-by-side comparison.
 */
import { Image, ScrollView, StyleSheet, Text, View, type ImageSourcePropType } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { KokoColors, KokoRadius } from "@/theme/koko";
import type { ConversationMeta } from "@/state/conversations";
import {
  TavernCardBlock,
  isTavernRecommendationCard
} from "../../../../miniapps/tavern/mobile/RecommendationsBlock";
import type { TavernRecommendationCard } from "../../../../miniapps/tavern/mobile/parseRecommendations";

const FAKE_CONVERSATION: ConversationMeta = {
  id: "preview",
  mode: "tavern",
  title: "preview",
  sessionKey: "preview-session",
  createdAt: 0,
  updatedAt: 0
};

const MOCK_CARDS: TavernRecommendationCard[] = [
  {
    pageUrl: "https://character-tavern.com/character/demo/akari_yandere",
    imageUrl: "https://cards.character-tavern.com/demo/akari_yandere.png",
    name: "Akari | Classic Yandere",
    nameZh: "明里 · 经典病娇",
    tagline: "Your kindergarten friend who never stopped looking",
    taglineZh: "幼儿园起就盯着你的青梅竹马。",
    tags: ["yandere", "modern", "female", "obsessive"],
    matchTags: ["经典病娇", "跟踪感", "占有欲", "恋爱"],
    safety: "sfw"
  },
  {
    pageUrl: "https://character-tavern.com/character/demo/lorelai_vamp",
    imageUrl: "https://cards.character-tavern.com/demo/lorelai_vamp.png",
    name: "Lorelai",
    nameZh: "洛蕾莱",
    tagline: "Vampire who reads as charming until she doesn't",
    taglineZh: "一位女性病娇吸血鬼。",
    tags: ["vampire", "yandere", "dark"],
    matchTags: ["吸血鬼", "强势", "囚禁开局", "危险感"],
    safety: "nsfw"
  },
  {
    pageUrl: "https://character-tavern.com/character/demo/alana_crimeboss",
    imageUrl: "https://cards.character-tavern.com/demo/alana_crimeboss.png",
    name: "Alana Volkov | Crimeboss Yandere",
    nameZh: "阿拉娜·沃尔科夫",
    tagline: "Cute but very dangerous crime-family heir",
    taglineZh: "可爱但危险的病娇犯罪首领女友。",
    tags: ["yandere", "modern", "crime"],
    matchTags: ["黑帮", "女友", "强势", "现代"],
    safety: "sfw"
  }
];

const MOCK_PROSE_BUBBLES: readonly string[] = [
  "可以，给你换一批更成人向、挑逗感更强的。下面这几张都偏 NSFW / 暧昧推进，注意避开自己不喜欢的题材。",
  "这张涩度很直给，主打夜晚神社、挑逗和支配感。",
  "如果你想要更危险、更黏人的亲密感，这张很合适；它的重点是病娇占有和高压暧昧。",
  "想先聊哪个？"
] as const;

function card(idx: number): TavernRecommendationCard {
  const c = MOCK_CARDS[idx];
  if (c === undefined) throw new Error(`mock card ${idx} missing`);
  return c;
}

function prose(idx: number): string {
  const p = MOCK_PROSE_BUBBLES[idx];
  if (p === undefined) throw new Error(`mock prose ${idx} missing`);
  return p;
}

const KOKO_AVATAR = require("../../assets/brand/chat-avatar.png") as ImageSourcePropType;

export default function TavernCardPreview(): React.ReactElement {
  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.h1}>Tavern card preview</Text>
        <Text style={styles.sub}>guard accepts mock data: {String(isTavernRecommendationCard(MOCK_CARDS[0]))}</Text>

        <Section title="A · IM-style stream (production layout)">
          <ChatLikeStream />
        </Section>

        <Section title="B · Card forced inside default agent bubble (broken layout, for diff)">
          <View style={styles.agentRow}>
            <Image36 />
            <View style={[styles.bubble, styles.agentBubble]}>
              <TavernCardBlock
                block={{ type: "koko.tavern.card", version: 1, data: card(0) }}
                conversation={FAKE_CONVERSATION}
              />
            </View>
          </View>
        </Section>

        <Section title="C · Card on its own, no chat chrome at all">
          <View style={styles.standalone}>
            <TavernCardBlock
              block={{ type: "koko.tavern.card", version: 1, data: card(0) }}
              conversation={FAKE_CONVERSATION}
            />
          </View>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function ChatLikeStream(): React.ReactElement {
  const items: Array<
    { kind: "text"; text: string } | { kind: "card"; card: TavernRecommendationCard }
  > = [
    { kind: "text", text: prose(0) },
    { kind: "text", text: prose(1) },
    { kind: "card", card: card(0) },
    { kind: "text", text: prose(2) },
    { kind: "card", card: card(1) },
    { kind: "card", card: card(2) },
    { kind: "text", text: prose(3) }
  ];

  return (
    <View>
      {items.map((item, idx) => {
        const showAvatar = idx === 0;
        if (item.kind === "text" && item.text.length > 0) {
          return (
            <View key={idx} style={styles.agentRow}>
              {showAvatar ? <Image36 /> : <View style={styles.avatarSpacer} />}
              <View style={[styles.bubble, styles.agentBubble]}>
                <Text style={styles.bubbleText}>{item.text}</Text>
              </View>
            </View>
          );
        }
        if (item.kind === "card") {
          return (
            <View key={idx} style={styles.agentRow}>
              <View style={styles.avatarSpacer} />
              <View style={[styles.bubble, styles.blockOnlyBubble]}>
                <TavernCardBlock
                  block={{ type: "koko.tavern.card", version: 1, data: item.card }}
                  conversation={FAKE_CONVERSATION}
                />
              </View>
            </View>
          );
        }
        return null;
      })}
    </View>
  );
}

function Image36(): React.ReactElement {
  return <Image source={KOKO_AVATAR} style={styles.avatar} />;
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: KokoColors.bg
  },
  content: {
    padding: 16,
    gap: 24
  },
  h1: {
    fontSize: 20,
    fontWeight: "700",
    color: KokoColors.ink
  },
  sub: {
    fontSize: 12,
    color: KokoColors.inkSecondary
  },
  section: {
    gap: 8
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: KokoColors.inkSecondary
  },
  sectionBody: {
    backgroundColor: KokoColors.surfaceSoft,
    borderRadius: KokoRadius.lg,
    padding: 12,
    gap: 8
  },
  agentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    alignSelf: "flex-start",
    maxWidth: "88%",
    marginTop: 8
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: KokoRadius.pill,
    marginRight: 8,
    marginTop: 2,
    backgroundColor: KokoColors.primarySoft
  },
  avatarSpacer: {
    width: 36,
    marginRight: 8
  },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: KokoRadius.xl,
    flexShrink: 1
  },
  agentBubble: {
    backgroundColor: KokoColors.surface,
    borderTopLeftRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: KokoColors.border
  },
  blockOnlyBubble: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    backgroundColor: "transparent",
    borderWidth: 0
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 22,
    color: KokoColors.ink
  },
  standalone: {
    paddingHorizontal: 0
  }
});
