import type { ImageSourcePropType } from "react-native";

export const KOKO_STICKER_BLOCK_TYPE = "koko.sticker";

export const KOKO_STICKER_IDS = [
  "hi",
  "ai",
  "thinking",
  "got-it",
  "analyzing",
  "loading",
  "done",
  "happy",
  "night"
] as const;

export type KokoStickerId = (typeof KOKO_STICKER_IDS)[number];

export interface KokoSticker {
  id: KokoStickerId;
  token: `[sticker:${KokoStickerId}]`;
  label: string;
  description: string;
  source: ImageSourcePropType;
}

export interface KokoStickerBlockData {
  id: KokoStickerId;
}

const stickerSources: Record<KokoStickerId, ImageSourcePropType> = {
  hi: require("../../../assets/brand/stickers/01-你好呀.png") as ImageSourcePropType,
  ai: require("../../../assets/brand/stickers/02-我是AI小鸟.png") as ImageSourcePropType,
  thinking: require("../../../assets/brand/stickers/03-思考中.png") as ImageSourcePropType,
  "got-it": require("../../../assets/brand/stickers/04-收到.png") as ImageSourcePropType,
  analyzing: require("../../../assets/brand/stickers/05-分析中.png") as ImageSourcePropType,
  loading: require("../../../assets/brand/stickers/06-努力加载中.png") as ImageSourcePropType,
  done: require("../../../assets/brand/stickers/07-搞定啦.png") as ImageSourcePropType,
  happy: require("../../../assets/brand/stickers/08-开心.png") as ImageSourcePropType,
  night: require("../../../assets/brand/stickers/09-晚安.png") as ImageSourcePropType
};

export const KOKO_STICKERS: Record<KokoStickerId, KokoSticker> = {
  hi: {
    id: "hi",
    token: "[sticker:hi]",
    label: "你好呀",
    description: "打招呼、重新开始一段轻松聊天",
    source: stickerSources.hi
  },
  ai: {
    id: "ai",
    token: "[sticker:ai]",
    label: "我是 AI 小鸟",
    description: "自我介绍、解释自己是 Koko",
    source: stickerSources.ai
  },
  thinking: {
    id: "thinking",
    token: "[sticker:thinking]",
    label: "思考中",
    description: "需要想想、不确定、准备认真分析",
    source: stickerSources.thinking
  },
  "got-it": {
    id: "got-it",
    token: "[sticker:got-it]",
    label: "收到",
    description: "确认收到、准备开始做事",
    source: stickerSources["got-it"]
  },
  analyzing: {
    id: "analyzing",
    token: "[sticker:analyzing]",
    label: "分析中",
    description: "分析、查找、认真看材料",
    source: stickerSources.analyzing
  },
  loading: {
    id: "loading",
    token: "[sticker:loading]",
    label: "努力加载中",
    description: "等待、处理中、需要一点时间",
    source: stickerSources.loading
  },
  done: {
    id: "done",
    token: "[sticker:done]",
    label: "搞定啦",
    description: "任务完成、整理完毕、给出最终答案",
    source: stickerSources.done
  },
  happy: {
    id: "happy",
    token: "[sticker:happy]",
    label: "开心",
    description: "开心、被感谢、轻松正向的情绪",
    source: stickerSources.happy
  },
  night: {
    id: "night",
    token: "[sticker:night]",
    label: "晚安",
    description: "晚安、结束一天、睡前聊天",
    source: stickerSources.night
  }
};

const stickerIdSet = new Set<string>(KOKO_STICKER_IDS);

const stickerAliases: Record<string, KokoStickerId> = {
  hello: "hi",
  hey: "hi",
  wave: "hi",
  waving: "hi",
  ok: "got-it",
  okay: "got-it",
  gotit: "got-it",
  "got-it": "got-it",
  think: "thinking",
  smile: "happy",
  smiling: "happy",
  goodnight: "night",
  "good-night": "night"
};

export function isKokoStickerId(value: unknown): value is KokoStickerId {
  return typeof value === "string" && stickerIdSet.has(value);
}

export function normalizeKokoStickerId(value: unknown): KokoStickerId | null {
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase();
  if (isKokoStickerId(id)) return id;
  return stickerAliases[id] ?? null;
}

export function parseKokoStickerToken(value: string): KokoStickerId | null {
  const match = /^\[sticker:([a-z0-9-]+)\]$/i.exec(value.trim());
  if (match === null) return null;
  return normalizeKokoStickerId(match[1]);
}

export function isKokoStickerBlockData(value: unknown): value is KokoStickerBlockData {
  if (typeof value !== "object" || value === null) return false;
  return isKokoStickerId((value as { id?: unknown }).id);
}
