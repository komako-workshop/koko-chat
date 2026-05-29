import { getMiniAppStorage } from "@/runtime/miniAppStorage";
import { openConversation } from "@/runtime/navigation";
import { useConversationStore } from "@/state/conversations";

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
import type { DeeplyResearchPlan } from "./parseResearchPlan";
import type {
  DeeplyResearchOutline,
  DeeplyResearchSource
} from "./parseResearchOutline";
import { getCategoryStyle } from "./library/libraryTheme";

export const DEEPLY_COURSE_MODE_ID = "deeply-course";
const STORAGE = getMiniAppStorage(DEEPLY_MINI_APP_ID);

/**
 * Short label drawn on top of a coloured swatch when a library course's book
 * has no real cover image. Mirrors BookCoverImage's title fallback inside the
 * library, but constrained to 2 CJK chars / 3 latin letters so it stays
 * legible inside the ~48px chat-list avatar slot.
 *
 * Strategy:
 *   - Strip subtitle after the first ":" / "：" / "—" / "-" / "(" / "（".
 *   - Take the first non-whitespace codepoints.
 *   - 拉丁开头 → up to 3 letters, uppercased.
 *   - 其他(CJK/混合) → 前 2 个 codepoint。
 */
function makeBookGlyphLabel(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) return "书";
  const head = trimmed.split(/[:：\-—()（）]/)[0]?.trim() ?? trimmed;
  const source = head.length > 0 ? head : trimmed;
  const chars = Array.from(source).filter((c) => c.trim().length > 0);
  if (chars.length === 0) return "书";
  const first = chars[0]!;
  const isLatin = /^[A-Za-z]$/.test(first);
  if (isLatin) {
    return chars.slice(0, 3).join("").toUpperCase();
  }
  return chars.slice(0, 2).join("");
}

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
export type DeeplyCourseSessionKind = "topic" | "research" | "material" | "book" | "library";

/**
 * 课程长度 preset。
 *
 * - `auto`:不指定节数。record.sections=0。
 * - `light`(8 节)、`standard`(24 节,legacy)、`deep`(24 节):用户用 preset 指定具体节数。
 * - `custom`:用户自己填一个节数。
 *
 * `standard` 是早期 sheet 的 default,保留兼容已有 record 反序列化;新 sheet
 * 不再渲染 standard 选项。
 */
export type SectionPreset = "auto" | "light" | "standard" | "deep" | "custom";

