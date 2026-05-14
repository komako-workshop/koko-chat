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
import {
  KOKO_FIRST_TURN_INSTRUCTION,
  KOKO_PERSONA_DOC,
  KOKO_TURN_REMINDER
} from "./persona";

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
 * - First user turn loads Koko's persona document. Later turns include a
 *   short reminder so long conversations do not drift out of character.
 * - A welcome agent message is seeded into the local message cache on
 *   first creation so the conversation never looks empty.
 */

const kokoAvatar = require("../../../assets/brand/chat-avatar.png") as ImageSourcePropType;

const MINI_APP_ID = "koko";
const HOME_SCOPE = "home";

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
      gatewayText: buildFirstTurnGatewayText(visibleText)
    };
  }
  return { visibleText, gatewayText: buildReminderGatewayText(visibleText) };
};

function buildFirstTurnGatewayText(userText: string): string {
  return [
    "<koko_persona>",
    KOKO_PERSONA_DOC,
    "</koko_persona>",
    "",
    "[系统注入]",
    KOKO_FIRST_TURN_INSTRUCTION,
    "",
    "[用户消息]",
    userText
  ].join("\n");
}

function buildReminderGatewayText(userText: string): string {
  return [
    "[系统提醒]",
    KOKO_TURN_REMINDER,
    "",
    "[用户消息]",
    userText
  ].join("\n");
}

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
