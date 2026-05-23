import { getMiniAppStorage } from "@/runtime/miniAppStorage";
import { openConversation } from "@/runtime/navigation";
import { useConversationStore } from "@/state/conversations";
import type { OpenClawChatAttachment } from "@/state/gateway";

import { DEEPLY_MINI_APP_ID } from "./constants";
import { initDeeplyCourseProgress } from "./courseProgress";
import { inferCourseOutline } from "./inferCourseOutline";
import type {
  DeeplyCourseBrief,
  DeeplyCourseBriefOption
} from "./parseCourseBrief";
import type { DeeplyOutlineSection } from "./parseCourseOutline";
import type {
  DeeplyCardKind,
  DeeplyRecommendationCard
} from "./parseRecommendations";
import type {
  DeeplyResearchOutline,
  DeeplyResearchSource
} from "./parseResearchOutline";

export const DEEPLY_COURSE_MODE_ID = "deeply-course";
const STORAGE = getMiniAppStorage(DEEPLY_MINI_APP_ID);

/**
 * Persisted snapshot of "what the user configured before starting this course".
 * Lives in mini-app scoped storage keyed by the conversation id, so the course
 * surface can read it on first mount without re-running the brief inference.
 *
 * The shape stays explicit (not just the raw brief) so the future course
 * surface knows the user's actual choices (sections, option values), not just
 * what was offered.
 *
 * `kind` 区分两种创建路径:
 *   - "topic"(默认 / 缺省):由 explore 推荐卡 → CourseDetailSheet 启动,
 *      outline 由 inferCourseOutline 在后台生成。
 *   - "research":由 CourseCustomizeSheet 的"深度调研"入口启动,outline
 *      不通过 inferCourseOutline 单跑,而是 course surface 自动 fire 一条
 *      引导消息给 mainline session,由 agent 边搜边汇报后输出 outline。
 */
export type DeeplyCourseSessionKind = "topic" | "research" | "material";

export interface DeeplyCourseSessionRecord {
  schemaVersion: 1;
  /** "topic" by default; older records without this field are also treated as "topic". */
  kind?: DeeplyCourseSessionKind;
  cardKind: DeeplyCardKind;
  title: string;
  subtitle: string;
  reason: string;
  introduction: string;
  sections: number;
  sectionPreset: "light" | "standard" | "deep";
  optionChoices: Array<{
    optionId: string;
    optionTitle: string;
    choiceValue: string;
    choiceLabel: string;
  }>;
  /**
   * Research-only:用户在 CourseCustomizeSheet 输入的原始主题。后续 phase B
   * 会把它注入到给 mainline session 的 research 引导消息里。
   */
  researchTopic?: string;
  materialInput?: {
    sourceKind: "url" | "file";
    label: string;
    url?: string;
    attachments?: OpenClawChatAttachment[];
  };
  parentConversationId?: string;
  startedAt: number;
}

const COURSE_RECORD_PREFIX = "course.";
const COURSE_OUTLINE_PREFIX = "outline.";
const COURSE_SOURCES_PREFIX = "sources.";

export interface DeeplyCourseOutlineRecord {
  schemaVersion: 1;
  markdown: string;
  /**
   * Research 课每节附带 sources(准备阶段挂的资料指针),普通课没有
   * (sources 字段为空数组 / 不存在)。讲解 mainline prompt 直接从这里
   * 读 per-section sources。
   *
   * 类型扩成 DeeplyOutlineSection & { sources? } —— 兼容老 schema 持久化的
   * 数据(只有 index + title)+ 新 research schema(带 sources)。
   */
  sections: Array<DeeplyOutlineSection & {
    sources?: Array<{
      title: string;
      url: string;
      stance: "primary" | "counterpoint" | "background";
      snippet: string;
    }>;
  }>;
  generatedAt: number;
}

/**
 * Research 课程专用:agent 在调研阶段拿到并 cite 的 sources。后续每节
 * mainline 讲解时,把相关 sources 注入 prompt,让 agent 在讲解里 cite。
 * 普通 topic 课程没这条 storage。
 */
export interface DeeplyCourseSourcesRecord {
  schemaVersion: 1;
  sources: DeeplyResearchSource[];
  generatedAt: number;
}