export interface DeeplyCourseSessionRecord {
  schemaVersion: 1;
  /** "topic" by default; older records without this field are also treated as "topic". */
  kind?: DeeplyCourseSessionKind;
  cardKind: DeeplyCardKind;
  title: string;
  subtitle: string;
  reason: string;
  introduction: string;
  /**
   * 课程目标节数。
   *
   * - `0` 表示「自动」:创建阶段不指定节数。outline 落库后
   *   `applyResearchOutlineToCourse` 会覆盖为实际节数。
   * - 大于 0:用户指定的具体节数(可能是 preset 8/24,也可能是自定义)。
   */
  sections: number;
  sectionPreset: SectionPreset;
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
  /**
   * Research-only:Phase A(agent 脑暴轮)产出的课程目录 plan
   * (courseTitle / introduction / sections[title + searchHint])。
   * 缓存在 record 里有两个用途:
   *
   *   1. Phase B inferOnce 失败时,用户在 bootstrap error banner 上点重试,
   *      可以直接重做 Phase B 而不用让 agent 再脑暴一遍。
   *   2. 调试时可以离线 inspect agent 设计的目录。
   *
   * Phase A 成功一次就写一次,后续不再变。Phase B 反复重试只读它、不改它。
   */
  cachedResearchPlan?: DeeplyResearchPlan;
  /**
   * Material-only:用户在 CourseCustomizeSheet "基于一个链接" 里贴的 URL。
   *
   * 历史上 sourceKind 还可以是 "file"(本地文件 base64 走 chat attachments),
   * 但 OpenClaw `chat.send.attachments` 只支持图片(5MB / 25MB WS frame 限),
   * 长文件没法走过去 — MVP 阶段先只保留 URL 入口。schema 保留 sourceKind 字段
   * 是为了反序列化老 record。
   */
  materialInput?: {
    sourceKind: "url" | "file";
    label: string;
    url?: string;
  };
  /**
   * Book-only:用户在 CourseCustomizeSheet "从一本书入门" 里输入的元数据。
   * 跟 research 走同样的 kickoff → 托管搜索 → outline 流程,但 prompt
   * 侧重不同:agent 会先 disambiguate 书的版本,然后围绕书的章节结构出 outline。
   */
  bookInput?: {
    title: string;
    author?: string;
    edition?: string;
  };
  /**
   * Library-only:从预置课程库("右上角 📚")开始的课程。书已经在 metadata
   * 里 disambiguated 好(title + author 都准确),所以**直接走 book Phase B**
   * outline 生成,跳过候选 disambiguation。
   *
   * 同时把 hook / pitch / echo 等 deeply 现成文案带进 record,后续 prompt 可
   * inline 作为 hint(让 outline 更贴合 deeply 已有的内容调性)。
   */
  libraryInput?: {
    /** kg_xxx 稳定 id。 */
    bookId: string;
    title: string;
    author: string;
    /** category 中文名 */
    category: string;
    /** hook 副标题(book.h)*/
    hook: string;
    /** pitch 长文案(book.p)*/
    pitch: string;
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
  // ↓ 下面的 sections/sectionPreset 也支持 auto:sections=0 时不指定长度。
  brief: DeeplyCourseBrief;
  sections: number;
  sectionPreset: SectionPreset;
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
  sectionPreset: SectionPreset;
  parentConversationId: string | null;
}

export interface StartDeeplyMaterialCourseInput {
  /** 用户输入的 URL,直接当 label / subtitle 用。 */
  label: string;
  /** 用户贴的 URL — 必填(本地文件入口已下线)。 */
  url: string;
  sections: number;
  sectionPreset: SectionPreset;
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
  const url = input.url.trim();
  if (label.length === 0) throw new Error("material label is empty");
  if (url.length === 0) throw new Error("material url is empty");

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
      subtitle: "基于链接 · 正在准备",
      icon: "🔗"
    },
    bootstrap: {
      status: "loading",
      hint: "正在读取这份链接资料,准备把它拆成一门课。"
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
      sourceKind: "url",
      label,
      url
    },
    ...(input.parentConversationId !== null
      ? { parentConversationId: input.parentConversationId }
      : {}),
    startedAt: Date.now()
  };
  STORAGE.setJson(`${COURSE_RECORD_PREFIX}${meta.id}`, record);

  openConversation(meta.id);
}

export interface StartDeeplyBookCourseInput {
  /** 用户输入的书名(必填)。 */
  title: string;
  /** 可选作者,大幅降低书目歧义。 */
  author?: string;
  /** 可选版本 / 年份提示(如 "2005 扩充版")。 */
  edition?: string;
  sections: number;
  sectionPreset: SectionPreset;
  parentConversationId: string | null;
}

/**
 * 启动一个"从一本书入门"型 course conversation。
 *
 * 跟 research / material 完全同形:不调 inferCourseOutline,outline 由 course
 * surface 自动 fire book kickoff 消息后由 agent 通过托管搜索找资料后产出。
 *
 * 跟 research 的核心差别在 prompt 文案:agent 会先 disambiguate 书的版本
 * (narration 里显式说"我理解你说的是 X 作者 Y 年版本,如不是请告诉我"),
 * 然后围绕该书的章节结构出 outline,sources 倾向书评 / chapter summary /
 * 知名解读,而不是 research 那种争议视角。
 */
