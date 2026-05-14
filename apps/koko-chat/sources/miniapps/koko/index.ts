import type { ImageSourcePropType } from "react-native";

import { registerSharedBlockRenderer } from "@/runtime/messageBlocks";
import { registerMiniApp } from "@/runtime/miniApps";
import {
  registerOutboundMessageBuilder,
  type OutboundMessageBuilder
} from "@/runtime/outboundMessages";
import { ensureOpenClawAgent } from "@/runtime/openclaw";
import { useGatewayStore } from "@/state/gateway";
import {
  buildSessionKey,
  useConversationStore,
  type ChatMessage,
  type ConversationMeta
} from "@/state/conversations";
import {
  KOKO_FIRST_TURN_INSTRUCTION,
  KOKO_PERSONA_DOC,
  KOKO_TURN_REMINDER
} from "./persona";
import { KokoStickerBlock } from "./KokoStickerBlock";
import {
  KOKO_STICKER_BLOCK_TYPE,
  isKokoStickerBlockData,
  type KokoStickerId
} from "./stickers";

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

/**
 * Stable sessionKey for the singleton Koko home conversation. The chat
 * list filters this out of its main list so the pinned row is the only
 * way to enter it (and the row never appears twice).
 */
export const KOKO_HOME_SESSION_KEY = buildSessionKey(MINI_APP_ID, HOME_SCOPE);

/**
 * Local-only opening exchange shown when the Koko home conversation is first
 * created. Doubles as a sanity-check that the chat surface works without a
 * Gateway: the messages live entirely in the host's local store, so reviewers
 * (or any first-launch user without OpenClaw running) still see Koko in
 * character before they pair anything.
 */
const KOKO_WELCOME_TEXTS: Array<string | { sticker: KokoStickerId }> = [
  "嘿，你好呀～ ✨",
  "我是 Koko，你手机里的小搭子。",
  { sticker: "hi" },
  "想聊天、想找点子、想被陪着发会儿呆都可以。",
  "现在还没连上 OpenClaw，所以是预览版的我先来打个招呼。等你在「我」里完成配对，我就能正经回应你啦。"
];

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

/**
 * "+ menu" entry for Koko: always create a fresh, independent OpenClaw
 * session under the koko agent so the home thread is not touched. Useful
 * for trying out new prompts / personas without polluting the canonical
 * home conversation.
 */
async function createTestKokoConversation(): Promise<ConversationMeta> {
  await ensureOpenClawAgent({ agentId: "koko", name: "koko" });
  const now = Date.now();
  const scope = `test-${now.toString(36)}`;
  const stamp = formatHHMM(now);
  return useConversationStore.getState().create({
    mode: MINI_APP_ID,
    sessionScope: scope,
    title: `Koko 测试 ${stamp}`
  });
}

function formatHHMM(timestamp: number): string {
  const d = new Date(timestamp);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function registerKokoMiniApp(): void {
  if (registered) return;
  registered = true;

  registerMiniApp({
    id: MINI_APP_ID,
    displayName: "Koko",
    // Surfaced in the "+" menu so we can spawn fresh test conversations
    // without disturbing the singleton home thread (which is still entered
    // through the pinned row + `openKokoHome`).
    showInLauncher: true,
    listGlyph: "K",
    listImage: kokoAvatar,
    defaultTitle: () => "Koko",
    singletonSessionScope: HOME_SCOPE,
    openclaw: { defaultAgentId: "koko" },
    splitAgentMessages: true,
    onCreate: createTestKokoConversation
  });

  registerOutboundMessageBuilder(MINI_APP_ID, kokoOutboundBuilder);
  registerSharedBlockRenderer(
    KOKO_STICKER_BLOCK_TYPE,
    isKokoStickerBlockData,
    KokoStickerBlock
  );
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
  await ensureKokoAgent();

  const store = useConversationStore.getState();
  const existing = store.list.find(
    (meta) => meta.sessionKey === KOKO_HOME_SESSION_KEY
  );
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

  // Seed welcome messages in the local UI cache. Intentionally local-only:
  // OpenClaw never sees them, so the first real user turn still triggers
  // system-prompt injection (isFirstUserTurn === true).
  store.setMessages(meta.id, () => buildWelcomeMessages(meta.id));

  navigate(meta.id);
}

/**
 * Try to make sure the OpenClaw `koko` agent exists, but only if we're already
 * connected. When the user is offline we still want to be able to open the
 * Koko surface and see the local welcome messages; the agent will be created
 * on demand when a real send happens later.
 */
async function ensureKokoAgent(): Promise<void> {
  if (useGatewayStore.getState().status !== "connected") return;
  try {
    await ensureOpenClawAgent({ agentId: "koko", name: "koko" });
  } catch {
    // Non-fatal during this entry path: the chat surface still works in
    // offline mode, and the next real send will surface a clearer error
    // through the Gateway send pipeline.
  }
}

function buildWelcomeMessages(conversationId: string): ChatMessage[] {
  return KOKO_WELCOME_TEXTS.map((entry, index) => {
    const id = `koko-welcome-${conversationId}-${index}`;
    if (typeof entry === "string") {
      return { id, role: "agent", text: entry } satisfies ChatMessage;
    }
    return {
      id,
      role: "agent",
      text: "",
      blocks: [
        {
          type: KOKO_STICKER_BLOCK_TYPE,
          version: 1,
          data: { id: entry.sticker }
        }
      ]
    } satisfies ChatMessage;
  });
}
