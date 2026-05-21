import { registerAgentResponseTransformer } from "@/runtime/agentResponses";
import { registerConversationMode } from "@/runtime/conversationModes";
import { registerSharedBlockRenderer } from "@/runtime/messageBlocks";
import { registerMiniApp } from "@/runtime/miniApps";
import {
  registerOutboundMessageBuilder,
  type OutboundMessageBuilder
} from "@/runtime/outboundMessages";
import type { ChatMessage } from "@/state/conversations";

import { deeplyAvatarChatBuddy, deeplyAvatarLearning } from "./avatars";
import { DEEPLY_MINI_APP_ID } from "./constants";
import {
  DEEPLY_COURSE_MODE_ID,
  loadDeeplyCourseOutline,
  loadDeeplyCourseSessionRecord
} from "./courseSession";
import {
  buildCourseDialogPrompt,
  buildCourseMainlinePrompt,
  parseMainlineUserText
} from "./persona";
import { getDeeplyCourseProgress } from "./courseProgress";
import {
  DEEPLY_EXPLORE_FIRST_TURN_INSTRUCTION,
  DEEPLY_EXPLORE_PERSONA_DOC,
  DEEPLY_EXPLORE_TURN_REMINDER,
  DEEPLY_RECOMMEND_INSTRUCTION,
  shouldTriggerDeeplyRecommend
} from "./persona";
import {
  parseDeeplyRecommendations,
  DEEPLY_CARD_BLOCK_TYPE,
  DEEPLY_RECOMMENDATIONS_BLOCK_TYPE,
  type DeeplyRecommendationItem
} from "./parseRecommendations";
import { DeeplyRecommendationCard, isDeeplyRecommendationCard } from "./RecommendationCard";

/**
 * Deeply mini-app · 注册入口
 *
 * Launcher 入口指向 `/deeply` route(由 mini-app 自己拥有的 surface),
 * 不复用 host 的共享聊天页。底层仍然走 KokoChat 共享 conversation store
 * + outbound builder pipeline,所以 streaming / 错误处理 / session restore
 * 都跟其他 mini-app 一致。
 *
 * 默认 conversation mode = "deeply",对应 OpenClaw agent `deeply`。
 * 后续课程讲解会另外注册 conversation mode "deeply-course"。
 */

let registered = false;

/**
 * 把人设 + 注入 / reminder 套在 gatewayText 外面。
 * 用户看到的 visibleText 保持原样,真正喂给 OpenClaw 的是带人设包装的版本。
 */
const deeplyExploreOutboundBuilder: OutboundMessageBuilder = async ({
  visibleText,
  isFirstUserTurn
}) => {
  // 触发推荐 fenced block 的两种来源:
  //   1. 用户按下「推荐课程」按钮(visibleText 是固定话)
  //   2. 用户在输入框里口语化要求推荐(命中 shouldTriggerDeeplyRecommend)
  // 两种都走同一条专用推荐 prompt 路径,避免"按钮才出卡"的隐蔽边界。
  if (shouldTriggerDeeplyRecommend(visibleText)) {
    if (isFirstUserTurn) {
      return {
        visibleText,
        gatewayText: [
          "<deeply_explore_persona>",
          DEEPLY_EXPLORE_PERSONA_DOC,
          "</deeply_explore_persona>",
          "",
          DEEPLY_RECOMMEND_INSTRUCTION,
          "",
          "[用户消息]",
          visibleText
        ].join("\n")
      };
    }
    return {
      visibleText,
      gatewayText: [
        DEEPLY_RECOMMEND_INSTRUCTION,
        "",
        "[用户消息]",
        visibleText
      ].join("\n")
    };
  }

  if (isFirstUserTurn) {
    return {
      visibleText,
      gatewayText: [
        "<deeply_explore_persona>",
        DEEPLY_EXPLORE_PERSONA_DOC,
        "</deeply_explore_persona>",
        "",
        DEEPLY_EXPLORE_FIRST_TURN_INSTRUCTION,
        "",
        "[用户消息]",
        visibleText
      ].join("\n")
    };
  }

  return {
    visibleText,
    gatewayText: [
      DEEPLY_EXPLORE_TURN_REMINDER,
      "",
      "[用户消息]",
      visibleText
    ].join("\n")
  };
};

/**
 * Agent 回复里出现 koko.deeply.recommendations fenced block 时,把它解开成
 * 一串 ChatMessage(text 气泡 + 单卡 block),IM 流读起来更自然,也避免一
 * 大坨 JSON 在 chat 里闪一下。
 */
function buildRecommendationMessages(
  runId: string,
  items: DeeplyRecommendationItem[]
): ChatMessage[] {
  return items.map((item, idx) => {
    const id = `${runId}-${idx}`;
    if (item.kind === "text") {
      return {
        id,
        role: "agent",
        text: item.text,
        runId,
        streaming: false
      } satisfies ChatMessage;
    }
    return {
      id,
      role: "agent",
      text: "",
      runId,
      streaming: false,
      blocks: [
        {
          type: DEEPLY_CARD_BLOCK_TYPE,
          version: 1,
          data: item.card
        }
      ]
    } satisfies ChatMessage;
  });
}

function transformDeeplyAgentResponse({
  runId,
  text
}: {
  runId: string;
  text: string;
}): { messages: ChatMessage[]; preview?: string } | null {
  const parsed = parseDeeplyRecommendations(text);
  if (!parsed.ok) return null;
  const cards = parsed.value.items.filter(
    (item): item is Extract<DeeplyRecommendationItem, { kind: "card" }> => item.kind === "card"
  );
  const previewNames = cards
    .slice(0, 2)
    .map((item) => item.card.title)
    .join("、");
  const preview = previewNames.length > 0
    ? `推荐了 ${cards.length} 个:${previewNames}`
    : `推荐了 ${cards.length} 个`;
  return {
    messages: buildRecommendationMessages(runId, parsed.value.items),
    preview
  };
}