export async function startDeeplyBookCourse(
  input: StartDeeplyBookCourseInput
): Promise<void> {
  const store = useConversationStore.getState();
  const title = input.title.trim();
  if (title.length === 0) {
    throw new Error("book title is empty");
  }
  const author = input.author?.trim();
  const edition = input.edition?.trim();
  // listSnapshot / window title 用「书名 · 作者」更易识别。
  const displayLabel = author !== undefined && author.length > 0
    ? `${title} · ${author}`
    : title;

  const meta = store.create({
    mode: DEEPLY_COURSE_MODE_ID,
    title: displayLabel,
    sessionScope: `book:${slug(title)}:${Date.now().toString(36)}`,
    ...(input.parentConversationId !== null
      ? { parentConversationId: input.parentConversationId }
      : {}),
    artifactRef: {
      type: "koko.deeply.course",
      id: `book:${title}`,
      miniAppId: DEEPLY_MINI_APP_ID
    },
    listSnapshot: {
      title: displayLabel,
      subtitle: "从一本书入门 · 正在准备",
      icon: "📚"
    },
    bootstrap: {
      status: "loading",
      hint: "正在确认这本书的版本 + 找它的章节解读,通常需要 1-3 分钟。"
    }
  });

  const record: DeeplyCourseSessionRecord = {
    schemaVersion: 1,
    kind: "book",
    cardKind: "topic",
    title: displayLabel,
    subtitle: "",
    reason: "",
    introduction: "",
    sections: input.sections,
    sectionPreset: input.sectionPreset,
    optionChoices: [],
    researchTopic: displayLabel,
    bookInput: {
      title,
      ...(author !== undefined && author.length > 0 ? { author } : {}),
      ...(edition !== undefined && edition.length > 0 ? { edition } : {})
    },
    ...(input.parentConversationId !== null
      ? { parentConversationId: input.parentConversationId }
      : {}),
    startedAt: Date.now()
  };
  STORAGE.setJson(`${COURSE_RECORD_PREFIX}${meta.id}`, record);

  openConversation(meta.id);
}

export interface StartDeeplyLibraryCourseInput {
  /** kg_xxx 稳定 id. */
  bookId: string;
  title: string;
  author: string;
  category: string;
  /** book.h 副标题。 */
  hook: string;
  /** book.p 推荐文案。 */
  pitch: string;
  /**
   * book.img — 书本封面 URL(library-pool 里已经填好的)。
   * 用作聊天列表 row 的头像;空时落回 deeply mini-app 默认头像。
   */
  cover?: string;
  /** 用户选择的长度;0 = 自动。 */
  sections: number;
  parentConversationId: string | null;
}

/**
 * 启动一个"从课程库选的"课程。
 *
 * 跟从一本书入门(book)的差别:metadata 已经精确,直接走 book Phase B
 * (outline 生成)。客户端在 DeeplyCourseScreen 里专门为 kind="library"
 * 加了 kickoff 路径,dispatch buildBookCandidateChosenVisibleText —— 这
 * 条 visibleText 命中 outbound builder 的 chosen path → buildBookOutlinePrompt。
 */