export interface StartDeeplyCourseInput {
  card: DeeplyRecommendationCard;
  brief: DeeplyCourseBrief;
  sections: number;
  sectionPreset: "light" | "standard" | "deep";
  optionChoices: Record<string, string>;
  parentConversationId: string | null;
}

/**
 * Spawn a new `deeply-course` conversation, persist the session config,
 * kick off outline generation in the background, and navigate to the
 * course surface. The course surface is registered as a route-backed
 * conversation mode, so `openConversation()` pushes `/deeply/course/[id]`.
 *
 * Bootstrap state is set to `loading` while the outline is being generated.
 * The course surface reads this state to show a loading banner and lock
 * input. When the outline is ready, bootstrap flips to `ready` and the
 * progress store is seeded with the section count.
 */
export async function startDeeplyCourseSession(input: StartDeeplyCourseInput): Promise<void> {
  const store = useConversationStore.getState();
  const meta = store.create({
    mode: DEEPLY_COURSE_MODE_ID,
    title: input.card.title,
    sessionScope: `${slug(input.card.title)}:${Date.now().toString(36)}`,
    ...(input.parentConversationId !== null
      ? { parentConversationId: input.parentConversationId }
      : {}),
    artifactRef: {
      type: "koko.deeply.course",
      id: input.card.title,
      miniAppId: DEEPLY_MINI_APP_ID
    },
    listSnapshot: {
      title: input.card.title,
      subtitle:
        input.card.subtitle.length > 0 ? input.card.subtitle : input.card.reason.slice(0, 64),
      icon: "📖"
    },
    bootstrap: {
      status: "loading",
      hint: "正在生成课程目录,准备好就可以开讲了"
    }
  });

  const record: DeeplyCourseSessionRecord = {
    schemaVersion: 1,
    kind: "topic",
    cardKind: input.card.kind,
    title: input.card.title,
    subtitle: input.card.subtitle,
    reason: input.card.reason,
    introduction: input.brief.introduction,
    sections: input.sections,
    sectionPreset: input.sectionPreset,
    optionChoices: input.brief.options.map((option) =>
      buildOptionChoice(option, input.optionChoices)
    ),
    ...(input.parentConversationId !== null
      ? { parentConversationId: input.parentConversationId }
      : {}),
    startedAt: Date.now()
  };
  STORAGE.setJson(`${COURSE_RECORD_PREFIX}${meta.id}`, record);

  openConversation(meta.id);

  void generateOutlineInBackground(meta.id, record);
}

export interface StartDeeplyResearchCourseInput {
  /** User-provided raw topic from the customize sheet. */
  topic: string;
  sections: number;
  sectionPreset: "light" | "standard" | "deep";
  parentConversationId: string | null;
}

export interface StartDeeplyMaterialCourseInput {
  label: string;
  sourceKind: "url" | "file";
  url?: string;
  attachments?: OpenClawChatAttachment[];
  sections: number;
  sectionPreset: "light" | "standard" | "deep";
  parentConversationId: string | null;
}

/**
 * 启动一个"深度调研"型 course conversation。
 *
 * 跟 `startDeeplyCourseSession` 的区别:
 *   - kind = "research"
 *   - card / brief / option choices 都不存在(用户没经过推荐卡),这些字段
 *     填充占位值,reader 侧根据 kind 判断不读它们。
 *   - **不**调 generateOutlineInBackground —— outline 由 phase B 在 course
 *     surface 内通过 mainline session fire research 引导消息后,由 agent
 *     边搜边汇报最终输出。这里只把 conversation 起好,banner 切到 research
 *     文案,跳转过去。
 */
