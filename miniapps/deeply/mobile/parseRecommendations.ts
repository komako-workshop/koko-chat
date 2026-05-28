/**
 * 解析 `koko.deeply.recommendations` fenced block。
 *
 * Agent 在用户按下「推荐课程」按钮后,会输出一个 fenced block:
 *
 * ```koko.deeply.recommendations
 * {
 *   "version": 1,
 *   "items": [
 *     { "kind": "text", "text": "..." },
 *     { "kind": "card", "card": { ... } },
 *     ...
 *   ]
 * }
 * ```
 *
 * items 是 IM 流形式,允许 text 引子 / card 推荐穿插。Schema 故意比酒馆
 * 更小:Deeply 推荐的是"待生成的课题",还没有真实 URL / 头像 / tag,
 * 卡片字段就只是 title / subtitle / reason。
 *
 * 客户端绝不直接信任 LLM 文本,这里是唯一允许把原始 assistant text 转成
 * typed value(可以被 React 渲染)的入口。
 */
import { extractFencedBlock } from "@/runtime/messageBlocks";

export const DEEPLY_RECOMMENDATIONS_BLOCK_TYPE = "koko.deeply.recommendations";
export const DEEPLY_CARD_BLOCK_TYPE = "koko.deeply.card";

const MIN_CARDS = 1;
const MAX_CARDS = 6;
const MIN_SECTIONS = 10;
const MAX_SECTIONS = 60;

export type DeeplyCardKind = "book" | "person" | "theory" | "topic";

export interface DeeplyRecommendationCard {
  /** 大类。影响图标 / 视觉 hint;LLM 偶尔写不出来时退回 "topic"。 */
  kind: DeeplyCardKind;
  /** 主标题。人名 / 书名 / 理论名,例:"阿德勒" / "《思考,快与慢》" / "系统1与系统2"。 */
  title: string;
  /** 副标题。常常是流派 / 作者 / 类别,例:"个体心理学" / "卡尼曼" / "行为经济学"。 */
  subtitle: string;
  /** 学习理由,1-3 句话,给用户看的推销文案。Deeply UI 里以 ❝引号包起来呈现。 */
  reason: string;
  /** Legacy field kept for older cached / direct card blocks. New prompts leave it 0. */
  suggestedSections: number;
}

export type DeeplyRecommendationItem =
  | { kind: "text"; text: string }
  | { kind: "card"; card: DeeplyRecommendationCard };

export interface DeeplyRecommendations {
  version: 1;
  items: DeeplyRecommendationItem[];
}

export interface ParseFailure {
  ok: false;
  error: string;
}

export interface ParseSuccess {
  ok: true;
  value: DeeplyRecommendations;
}

export type ParseResult = ParseSuccess | ParseFailure;

export function parseDeeplyRecommendations(assistantText: string): ParseResult {
  const fenced = extractFencedBlock(assistantText, DEEPLY_RECOMMENDATIONS_BLOCK_TYPE);
  if (fenced === null) {
    return { ok: false, error: "未找到 koko.deeply.recommendations 推荐块" };
  }
  const body = fenced.body.trim();

  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch (error) {
    return {
      ok: false,
      error: `推荐块 JSON 解析失败: ${error instanceof Error ? error.message : String(error)}`
    };
  }
  if (!isRecord(raw)) {
    return { ok: false, error: "推荐块不是 JSON 对象" };
  }
  if (raw.version !== 1) {
    return { ok: false, error: `推荐块版本号不被支持: ${String(raw.version)}` };
  }
  if (!Array.isArray(raw.items)) {
    return { ok: false, error: "推荐块缺少 items 数组" };
  }
  if (raw.items.length === 0) {
    return { ok: false, error: "推荐块的 items 为空" };
  }

  const items: DeeplyRecommendationItem[] = [];
  let cardCount = 0;
  for (let i = 0; i < raw.items.length; i += 1) {
    const item = parseItem(raw.items[i], i);
    if (item.error !== undefined) return { ok: false, error: item.error };
    items.push(item.value);
    if (item.value.kind === "card") cardCount += 1;
  }

  if (cardCount < MIN_CARDS || cardCount > MAX_CARDS) {
    return {
      ok: false,
      error: `卡片数量异常: 期望 ${MIN_CARDS}-${MAX_CARDS} 张,得到 ${cardCount} 张`
    };
  }

  return { ok: true, value: { version: 1, items } };
}

