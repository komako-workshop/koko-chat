import { registerAgentResponseTransformer } from "@/runtime/agentResponses";
import { registerConversationMode } from "@/runtime/conversationModes";
import { registerSharedBlockRenderer } from "@/runtime/messageBlocks";
import { registerMiniApp } from "@/runtime/miniApps";
import {
  registerOutboundMessageBuilder,
  type OutboundMessageBuilder
} from "@/runtime/outboundMessages";
import {
  useConversationStore,
  type ChatMessage,
  type ConversationMeta
} from "@/state/conversations";

import { deeplyAvatarChatBuddy, deeplyAvatarLearning } from "./avatars";
import { DEEPLY_MINI_APP_ID } from "./constants";
import {
  DEEPLY_COURSE_MODE_ID,
  applyResearchPlanToCourse,
  applyResearchOutlineToCourse,
  loadDeeplyCourseOutline,
  loadDeeplyCourseSessionRecord,
  loadDeeplyCourseSources
} from "./courseSession";
import {
  buildBookKickoffPrompt,
  buildBookOutlinePrompt,
  buildCourseDialogPrompt,
  buildCourseMainlinePrompt,
  buildMaterialKickoffPrompt,
  buildResearchCourseSectionPrompt,
  buildResearchKickoffPrompt,
  dedupSectionHeadings,
  parseDeeplyBookChosen,
  parseDeeplyBookKickoff,
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
  DEEPLY_RESEARCH_PLAN_BLOCK_TYPE,
  parseDeeplyResearchPlan
} from "./parseResearchPlan";
import {
  DEEPLY_RESEARCH_OUTLINE_BLOCK_TYPE,
  isDeeplyResearchOutlineStream,
  parseDeeplyResearchOutline
} from "./parseResearchOutline";
import { BookCandidateCard, isDeeplyBookCandidate } from "./BookCandidateCard";
import {
  parseDeeplyBookCandidates,
  DEEPLY_BOOK_CANDIDATES_BLOCK_TYPE,
  DEEPLY_BOOK_CANDIDATE_BLOCK_TYPE
} from "./parseBookCandidates";
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
  // ─── Book candidates(Phase A:从一本书入门 disambiguation)优先识别 ───
  // 出现 koko.deeply.book.candidates fenced block 时,把它解开成 intro prose
  // + N 张 BookCandidateCard message。**不触发 outline 落库**,bootstrap
  // 仍是 loading,等用户点卡片走 Phase B。
  const candidatesBlock = extractFencedBlock(text, DEEPLY_BOOK_CANDIDATES_BLOCK_TYPE);
  if (candidatesBlock !== null) {
    const prose = text.slice(0, candidatesBlock.start).trim();
    const candidatesParsed = parseDeeplyBookCandidates(text);
    if (!candidatesParsed.ok) {
      console.warn("[deeply-course] book.candidates parse failed:", candidatesParsed.error);
      useConversationStore.getState().setBootstrap(conversation.id, {
        status: "error",
        error: `候选书目格式没能解析:${truncate(candidatesParsed.error, 120)}`
      });
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
        text: `🚫 候选书目格式没能解析(${truncate(candidatesParsed.error, 80)})。可以在 chat 里直接告诉我作者 / 出版年份,我换一种方式再试。`,
        runId,
        streaming: false
      } satisfies ChatMessage);
      return { messages, preview: "候选书目格式错误" };
    }

    const { intro, candidates } = candidatesParsed.value;
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
    if (intro.length > 0) {
      messages.push({
        id: `${runId}-intro`,
        role: "agent",
        text: intro,
        runId,
        streaming: false
      } satisfies ChatMessage);
    }
    for (let i = 0; i < candidates.length; i += 1) {
      messages.push({
        id: `${runId}-cand-${i}`,
        role: "agent",
        text: "",
        runId,
        streaming: false,
        blocks: [
          {
            type: DEEPLY_BOOK_CANDIDATE_BLOCK_TYPE,
            version: 1,
            data: candidates[i]
          }
        ]
      } satisfies ChatMessage);
    }
    return {
      messages,
      preview: `${candidates.length} 本候选书,等你选一本`
    };
  }

  // ─── Phase A research plan(深度调研课程第一阶段产物)───
  // Agent 在脑暴轮结尾输出 `koko.deeply.research.plan` fenced block:
  // courseTitle + introduction + sections[title + searchHint]。客户端在这里:
  //   1. 把 fenced block 之前的 prose 留下来(用户已经在 stream 里看过了)
  //   2. 剪掉 fenced block 本身(用户不需要看 raw JSON)
  //   3. 直接把目录落库 + 切 ready(没有后续 outline inferOnce 阶段了)。
  //      每节的资料留到用户进入该节讲解时,由讲解 prompt 临场联网搜。
  const planBlock = extractFencedBlock(text, DEEPLY_RESEARCH_PLAN_BLOCK_TYPE);
  if (planBlock !== null) {
    const prose = text.slice(0, planBlock.start).trim();
    const planParsed = parseDeeplyResearchPlan(text);

    if (!planParsed.ok) {
      console.warn("[deeply-course] research.plan parse failed:", planParsed.error);
      useConversationStore.getState().setBootstrap(conversation.id, {
        status: "error",
        error: `课程目录格式没能解析:${truncate(planParsed.error, 120)}`
      });
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
        text: `🚫 课程目录格式没能解析(${truncate(planParsed.error, 80)})。\n你可以右上角归档这门课,然后回 Deeply 探索重新开一个。`,
        runId,
        streaming: false
      } satisfies ChatMessage);
      return { messages, preview: "课程目录格式错误" };
    }

    applyResearchPlanToCourse(conversation.id, planParsed.value);

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
    // 目录已直接落库 ready。过桥消息告诉用户可以开始,每节资料讲解时再搜。
    messages.push({
      id: `${runId}-handoff`,
      role: "agent",
      text: `课程目录已生成(${planParsed.value.sections.length} 节)。点下方「开始第 1 节」就能学,每节我会现查最新资料再讲。`,
      runId,
      streaming: false
    } satisfies ChatMessage);
    return {
      messages,
      preview: `目录已生成 · ${planParsed.value.sections.length} 节`
    };
  }

  const block = extractFencedBlock(text, DEEPLY_RESEARCH_OUTLINE_BLOCK_TYPE);
  if (block === null) {
    // 没 fenced block(普通讲解 turn):兜底 dedup 重复节标题。如果有改动
    // 就返回一条 modified message;没改返回 null 让 host 用 raw text。
    const dedupedText = dedupSectionHeadings(text);
    if (dedupedText === text) return null;
    return {
      messages: [
        {
          id: runId,
          role: "agent",
          text: dedupedText,
          runId,
          streaming: false
        } satisfies ChatMessage
      ]
    };
  }

  // 不管 parse 成不成功,fenced block 永远从可见 chat 文本里剪掉。
  const prose = text.slice(0, block.start).trim();
  const parsed = parseDeeplyResearchOutline(text);

  if (!parsed.ok) {
    console.warn("[deeply-course] research outline parse failed:", parsed.error);
    const noVerifiedSources = parsed.error.includes("可验证来源");
    useConversationStore.getState().setBootstrap(conversation.id, {
      status: "error",
      error: noVerifiedSources
        ? "这次搜索没有拿到可验证来源,请稍后重试或换一个资料链接"
        : `调研结果格式没能解析:${truncate(parsed.error, 120)}`
    });
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
      text: noVerifiedSources
        ? "🚫 这次搜索没有拿到可验证来源,我没有创建这门调研课。可以稍后重试,或换成「基于一个链接」从可靠资料开始。"
        : `🚫 调研结果格式没能解析(${truncate(parsed.error, 80)})。
你可以右上角归档这门课,然后回 Deeply 探索重新开一个 —— 同一题目重发,agent 通常二次就能 produce 正确结构。`,
      runId,
      streaming: false
    } satisfies ChatMessage);
    return {
      messages,
      preview: noVerifiedSources ? "搜索没有拿到可验证来源" : "调研结果格式错误"
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
    // 老 record 没 url(或路径上压根没 record)时,把 label 当 fallback URL —
    // material kickoff visibleText 现在只在 "基于一个链接" 路径会出现,label
    // 本身就是用户贴的 URL。
    const url = material?.url ?? materialKickoff.label;
    return {
      visibleText,
      gatewayText: buildMaterialKickoffPrompt({
        label: material?.label ?? materialKickoff.label,
        url,
        sections: materialKickoff.sections
      })
    };
  }

  // 用户点候选卡片后,客户端 dispatch 了一条 "我选《XX》..." visible text
  // 给 agent。这条 chosen 路径优先匹配 —— 它必须先于 bookKickoff 检查,
  // 否则会被误透传(visibleText 不是 kickoff regex,但也不是 mainline,
  // 会兜底走 dialog prompt,丢掉本节是"开始出 outline"的语义)。
  const bookChosen = parseDeeplyBookChosen(visibleText);
  if (bookChosen !== null) {
    const record = loadDeeplyCourseSessionRecord(conversation.id);
    // book(候选选定后)和 library(从一开始就 disambiguated)都走 outline prompt。
    if (record?.kind === "book" || record?.kind === "library") {
      return {
        visibleText,
        gatewayText: buildBookOutlinePrompt({
          title: bookChosen.title,
          ...(bookChosen.meta !== undefined ? { meta: bookChosen.meta } : {}),
          sections: record.sections,
          visibleText
        })
      };
    }
  }

  const bookKickoff = parseDeeplyBookKickoff(visibleText);
  if (bookKickoff !== null) {
    const record = loadDeeplyCourseSessionRecord(conversation.id);
    const book = record?.bookInput;
    return {
      visibleText,
      gatewayText: buildBookKickoffPrompt({
        // 优先用 storage 里的精确字段(title/author/edition 分开);兜底
        // 用 visible label 一整段(disambiguation 还能 work,但少一点 hint)。
        title: book?.title ?? bookKickoff.label,
        ...(book?.author !== undefined ? { author: book.author } : {}),
        ...(book?.edition !== undefined ? { edition: book.edition } : {}),
        sections: bookKickoff.sections
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

    // Research / material / book / library 课:每节由 agent 临场基于 sources
    // (+ web tools / 用户资料)创作内容,走 buildResearchCourseSectionPrompt。
    // 4 种 kind 共用同一个 prompt builder,只在 kind 参数上区分文案侧重 —
    // research 鼓励通过托管搜索拿新角度,material 优先用用户给的资料、
    // book / library 围绕原书章节结构 + 权威解读。library 跟 book 共用
    // section prompt(都是"围绕这本书讲解",来源不同只在 kickoff 阶段)。
    if (
      record.kind === "research" ||
      record.kind === "material" ||
      record.kind === "book" ||
      record.kind === "library"
    ) {
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
      // library 在讲解阶段跟 book 完全同质(都是"围绕这本书讲解"),
      // 把 kind="library" 映射成 "book" 复用 prompt 文案。
      const sectionKind = record.kind === "library" ? "book" : record.kind;
      return {
        visibleText,
        gatewayText: buildResearchCourseSectionPrompt({
          kind: sectionKind,
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

/**
 * "+ menu" entry for Deeply.
 *
 * The mini-app itself owns `/deeply`, but tapping the `+` launcher should mean
 * "start a fresh thread with this app", just like Koko and 酒馆. Returning to
 * an old Deeply row in the chat list still opens that old conversation. Direct
 * route access to `/deeply` continues to fall back to the singleton explore
 * conversation inside DeeplyExploreScreen.
 */
function createDeeplyExploreConversation(): ConversationMeta {
  return useConversationStore.getState().create({
    mode: DEEPLY_MINI_APP_ID,
    title: "Deeply 知识探索",
    sessionScope: `explore:${Date.now().toString(36)}`,
    listSnapshot: {
      title: "Deeply 知识探索",
      subtitle: "陪你引经据典地聊一聊"
    }
  });
}

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
    launcherSubtitle: "陪你引经据典地聊一聊",
    showInLauncher: true,
    listGlyph: "📖",
    listImage: deeplyAvatarChatBuddy,
    onCreate: createDeeplyExploreConversation,
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
    // Streaming 期间做两件事:
    //   1. 截掉任何已知 fence opener 之后的 raw JSON,只让 prose narration 可见
    //      (research.plan / research.outline / book.candidates)
    //   2. 兜底 dedup `## 第N节:...` 重复标题(agent 在 tool call 之间偶尔
    //      会重新打一次,prompt 已禁但 LLM 不一定 100% 听话)
    streamingDisplayText: ({ text }) => {
      let display = text;
      const fenceTypes = [
        "```" + DEEPLY_RESEARCH_PLAN_BLOCK_TYPE,
        "```" + DEEPLY_RESEARCH_OUTLINE_BLOCK_TYPE,
        "```" + DEEPLY_BOOK_CANDIDATES_BLOCK_TYPE
      ];
      let firstFenceIdx = -1;
      for (const c of fenceTypes) {
        const idx = display.indexOf(c);
        // idx >= 0 (not > 0): if the agent leads with the fenced JSON and no
        // prose, the block is at index 0 — we still want to hide it during
        // streaming, otherwise raw JSON flashes then vanishes on final.
        if (idx >= 0 && (firstFenceIdx === -1 || idx < firstFenceIdx)) firstFenceIdx = idx;
      }
      if (firstFenceIdx >= 0) display = display.slice(0, firstFenceIdx).trimEnd();
      display = dedupSectionHeadings(display);
      return display === text ? null : display;
    }
  });
  void isDeeplyResearchOutlineStream;
  registerSharedBlockRenderer(
    DEEPLY_CARD_BLOCK_TYPE,
    isDeeplyRecommendationCard,
    DeeplyRecommendationCard
  );
  registerSharedBlockRenderer(
    DEEPLY_BOOK_CANDIDATE_BLOCK_TYPE,
    isDeeplyBookCandidate,
    BookCandidateCard
  );

  void DEEPLY_RECOMMENDATIONS_BLOCK_TYPE;
}