export async function startDeeplyResearchCourse(
  input: StartDeeplyResearchCourseInput
): Promise<void> {
  const store = useConversationStore.getState();
  const topic = input.topic.trim();
  if (topic.length === 0) {
    throw new Error("research topic is empty");
  }
  const meta = store.create({
    mode: DEEPLY_COURSE_MODE_ID,
    title: topic,
    sessionScope: `research:${slug(topic)}:${Date.now().toString(36)}`,
    ...(input.parentConversationId !== null
      ? { parentConversationId: input.parentConversationId }
      : {}),
    artifactRef: {
      type: "koko.deeply.course",
      id: `research:${topic}`,
      miniAppId: DEEPLY_MINI_APP_ID
    },
    listSnapshot: {
      title: topic,
      subtitle: "深度调研 · 正在准备",
      icon: "🔍"
    },
    bootstrap: {
      status: "loading",
      hint: "正在围绕这个主题做调研,通常需要 3-10 分钟。你可以先去做别的,完成后回到这里就能开始学。"
    }
  });

  const record: DeeplyCourseSessionRecord = {
    schemaVersion: 1,
    kind: "research",
    // research 课程没有"卡片"概念,这里给占位值让 schema 不带可选 union 复杂度,
    // reader 侧用 record.kind 切分逻辑,而不是去看这些字段。
    cardKind: "topic",
    title: topic,
    subtitle: "",
    reason: "",
    introduction: "",
    sections: input.sections,
    sectionPreset: input.sectionPreset,
    optionChoices: [],
    researchTopic: topic,
    ...(input.parentConversationId !== null
      ? { parentConversationId: input.parentConversationId }
      : {}),
    startedAt: Date.now()
  };
  STORAGE.setJson(`${COURSE_RECORD_PREFIX}${meta.id}`, record);

  openConversation(meta.id);

  // 故意不调 generateOutlineInBackground。research 路径的 outline 由
  // phase B 引入的 DeeplyCourseScreen 自动 fire research request 流程产生。
}

export async function startDeeplyMaterialCourse(
  input: StartDeeplyMaterialCourseInput
): Promise<void> {
  const store = useConversationStore.getState();
  const label = input.label.trim();
  if (label.length === 0) {
    throw new Error("material label is empty");
  }
  const meta = store.create({
    mode: DEEPLY_COURSE_MODE_ID,
    title: label,
    sessionScope: `material:${slug(label)}:${Date.now().toString(36)}`,
    ...(input.parentConversationId !== null
      ? { parentConversationId: input.parentConversationId }
      : {}),
    artifactRef: {
      type: "koko.deeply.course",
      id: `material:${label}`,
      miniAppId: DEEPLY_MINI_APP_ID
    },
    listSnapshot: {
      title: label,
      subtitle: input.sourceKind === "url" ? "基于链接 · 正在准备" : "基于文件 · 正在准备",
      icon: "📎"
    },
    bootstrap: {
      status: "loading",
      hint:
        input.sourceKind === "url"
          ? "正在读取这份链接资料,准备把它拆成一门课。"
          : "正在把你上传的文件交给 OpenClaw,准备拆成一门课。"
    }
  });

  const record: DeeplyCourseSessionRecord = {
    schemaVersion: 1,
    kind: "material",
    cardKind: "topic",
    title: label,
    subtitle: "",
    reason: "",
    introduction: "",
    sections: input.sections,
    sectionPreset: input.sectionPreset,
    optionChoices: [],
    researchTopic: label,
    materialInput: {
      sourceKind: input.sourceKind,
      label,
      ...(input.url !== undefined ? { url: input.url } : {}),
      ...(input.attachments !== undefined && input.attachments.length > 0
        ? { attachments: input.attachments }
        : {})
    },
    ...(input.parentConversationId !== null
      ? { parentConversationId: input.parentConversationId }
      : {}),
    startedAt: Date.now()
  };
  STORAGE.setJson(`${COURSE_RECORD_PREFIX}${meta.id}`, record);

  openConversation(meta.id);
}