export function isDeeplyRecommendationCard(value: unknown): value is DeeplyRecommendationCard {
  if (!isRecord(value)) return false;
  return (
    isCardKind(value.kind) &&
    typeof value.title === "string" &&
    value.title.length > 0 &&
    typeof value.subtitle === "string" &&
    typeof value.reason === "string" &&
    value.reason.length > 0 &&
    typeof value.suggestedSections === "number" &&
    Number.isFinite(value.suggestedSections)
  );
}

interface OkValue<T> {
  value: T;
  error?: undefined;
}
interface ErrValue {
  value?: undefined;
  error: string;
}
type Read<T> = OkValue<T> | ErrValue;

function parseItem(value: unknown, index: number): Read<DeeplyRecommendationItem> {
  const where = `items[${index}]`;
  if (!isRecord(value)) {
    return { error: `${where} 不是对象` };
  }
  if (value.kind === "text") {
    const text = readNonEmpty(value.text, `${where}.text`);
    if (text.error !== undefined) return { error: text.error };
    return { value: { kind: "text", text: text.value } };
  }
  if (value.kind === "card") {
    const card = parseCard(value.card, index);
    if (card.error !== undefined) return { error: card.error };
    return { value: { kind: "card", card: card.value } };
  }
  return { error: `${where}.kind 期望 "text" 或 "card",得到 ${String(value.kind)}` };
}

function parseCard(value: unknown, index: number): Read<DeeplyRecommendationCard> {
  const where = `items[${index}].card`;
  if (!isRecord(value)) {
    return { error: `${where} 不是对象` };
  }
  const kind = normalizeCardKind(value.kind);
  const title = readNonEmpty(value.title, `${where}.title`);
  if (title.error !== undefined) return { error: title.error };
  const subtitle = readString(value.subtitle, `${where}.subtitle`);
  if (subtitle.error !== undefined) return { error: subtitle.error };
  const reason = readNonEmpty(value.reason, `${where}.reason`);
  if (reason.error !== undefined) return { error: reason.error };
  let suggestedSections = 0;
  if (value.suggestedSections !== undefined) {
    const sections = readSections(value.suggestedSections, `${where}.suggestedSections`);
    if (sections.error !== undefined) return { error: sections.error };
    suggestedSections = sections.value;
  }

  return {
    value: {
      kind,
      title: title.value,
      subtitle: subtitle.value,
      reason: reason.value,
      suggestedSections
    }
  };
}

function readNonEmpty(value: unknown, name: string): Read<string> {
  if (typeof value !== "string") return { error: `${name} 不是字符串` };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { error: `${name} 不能为空` };
  return { value: trimmed };
}

function readString(value: unknown, name: string): Read<string> {
  if (value === undefined || value === null) return { value: "" };
  if (typeof value !== "string") return { error: `${name} 不是字符串` };
  return { value: value.trim() };
}

function readSections(value: unknown, name: string): Read<number> {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { error: `${name} 不是数字` };
  }
  const n = Math.round(value);
  const clamped = Math.max(MIN_SECTIONS, Math.min(MAX_SECTIONS, n));
  return { value: clamped };
}

function normalizeCardKind(value: unknown): DeeplyCardKind {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "book" || normalized === "person" || normalized === "theory" || normalized === "topic") {
      return normalized;
    }
  }
  return "topic";
}

function isCardKind(value: unknown): value is DeeplyCardKind {
  return value === "book" || value === "person" || value === "theory" || value === "topic";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
