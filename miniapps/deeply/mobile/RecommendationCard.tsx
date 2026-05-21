import { Pressable, StyleSheet, Text, View } from "react-native";

import type { BlockRenderer } from "@/runtime/messageBlocks";

import { openDeeplyCourseSheet } from "./courseSheetStore";
import {
  isDeeplyRecommendationCard,
  type DeeplyRecommendationCard as DeeplyRecommendationCardData
} from "./parseRecommendations";

/**
 * 单张推荐课程卡。视觉对齐 deeply.plus 原版 RecommendCard,
 * 但去掉了"约 N 节"meta — 节数已经移到点击后的 CourseDetailSheet
 * 弹窗里,由用户主动选择。
 *
 *   ┌────────────────────────────────────────┐
 *   │  阿德勒                           ❯    │
 *   │  个体心理学                              │
 *   │  ────────────────────────────────       │
 *   │  ❝ 阿德勒很适合谈成长,因为他不…           │
 *   └────────────────────────────────────────┘
 *
 * 点击 → 打开 CourseDetailSheet:
 *   - 后台调一次 inferOnce 拿这门课的详细介绍 + 建议节数 + AI 自由出的 0-2 个选项
 *   - 用户配置完点「开始讲解」→ 创建 deeply-course conversation,
 *     跳到课程讲解 surface
 */
export const DeeplyRecommendationCard: BlockRenderer<DeeplyRecommendationCardData> = ({
  block,
  conversation
}) => {
  return (
    <DeeplyRecommendationCardView
      card={block.data}
      conversationId={conversation.id}
    />
  );
};

export { isDeeplyRecommendationCard };

function DeeplyRecommendationCardView({
  card,
  conversationId
}: {
  card: DeeplyRecommendationCardData;
  conversationId: string;
}): React.ReactElement {
  return (
    <Pressable
      onPress={() => openDeeplyCourseSheet(card, conversationId)}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.mainRow}>
        <View style={styles.infoCol}>
          <Text style={styles.title} numberOfLines={1}>
            {card.title}
          </Text>
          {card.subtitle.length > 0 ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {card.subtitle}
            </Text>
          ) : null}
        </View>
        <Text style={styles.chevron} accessibilityLabel="打开">
          ›
        </Text>
      </View>

      <View style={styles.reasonContainer}>
        <Text style={styles.quoteIcon}>❝</Text>
        <Text style={styles.reasonText} numberOfLines={4}>
          {card.reason}
        </Text>
      </View>
    </Pressable>
  );
}

const CARD_BG = "#FFFFFF";
const CARD_BORDER = "#EFEDE7";
const CARD_INK = "#1E293B";
const CARD_INK_MUTED = "#64748B";
const CARD_REASON = "#475569";
const CARD_QUOTE = "#94A3B8";
const CARD_DIVIDER = "#F1F5F2";

const styles = StyleSheet.create({
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
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
  mainRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12
  },
  infoCol: {
    flex: 1,
    paddingRight: 8
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: CARD_INK,
    marginBottom: 4
  },
  subtitle: {
    fontSize: 13,
    color: CARD_INK_MUTED,
    lineHeight: 18
  },
  chevron: {
    fontSize: 22,
    color: "#CBD5E1",
    lineHeight: 22,
    fontWeight: "300"
  },
  reasonContainer: {
    flexDirection: "row",
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: CARD_DIVIDER
  },
  quoteIcon: {
    fontSize: 16,
    color: CARD_QUOTE,
    marginRight: 6,
    marginTop: 2
  },
  reasonText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 22,
    color: CARD_REASON
  }
});