async function generateOutlineInBackground(
  conversationId: string,
  record: DeeplyCourseSessionRecord
): Promise<void> {
  const store = useConversationStore.getState();
  try {
    const result = await inferCourseOutline({
      courseTitle: record.title,
      courseSubtitle: record.subtitle.length > 0 ? record.subtitle : record.reason.slice(0, 64),
      introduction: record.introduction,
      targetSections: record.sections
    });
    if (!result.ok) {
      store.setBootstrap(conversationId, {
        status: "error",
        error: `课程目录生成失败:${result.error.slice(0, 200)}`
      });
      return;
    }
    const outline: DeeplyCourseOutlineRecord = {
      schemaVersion: 1,
      markdown: result.outlineMarkdown,
      sections: result.sections,
      generatedAt: Date.now()
    };
    STORAGE.setJson(`${COURSE_OUTLINE_PREFIX}${conversationId}`, outline);
    initDeeplyCourseProgress(conversationId, result.sections);
    store.setBootstrap(conversationId, { status: "ready" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.setBootstrap(conversationId, {
      status: "error",
      error: `课程目录生成失败:${message.slice(0, 200)}`
    });
  }
}

export function loadDeeplyCourseOutline(
  conversationId: string
): DeeplyCourseOutlineRecord | null {
  return (
    STORAGE.getJson<DeeplyCourseOutlineRecord>(`${COURSE_OUTLINE_PREFIX}${conversationId}`) ?? null
  );
}

export function loadDeeplyCourseSources(
  conversationId: string
): DeeplyCourseSourcesRecord | null {
  return (
    STORAGE.getJson<DeeplyCourseSourcesRecord>(`${COURSE_SOURCES_PREFIX}${conversationId}`) ?? null
  );
}

/**
 * Research 路径 agent 最后吐出的 outline fenced block 被 transformer 解析后,
 * 走这里落地:更新 record.introduction、写 outline + sources storage、
 * 初始化 progress、把 bootstrap 切到 ready。
 *
 * 之后 DeeplyCourseScreen 就能正常按 mainline 流程跑(banner 消失、
 * 显示 "开始第 1 节" chip、目录抽屉能用)。
 */
export function applyResearchOutlineToCourse(
  conversationId: string,
  outline: DeeplyResearchOutline
): void {
  const record = loadDeeplyCourseSessionRecord(conversationId);
  if (record === null) {
    console.warn(
      "[deeply-course] applyResearchOutlineToCourse: no record",
      conversationId
    );
    return;
  }

  const updatedRecord: DeeplyCourseSessionRecord = {
    ...record,
    introduction: outline.introduction,
    // agent 可能根据课题自然结构上下浮动节数,这里以 agent 实际产出为准。
    sections: outline.sections.length
  };
  STORAGE.setJson(`${COURSE_RECORD_PREFIX}${conversationId}`, updatedRecord);

  const outlineRecord: DeeplyCourseOutlineRecord = {
    schemaVersion: 1,
    markdown: outline.outlineMarkdown,
    sections: outline.sections,
    generatedAt: Date.now()
  };
  STORAGE.setJson(`${COURSE_OUTLINE_PREFIX}${conversationId}`, outlineRecord);

  const sourcesRecord: DeeplyCourseSourcesRecord = {
    schemaVersion: 1,
    sources: outline.sources,
    generatedAt: Date.now()
  };
  STORAGE.setJson(`${COURSE_SOURCES_PREFIX}${conversationId}`, sourcesRecord);

  initDeeplyCourseProgress(conversationId, outline.sections);
  useConversationStore.getState().setBootstrap(conversationId, { status: "ready" });
}

/**
 * 用户点 bootstrap error banner 的「重试」按钮时调:
 * - bootstrap 改回 loading,banner 切回 spinner
 * - 后台重新跑 outline 生成,完成时再 set ready / error
 *
 * 如果 conversation / record 找不到(已被归档),静默返回。
 */
export function retryDeeplyCourseOutline(conversationId: string): void {
  const store = useConversationStore.getState();
  const record = loadDeeplyCourseSessionRecord(conversationId);
  if (record === null) return;
  store.setBootstrap(conversationId, {
    status: "loading",
    hint: "正在重新为你定课程目录,稍等一下"
  });
  void generateOutlineInBackground(conversationId, record);
}

export function loadDeeplyCourseSessionRecord(
  conversationId: string
): DeeplyCourseSessionRecord | null {
  const record = STORAGE.getJson<DeeplyCourseSessionRecord>(
    `${COURSE_RECORD_PREFIX}${conversationId}`
  );
  return record ?? null;
}

function buildOptionChoice(
  option: DeeplyCourseBriefOption,
  optionChoices: Record<string, string>
): DeeplyCourseSessionRecord["optionChoices"][number] {
  const chosenValue = optionChoices[option.id] ?? option.defaultValue;
  const choice = option.choices.find((c) => c.value === chosenValue) ?? option.choices[0];
  return {
    optionId: option.id,
    optionTitle: option.title,
    choiceValue: choice?.value ?? chosenValue,
    choiceLabel: choice?.label ?? chosenValue
  };
}

function slug(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "course";
}
