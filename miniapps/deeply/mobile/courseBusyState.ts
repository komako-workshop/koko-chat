import type { ChatMessage } from "@/state/conversations";

/**
 * 判断一段课程 conversation 当前是否有 agent 正在流式输出。
 *
 * 多个入口都需要这个锁:
 *   - DeeplyCourseScreen 的输入框 / 「下一节」/ 好奇点 chip
 *   - CourseOutlineDrawer 的目录跳转
 *
 * 如果 agent 还在写上一轮,所有"会发新 user message 的入口"都应该被
 * disable,否则连点两下目录就会并发两个 mainline turn,屏幕上看到两条
 * pulse 同时跑,agent 也会被两路 prompt 撕扯。
 */
export function isDeeplyCourseBusy(messages: ChatMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m === undefined) continue;
    if (m.role !== "agent") continue;
    if (m.streaming === true) return true;
    // 最近一条 agent 消息已经 settled,后面没有更新的 streaming 了,直接 false。
    return false;
  }
  return false;
}
