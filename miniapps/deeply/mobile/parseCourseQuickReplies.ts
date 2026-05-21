/**
 * 解析 Deeply 课程讲解末尾的好奇点快捷回复。
 *
 * Agent 在 `inferCourseQuickReplies` 调用里被要求按 deeply.plus 原版口径
 * 输出纯文本逐行 `标签:内容`(中文冒号),例如:
 *
 *   深挖:庄子的"无用之用"具体怎么用?
 *   八卦:庄子和惠施究竟是什么关系?
 *   争议:这种逍遥是不是另一种逃避?
 *
 * 客户端按行 split + 中文冒号 split,提炼 label + content。
 * 完全不用 JSON / fenced block——deeply 实测纯文本格式 LLM 出错率更低,
 * 客户端 parse 也最不挑剔。
 */

const MIN_CHIPS = 1;
const MAX_CHIPS = 5;
// LLM 偶尔说"很长一段话":送回 OpenClaw 用户消息那一边 max 80 个汉字
// 还是有意义的(避免 abuse),但远比"label 8 字、content 60 字"宽松。
const LABEL_MAX_CHARS = 24;
const CONTENT_MAX_CHARS = 240;

export interface DeeplyQuickReplyChip {
  /** Chip 上"粗黑"段显示的短标签。2-4 字最佳。 */
  label: string;
  /**
   * Chip 上"小灰"段显示 + 点击发出去的完整问题。
   * 客户端用 numberOfLines={1} ellipsize 截尾,
   * 实际发送时仍然是完整内容。
   */
  sendText: string;
}

export interface DeeplyQuickReplies {
  chips: DeeplyQuickReplyChip[];
}

export type ParseResult =
  | { ok: true; value: DeeplyQuickReplies }
  | { ok: false; error: string };

const CONTINUE_PREFIX_REGEX = /^(继续|continue\b)/i;

export function parseDeeplyQuickReplies(assistantText: string): ParseResult {
  const raw = String(assistantText ?? "");
  if (raw.trim().length === 0) {
    return { ok: false, error: "agent 返回为空" };
  }

  // 清掉常见包装:LLM 偶尔不听话还是会包 ```...```,或者起手加 "好的,"
  // 之类客套话。把这些剥掉再 split lines。
  const body = stripCodeFenceWrapper(raw)
    .replace(/^[ \t]*[-•·*]\s+/gm, "") // 去 list bullets,deeply 原版也这样
    .trim();

  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const chips: DeeplyQuickReplyChip[] = [];
  for (const line of lines) {
    // 跳过"继续/Continue"行 — UI 单独渲染「继续:下一节」chip。
    if (CONTINUE_PREFIX_REGEX.test(line)) continue;
    const chip = parseChipLine(line);
    if (chip === null) continue;
    chips.push(chip);
    if (chips.length >= MAX_CHIPS) break;
  }

  if (chips.length < MIN_CHIPS) {
    return { ok: false, error: `没解析出任何快捷回复(共扫描 ${lines.length} 行)` };
  }
  return { ok: true, value: { chips } };
}

function parseChipLine(line: string): DeeplyQuickReplyChip | null {
  // 找第一个中/英文冒号。
  const idx = line.search(/[:：]/);
  if (idx <= 0) {
    // 没有冒号 → 整行当 sendText,label 用前 4 字。
    const text = line.trim();
    if (text.length === 0) return null;
    return {
      label: clampLabel(text.slice(0, 4)),
      sendText: clampSendText(text)
    };
  }
  const label = line.slice(0, idx).trim();
  const content = line.slice(idx + 1).trim();
  if (label.length === 0 || content.length === 0) return null;
  return {
    label: clampLabel(label),
    sendText: clampSendText(content)
  };
}

function clampLabel(value: string): string {
  // 去掉常见前缀干扰:数字编号、引号、星号粗体标记。
  const cleaned = value
    .replace(/^[\d.、)）\s]+/, "")
    .replace(/^["'""'']+|["'""'']+$/g, "")
    .replace(/^\*+|\*+$/g, "")
    .trim();
  if (cleaned.length === 0) return value.slice(0, LABEL_MAX_CHARS);
  return cleaned.slice(0, LABEL_MAX_CHARS);
}

function clampSendText(value: string): string {
  const cleaned = value
    .replace(/^["'""'']+|["'""'']+$/g, "")
    .replace(/^\*+|\*+$/g, "")
    .trim();
  return cleaned.slice(0, CONTENT_MAX_CHARS);
}

/**
 * 防御 LLM 偶尔不听话:把整段输出包成 ```...```,我们剥掉外层 code fence。
 * 不严格,只剥掉首尾各一对 fence(允许带语言标签)。
 */
function stripCodeFenceWrapper(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
  if (fenceMatch && fenceMatch[1] !== undefined) return fenceMatch[1];
  return trimmed;
}