function isDeeplyRecommendationStream({ text }: { text: string }): boolean {
  return /```[ \t]*koko\.deeply\.recommendations\b/.test(text);
}

/**
 * 课程讲解 mode 的 outbound builder。
 *
 * 两条路径:
 *   - mainline:visibleText 命中 `继续讲解第N节` / `请讲解第N节[:标题]`
 *     → 注入完整 persona + outline + 强制首行格式 instruction。
 *   - dialog:用户其它任意文字 → 注入 persona reminder + 当前节 hint。
 *
 * 如果 outline / session record 还没就绪(理论上 chat 输入会被 bootstrap
 * 锁住,但保险起见),退化为透传 visibleText。
 */
const deeplyCourseOutboundBuilder: OutboundMessageBuilder = async ({
  conversation,
  visibleText
}) => {
  const record = loadDeeplyCourseSessionRecord(conversation.id);
  const outline = loadDeeplyCourseOutline(conversation.id);
  if (record === null || outline === null) {
    return { visibleText, gatewayText: visibleText };
  }

  const mainlineSection = parseMainlineUserText(visibleText);
  if (mainlineSection !== null) {
    const sectionMeta = outline.sections.find((s) => s.index === mainlineSection);
    const sectionTitle = sectionMeta?.title ?? "(本节标题)";
    const progress = getDeeplyCourseProgress(conversation.id);
    const isFirstSection =
      progress.currentSection === 0 || progress.readSections.length === 0;
    return {
      visibleText,
      gatewayText: buildCourseMainlinePrompt({
        courseTitle: record.title,
        introduction: record.introduction,
        outlineMarkdown: outline.markdown,
        section: mainlineSection,
        sectionTitle,
        isFirstSection
      })
    };
  }

  // dialog 路径
  const progress = getDeeplyCourseProgress(conversation.id);
  const activeIndex = progress.activeSection > 0 ? progress.activeSection : Math.max(progress.currentSection, 1);
  const activeSectionMeta = outline.sections.find((s) => s.index === activeIndex)
    ?? outline.sections[0]
    ?? { index: 1, title: "" };
  return {
    visibleText,
    gatewayText: buildCourseDialogPrompt({
      courseTitle: record.title,
      currentSection: activeSectionMeta.index,
      currentSectionTitle: activeSectionMeta.title,
      userText: visibleText
    })
  };
};

export function registerDeeplyMiniApp(): void {
  if (registered) return;
  registered = true;

  // 注意顺序:**先**显式注册 `deeply` conversation mode 把 surface 设成
  // route /deeply,**再** registerMiniApp。否则 registerMiniApp 会自动注册
  // 一个 default `deeply` mode 用 standard-chat surface —— 之后用户从
  // 聊天列表点 "Deeply 知识探索" 时就被 host 共享 /chat/[id] 渲染,
  // Deeply 自家的 chat / 推荐卡片 / 输入栏 全部失效。
  registerConversationMode({
    id: DEEPLY_MINI_APP_ID,
    ownerMiniAppId: DEEPLY_MINI_APP_ID,
    displayName: "Deeply 知识探索",
    listGlyph: "📖",
    listImage: deeplyAvatarChatBuddy,
    surface: { kind: "route", pathname: "/deeply" },
    openclaw: {
      defaultAgentId: "deeply"
    }
  });

  registerMiniApp({
    id: DEEPLY_MINI_APP_ID,
    displayName: "Deeply",
    showInLauncher: true,
    listGlyph: "📖",
    listImage: deeplyAvatarChatBuddy,
    launch: { kind: "route", pathname: "/deeply" },
    openclaw: {
      defaultAgentId: "deeply"
    }
  });

  // 课程讲解子 mode:从 CourseDetailSheet 的「开始讲解」按钮进入,
  // 由 mini-app 自己拥有的 surface 承接(`/deeply/course/[id]`)。
  // 不出现在 launcher / + 菜单里 — 唯一入口是推荐卡 → sheet → 开始讲解。
  registerConversationMode({
    id: DEEPLY_COURSE_MODE_ID,
    ownerMiniAppId: DEEPLY_MINI_APP_ID,
    displayName: "Deeply 课程讲解",
    listGlyph: "📖",
    listImage: deeplyAvatarLearning,
    surface: { kind: "route", pathname: "/deeply/course/[id]" },
    openclaw: {
      // 跟探索共用 `deeply` OpenClaw agent,避免用户再装一个 agent。
      // Conversation 自然按 sessionKey 隔离(course mode scope 跟 explore
      // 不同),所以同 agent 不会让 explore / course 历史互相污染。
      defaultAgentId: "deeply"
    }
  });

  registerOutboundMessageBuilder(DEEPLY_COURSE_MODE_ID, deeplyCourseOutboundBuilder);
  registerOutboundMessageBuilder(DEEPLY_MINI_APP_ID, deeplyExploreOutboundBuilder);
  registerAgentResponseTransformer(DEEPLY_MINI_APP_ID, transformDeeplyAgentResponse, {
    shouldDeferStreamingText: isDeeplyRecommendationStream
  });
  registerSharedBlockRenderer(
    DEEPLY_CARD_BLOCK_TYPE,
    isDeeplyRecommendationCard,
    DeeplyRecommendationCard
  );

  void DEEPLY_RECOMMENDATIONS_BLOCK_TYPE;
}
