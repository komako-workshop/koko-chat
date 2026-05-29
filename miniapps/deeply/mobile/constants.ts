/**
 * Mini-app id + 跨文件共享的常量。单独抽一个文件,避免 index.ts(注册
 * 入口,host 只 import 这一个 side-effect 文件)和 screen 之间出现循环 import。
 */
export const DEEPLY_MINI_APP_ID = "deeply";

export {
  DEEPLY_RECOMMEND_INTENT
} from "./persona";
