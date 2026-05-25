/**
 * Deeply 课程库的共享视觉常量。
 *
 * 9 个分类色按 mockup 里的色板,对每个分类 id / 中文名都 keep 一份 mapping。
 * 客户端实际数据里 category 字段用的是中文名(`b.c`),英文 id 用作内部 key。
 */

export const LIBRARY_INK = "#1E293B";
export const LIBRARY_INK_2 = "#475569";
export const LIBRARY_INK_3 = "#94A3B8";
export const LIBRARY_INK_4 = "#CBD5E1";
export const LIBRARY_LINE = "#E8E6E0";
export const LIBRARY_LINE_SOFT = "#F1F0EC";
export const LIBRARY_BG = "#F9F9F7";
export const LIBRARY_WARM_50 = "#FAF7F2";
export const LIBRARY_WARM_100 = "#F0EBE0";
export const LIBRARY_ACCENT = "#111111";

/**
 * 每个分类的渐变色(start → end)。封面图缺失时用 start 色作纯色 fallback;
 * 分类页 hero 也用同色调。
 */
export interface CategoryStyle {
  id: string;
  name: string;
  /** Gradient start. 也是 fallback solid color. */
  colorStart: string;
  /** Gradient end. */
  colorEnd: string;
}

export const CATEGORY_STYLES: CategoryStyle[] = [
  { id: "history",    name: "历史的镜像",  colorStart: "#4A3F36", colorEnd: "#2C2A26" },
  { id: "civ",        name: "文明的逻辑",  colorStart: "#5C4470", colorEnd: "#382A44" },
  { id: "mind",       name: "心智理论",    colorStart: "#3D4E4C", colorEnd: "#1F2D2C" },
  { id: "wealth",     name: "财富的逻辑",  colorStart: "#84612D", colorEnd: "#4F3A1A" },
  { id: "thought",    name: "思想的深渊",  colorStart: "#4A4E70", colorEnd: "#292D44" },
  { id: "create",     name: "创造与表达",  colorStart: "#7A3E5C", colorEnd: "#4D2438" },
  { id: "classic",    name: "重读经典",    colorStart: "#7A4A3E", colorEnd: "#4D2B22" },
  { id: "science",    name: "科学的边界",  colorStart: "#586645", colorEnd: "#34402A" },
  { id: "stars",      name: "人类群星",    colorStart: "#6F5C3E", colorEnd: "#3F3527" }
];

const STYLE_BY_NAME: Record<string, CategoryStyle> = CATEGORY_STYLES.reduce(
  (acc, s) => {
    acc[s.name] = s;
    return acc;
  },
  {} as Record<string, CategoryStyle>
);

const DEFAULT_STYLE: CategoryStyle = {
  id: "other",
  name: "其它",
  colorStart: "#5A5A5A",
  colorEnd: "#3A3A3A"
};

export function getCategoryStyle(categoryName: string): CategoryStyle {
  return STYLE_BY_NAME[categoryName] ?? DEFAULT_STYLE;
}

/**
 * 分类描述(用在分类卡 hero 副标题)。手工写一份,9 个分类一次性定。
 */
export const CATEGORY_DESC: Record<string, string> = {
  "历史的镜像": "古代 / 近现代 / 文明史",
  "文明的逻辑": "社会学 / 制度史 / 文化",
  "心智理论":   "心理学 / 认知科学 / 哲学",
  "财富的逻辑": "经济 / 投资 / 商业史",
  "思想的深渊": "哲学 / 政治思想 / 形而上学",
  "创造与表达": "文学 / 艺术 / 写作",
  "重读经典":   "传统典籍 / 史学原典 / 长青之作",
  "科学的边界": "数理 / 自然 / 跨学科",
  "人类群星":   "思想家 / 实业家 / 艺术家"
};