export async function startDeeplyLibraryCourse(
  input: StartDeeplyLibraryCourseInput
): Promise<void> {
  const store = useConversationStore.getState();
  const title = input.title.trim();
  if (title.length === 0) {
    throw new Error("library course title is empty");
  }
  const displayLabel = `${title} · ${input.author}`;

  const meta = store.create({
    mode: DEEPLY_COURSE_MODE_ID,
    title: displayLabel,
    sessionScope: `library:${slug(title)}:${Date.now().toString(36)}`,
    ...(input.parentConversationId !== null
      ? { parentConversationId: input.parentConversationId }
      : {}),
    artifactRef: {
      type: "koko.deeply.course",
      id: `library:${input.bookId}`,
      miniAppId: DEEPLY_MINI_APP_ID
    },
    listSnapshot: {
      title: displayLabel,
      subtitle: "课程库 · 正在准备",
      icon: "📚",
      // Row avatar 优先级:封面 URL → 分类色块 + 书名首字 → mini-app 默认头像。
      // 色块 fallback 让每本书在聊天列表里仍有视觉区分度,而不是所有没封面的
      // 书都退化成同一个 deeply learning brain 头像。
      ...(input.cover !== undefined && input.cover.length > 0
        ? { avatarUri: input.cover }
        : {
            avatarFallback: {
              fillColor: getCategoryStyle(input.category).colorStart,
              label: makeBookGlyphLabel(input.title)
            }
          })
    },
    bootstrap: {
      status: "loading",
      hint: "正在为你准备这门课的目录,通常 1-3 分钟。"
    }
  });

  const record: DeeplyCourseSessionRecord = {
    schemaVersion: 1,
    kind: "library",
    cardKind: "topic",
    title: displayLabel,
    subtitle: input.hook,
    reason: "",
    // pitch 直接作为 record.introduction,详情页 / outline prompt 都用得上。
    introduction: input.pitch,
    sections: input.sections,
    sectionPreset: "auto",
    optionChoices: [],
    researchTopic: displayLabel,
    libraryInput: {
      bookId: input.bookId,
      title,
      author: input.author,
      category: input.category,
      hook: input.hook,
      pitch: input.pitch
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
 * Agent 出完课程目录(\`koko.deeply.research.plan\`)后,transformer 解析
 * 成功时调这里。直接把目录落库 + 切 ready,**不再有后续的 outline
 * inferOnce 阶段**:每节的资料留到用户进入该节讲解时,由讲解 prompt
 * 临场联网搜。
 *
 * plan.sections 没有 sources —— 落成 outline record 时 sources 全空,
 * 讲解 mainline prompt 在 sectionSources 为空时本就会引导临场搜索。
 */
export function applyResearchPlanToCourse(
  conversationId: string,
  plan: DeeplyResearchPlan
): void {
  const record = loadDeeplyCourseSessionRecord(conversationId);
  if (record === null) {
    console.warn("[deeply-course] applyResearchPlanToCourse: no record", conversationId);
    return;
  }
  // 缓存 plan(重试时直接重新落库,不必让 agent 重新脑暴)。
  STORAGE.setJson(`${COURSE_RECORD_PREFIX}${conversationId}`, {
    ...record,
    cachedResearchPlan: plan
  });

  const outline: DeeplyResearchOutline = {
    version: 1,
    courseTitle: plan.courseTitle,
    introduction: plan.introduction,
    sections: plan.sections.map((s) => ({ index: s.index, title: s.title, sources: [] })),
    outlineMarkdown: plan.sections.map((s) => `## 第${s.index}节:${s.title}`).join("\n\n"),
    sources: []
  };
  applyResearchOutlineToCourse(conversationId, outline);
}

/**
 * 用户点 bootstrap error banner 的「重试」按钮时调:
 * - bootstrap 改回 loading,banner 切回 spinner
 * - 后台重新跑 outline 生成,完成时再 set ready / error
 *
 * Research 课**有缓存的 plan 时**直接重新落库(目录早就生成好,落库是
 * 纯本地操作)。没缓存(Phase A 自己就失败)时退到"目录通用重做"路径,
 * 会让 DeeplyCourseScreen 重新 fire research kickoff message 重新出目录。
 *
 * 如果 conversation / record 找不到(已被归档),静默返回。
 */
export function retryDeeplyCourseOutline(conversationId: string): void {
  const store = useConversationStore.getState();
  const record = loadDeeplyCourseSessionRecord(conversationId);
  if (record === null) return;

  if (record.kind === "research" && record.cachedResearchPlan !== undefined) {
    store.setBootstrap(conversationId, {
      status: "loading",
      hint: "正在重新生成课程目录,稍等一下"
    });
    applyResearchPlanToCourse(conversationId, record.cachedResearchPlan);
    return;
  }

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
