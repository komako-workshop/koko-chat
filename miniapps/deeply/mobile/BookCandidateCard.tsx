import { Pressable, StyleSheet, Text, View } from "react-native";

import type { BlockRenderer } from "@/runtime/messageBlocks";
import { useGatewayStore } from "@/state/gateway";

import { buildBookCandidateChosenVisibleText } from "./persona";
import {
  isDeeplyBookCandidate,
  type DeeplyBookCandidate
} from "./parseBookCandidates";

/**
 * 单张候选书卡。在 chat 流里出现 `koko.deeply.book.candidates` fenced block
 * 时,客户端把每个 candidate 解开成一张这种卡。
 *
 *  ┌─────────────────────────────────────────────┐
 *  │  Poor Charlie's Almanack                    │
 *  │  Charles Munger / Peter Kaufman 编 · 2005   │
 *  │  ───────────────────────────────────────    │
 *  │  Munger 演讲集 + Kaufman 评注,通行的中文译本…│
 *  │                                        就读这本 │
 *  └─────────────────────────────────────────────┘
 *
 * 点击 → 用 `buildBookCandidateChosenVisibleText` 拼一条 "我选《XX》..." 的
 * visible text,通过 gateway store 的 sendUserMessage 发出去。Course mode 的
 * outbound builder 会识别这条文字 → 路由到 `buildBookOutlinePrompt`,触发
 * agent 第二轮(出 outline)。
 */
export const BookCandidateCard: BlockRenderer<DeeplyBookCandidate> = ({
  block,
  conversation
}) => {
  return (
    <BookCandidateCardView card={block.data} conversationId={conversation.id} />
  );
};

export { isDeeplyBookCandidate };

function BookCandidateCardView({
  card,
  conversationId
}: {
  card: DeeplyBookCandidate;
  conversationId: string;
}): React.ReactElement {
  const sendUserMessage = useGatewayStore((s) => s.sendUserMessage);
  const handlePress = (): void => {
    const visible = buildBookCandidateChosenVisibleText({
      title: card.title,
      ...(card.author !== undefined ? { author: card.author } : {}),
      ...(card.subject !== undefined ? { subject: card.subject } : {})
    });
    void sendUserMessage(conversationId, visible);
  };

  // meta 行只放"作者",subject 单独一行(它是用户主要识别依据,比 author 更重要)。
  const showAuthor = card.author !== undefined && card.author.length > 0;
  const showSubject = card.subject !== undefined && card.subject.length > 0;
  const showTagline = card.tagline !== undefined && card.tagline.length > 0;

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`选择书:${card.title}`}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.headerCol}>
        <Text style={styles.title} numberOfLines={2}>
          {card.title}
        </Text>
        {showAuthor ? (
          <Text style={styles.author} numberOfLines={1}>
            {card.author}
          </Text>
        ) : null}
      </View>

      {showSubject ? (
        <View style={styles.subjectContainer}>
          <Text style={styles.subject} numberOfLines={3}>
            {card.subject}
          </Text>
        </View>
      ) : null}

      {showTagline ? (
        <View style={styles.taglineContainer}>
          <Text style={styles.tagline} numberOfLines={2}>
            {card.tagline}
          </Text>
        </View>
      ) : null}

      <View style={styles.footer}>
        <Text style={styles.cta}>就读这本 ›</Text>
      </View>
    </Pressable>
  );
}

const CARD_BG = "#FFFFFF";
const CARD_BORDER = "#EFEDE7";
const CARD_INK = "#1E293B";
const CARD_INK_MUTED = "#64748B";
const CARD_SUBJECT = "#334155";
const CARD_TAGLINE = "#94A3B8";
const CARD_DIVIDER = "#F1F5F2";
const CARD_CTA = "#111111";

const styles = StyleSheet.create({
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    padding: 16,
    marginTop: 10,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    shadowColor: "#64748B",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4
  },
  cardPressed: {
    backgroundColor: "#FBFAF7"
  },
  headerCol: {
    marginBottom: 10
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: CARD_INK,
    lineHeight: 24
  },
  author: {
    fontSize: 13,
    color: CARD_INK_MUTED,
    marginTop: 3,
    fontWeight: "600"
  },
  subjectContainer: {
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: CARD_DIVIDER
  },
  subject: {
    fontSize: 14,
    lineHeight: 21,
    color: CARD_SUBJECT
  },
  taglineContainer: {
    paddingTop: 8
  },
  tagline: {
    fontSize: 12,
    lineHeight: 18,
    color: CARD_TAGLINE,
    fontStyle: "italic"
  },
  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 10
  },
  cta: {
    fontSize: 13,
    fontWeight: "700",
    color: CARD_CTA
  }
});
