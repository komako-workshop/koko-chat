import type { ImageSourcePropType } from "react-native";

import { registerMiniApp } from "@/runtime/miniApps";
import {
  registerOutboundMessageBuilder,
  type OutboundMessageBuilder
} from "@/runtime/outboundMessages";
import { ensureOpenClawAgent } from "@/runtime/openclaw";
import {
  buildSessionKey,
  useConversationStore
} from "@/state/conversations";

/**
 * Koko — KokoChat's built-in home assistant mini-app.
 *
 * UX role: a single pinned conversation ("home") that behaves like a
 * general-purpose chat assistant. Functionally a re-skin of the user's
 * OpenClaw with a Koko persona. It uses a dedicated `koko` OpenClaw agent
 * (not the user's `main`) so it can grow its own skills later without
 * polluting the terminal experience.
 *
 * Key contracts:
 * - Singleton session: one `koko/home` conversation per user, opened by
 *   `openKokoHome()` (pinned row tap in the chat list).
 * - First user turn injects a hidden system prompt via the outbound
 *   builder. Subsequent turns are passthrough so OpenClaw owns context.
 * - A welcome agent message is seeded into the local message cache on
 *   first creation so the conversation never looks empty.
 */

const kokoAvatar = require("../../../assets/brand/chat-avatar.png") as ImageSourcePropType;

const MINI_APP_ID = "koko";
const HOME_SCOPE = "home";

/**
 * Hidden role setup sent to OpenClaw on the first user message of a
 * session. OpenClaw stores it as part of the session transcript, so
 * subsequent turns rely on the model's context window rather than
 * re-sending the prompt every time.
 */
const KOKO_SYSTEM_PROMPT = `你是 Koko，一只圆滚滚的暖橙小鸟 AI 助手 🐤，住在用户的手机里。

调性：
- 聪明、可靠、会做事；同时温暖、轻松、会撒娇
- 软糯但不傻，精准但不冰冷
- 像用户的小搭子，不像装出来的客服

回答规则：
- 中文为主（用户用其他语言时跟着切）
- 句子短、清楚、有节奏感。能两句说完别说三句
- 适度使用 emoji 或符号（平均一段最多 1–2 个，别堆）
- 用户拜托做事时：先一句简短确认（"好嘞～""收到～"），再开始做
- 不知道就直说不知道，别瞎编、别糊弄
- 不要每次都自报"我是 Koko"——只有用户问起或第一次见面时才说

边界：
- 当用户问"你能做什么"，用一句话总结即可，不要列长清单
- 不主动推销，不要写企宣口吻`;

/** Local-only welcome message shown when the home conversation is first created. */
const KOKO_WELCOME_TEXT = `嘿，你好呀～ ✨

我是 Koko，你手机里的小搭子。
聊聊、问问题、想点子都可以，
随便从一句话开始就行。`;

let registered = false;

const kokoOutboundBuilder: OutboundMessageBuilder = async ({
  visibleText,
  isFirstUserTurn
}) => {
  if (isFirstUserTurn) {
    return {
      visibleText,
      gatewayText: `${KOKO_SYSTEM_PROMPT}\n\n${visibleText}`
    };
  }
  return { visibleText, gatewayText: visibleText };
};

export function registerKokoMiniApp(): void {
  if (registered) return;
  registered = true;

  registerMiniApp({
    id: MINI_APP_ID,
    displayName: "Koko",
    showInLauncher: false,
    listGlyph: "K",
    listImage: kokoAvatar,
    defaultTitle: () => "Koko",
    singletonSessionScope: HOME_SCOPE,
    openclaw: { defaultAgentId: "koko" }
  });

  registerOutboundMessageBuilder(MINI_APP_ID, kokoOutboundBuilder);
}

/**
 * Open (or create) the singleton Koko home conversation and route to it.
 *
 * - Ensures the OpenClaw `koko` agent exists.
 * - Reuses the existing home conversation if any; otherwise creates one
 *   and seeds a local welcome agent message so the UI is never empty.
 * - Calls `navigate(conversationId)` with the resolved conversation id.
 *   Caller picks the routing primitive (e.g. expo-router).
 *
 * Errors propagate; the caller is expected to surface them (e.g. as an
 * Alert) since failure usually means Gateway is not reachable.
 */
export async function openKokoHome(
  navigate: (conversationId: string) => void
): Promise<void> {
  await ensureOpenClawAgent({ agentId: "koko", name: "koko" });

  const sessionKey = buildSessionKey(MINI_APP_ID, HOME_SCOPE);
  const store = useConversationStore.getState();
  const existing = store.list.find((meta) => meta.sessionKey === sessionKey);
  if (existing !== undefined) {
    navigate(existing.id);
    return;
  }

  const meta = store.create({
    mode: MINI_APP_ID,
    sessionScope: HOME_SCOPE,
    title: "Koko",
    listSnapshot: { title: "Koko", subtitle: "你的 KokoChat 主助手" }
  });

  // Seed welcome message in the local UI cache. Intentionally local-only:
  // OpenClaw never sees it, so the first real user turn still triggers
  // system-prompt injection (isFirstUserTurn === true).
  store.setMessages(meta.id, () => [
    {
      id: `koko-welcome-${meta.id}`,
      role: "agent",
      text: KOKO_WELCOME_TEXT
    }
  ]);

  navigate(meta.id);
}
