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
  applyResearchOutlineToCourse,
  loadDeeplyCourseOutline,
  loadDeeplyCourseSessionRecord,
  loadDeeplyCourseSources
} from "./courseSession";
import {
  buildCourseDialogPrompt,
  buildCourseMainlinePrompt,
  buildMaterialKickoffPrompt,
  buildResearchCourseSectionPrompt,
  buildResearchKickoffPrompt,
  parseDeeplyMaterialKickoff,
  parseDeeplyResearchKickoff,
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
import {
  DEEPLY_RESEARCH_OUTLINE_BLOCK_TYPE,
  isDeeplyResearchOutlineStream,
  parseDeeplyResearchOutline
} from "./parseResearchOutline";
import { DeeplyRecommendationCard, isDeeplyRecommendationCard } from "./RecommendationCard";
import { extractFencedBlock } from "@/runtime/messageBlocks";

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
 * Course mode 的 response transformer。
 *
 * Research 路径:agent 在调研结束时输出一个 `koko.deeply.research.outline`
 * fenced block。识别到就:
 *   1. 把 fenced block 之前的 prose 留下来当 chat message 显示(narration)
 *   2. 把 fenced block 自身**移除**(用户不需要看到 raw JSON)
 *   3. 副作用:写 outline + sources storage、init progress、bootstrap → ready
 *
 * 没有 fenced block 时 return null,host 走默认 prose 渲染(普通讲解、对话)。
 *
 * **关键 UX:即使 parse 失败,也要剪掉 fenced block** —— 否则用户会看到
 * 一坨 raw JSON 滚在 chat 里。失败时不写 storage、不切 bootstrap,但 chat
 * 上显示 prose + 一条简短的人话错误,引导用户归档重开。
 */
function transformDeeplyCourseAgentResponse({
  conversation,
  runId,
  text
}: {
  conversation: { id: string };
  runId: string;
  text: string;
}): { messages: ChatMessage[]; preview?: string } | null {
  const block = extractFencedBlock(text, DEEPLY_RESEARCH_OUTLINE_BLOCK_TYPE);
  if (block === null) return null;

  // 不管 parse 成不成功,fenced block 永远从可见 chat 文本里剪掉。
  const prose = text.slice(0, block.start).trim();
  const parsed = parseDeeplyResearchOutline(text);

  if (!parsed.ok) {
    console.warn("[deeply-course] research outline parse failed:", parsed.error);
    const messages: ChatMessage[] = [];
    if (prose.length > 0) {
      messages.push({
        id: `${runId}-prose`,
        role: "agent",
        text: prose,
        runId,
        streaming: false
      } satisfies ChatMessage);
    }
    messages.push({
      id: `${runId}-error`,
      role: "agent",
      text: `🚫 调研结果格式没能解析(${truncate(parsed.error, 80)})。
你可以右上角归档这门课,然后回 Deeply 探索重新开一个 —— 同一题目重发,agent 通常二次就能 produce 正确结构。`,
      runId,
      streaming: false
    } satisfies ChatMessage);
    return {
      messages,
      preview: "调研结果格式错误"
    };
  }

  applyResearchOutlineToCourse(conversation.id, parsed.value);

  const messages: ChatMessage[] = [];
  if (prose.length > 0) {
    messages.push({
      id: runId,
      role: "agent",
      text: prose,
      runId,
      streaming: false
    } satisfies ChatMessage);
  } else {
    // 极少见:agent 把全部内容塞到了 fenced block 里没写 prose。
    // 留一条简短确认消息,避免 chat 流里这一轮看起来什么都没说。
    messages.push({
      id: runId,
      role: "agent",
      text: `调研完成。课程目录已经准备好,你可以点下方「开始第 1 节」开始学。`,
      runId,
      streaming: false
    } satisfies ChatMessage);
  }
  return { messages, preview: `调研完成:${parsed.value.courseTitle}` };
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
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
  // Research kickoff 比下面的 record/outline 加载更早处理 —— 这一轮
  // outline 还没生成(它正是这一轮 agent 要产出的),所以不能被
  // "outline null → 透传" 兜底吞掉。
  const kickoff = parseDeeplyResearchKickoff(visibleText);
  if (kickoff !== null) {
    return {
      visibleText,
      gatewayText: buildResearchKickoffPrompt(kickoff)
    };
  }
  const materialKickoff = parseDeeplyMaterialKickoff(visibleText);
  if (materialKickoff !== null) {
    const record = loadDeeplyCourseSessionRecord(conversation.id);
    const material = record?.materialInput;
    return {
      visibleText,
      gatewayText: buildMaterialKickoffPrompt({
        label: material?.label ?? materialKickoff.label,
        sections: materialKickoff.sections,
        sourceKind: material?.sourceKind ?? "url",
        ...(material?.url !== undefined ? { url: material.url } : {}),
        ...(material?.attachments !== undefined ? { attachments: material.attachments } : {})
      })
    };
  }

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

    // Research 课:每节由 agent 临场基于 sources + web tools 创作内容,
    // 走完全不同的 prompt(buildResearchCourseSectionPrompt)。
    if (record.kind === "research") {
      const sourcesRecord = loadDeeplyCourseSources(conversation.id);
      // 从 per-section storage 拿到该节自己的 sources(优先);
      // 兜底:整门课的 union sources。
      const perSectionSources = (sectionMeta as {
        sources?: ReadonlyArray<{
          title: string;
          url: string;
          stance: "primary" | "counterpoint" | "background";
          snippet: string;
        }>;
      } | undefined)?.sources ?? [];
      const sectionSources = perSectionSources.length > 0
        ? perSectionSources
        : sourcesRecord?.sources ?? [];
      return {
        visibleText,
        gatewayText: buildResearchCourseSectionPrompt({
          courseTitle: record.title,
          introduction: record.introduction,
          section: mainlineSection,
          sectionTitle,
          sectionSources,
          isFirstSection
        })
      };
    }

    // 普通课程:走预先定好的"核心隐喻 + 要点"展开。
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
  registerAgentResponseTransformer(DEEPLY_COURSE_MODE_ID, transformDeeplyCourseAgentResponse, {
    // Streaming 期间,截掉 fence opener 之后的 raw JSON,只让 prose
    // narration 可见。fence 开头标记是 ```koko.deeply.research.outline,
    // 在用户屏幕上很丑,但 fence 之前的 prose(narration)需要持续 streaming
    // 让用户感受到 agent 在干活。final 时不调这里,transformer 处理
    // 完整 fullText,剪掉 fence 写 prose-only message。
    streamingDisplayText: ({ text }) => {
      const fenceIdx = text.indexOf("```" + DEEPLY_RESEARCH_OUTLINE_BLOCK_TYPE);
      if (fenceIdx <= 0) return null;
      return text.slice(0, fenceIdx).trimEnd();
    }
  });
  void isDeeplyResearchOutlineStream;
  registerSharedBlockRenderer(
    DEEPLY_CARD_BLOCK_TYPE,
    isDeeplyRecommendationCard,
    DeeplyRecommendationCard
  );

  void DEEPLY_RECOMMENDATIONS_BLOCK_TYPE;
}
