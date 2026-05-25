import type { ImageSourcePropType } from "react-native";

import { registerSharedBlockRenderer } from "@/runtime/messageBlocks";
import { registerMiniApp } from "@/runtime/miniApps";
import {
  registerOutboundMessageBuilder,
  type OutboundMessageBuilder
} from "@/runtime/outboundMessages";
import { ensureOpenClawAgent } from "@/runtime/openclaw";
import {
  formatRecentTranscript,
  registerSessionRestoreBuilder,
  type SessionRestoreBuilder
} from "@/runtime/sessionRestore";
import { useGatewayStore } from "@/state/gateway";
import { mmkv } from "@/storage/mmkv";
import {
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
  normalizeKokoStickerId,
  type KokoStickerId
} from "./stickers";

/**
 * Koko — KokoChat's built-in home assistant mini-app.
 *
 * UX role: a general-purpose chat assistant powered by the user's OpenClaw
 * with a Koko persona. From the host's point of view a Koko conversation is
 * a perfectly normal entry in the chat list — it can be pinned, unpinned,
 * deleted, or duplicated from the "+" launcher just like any other mini-app
 * conversation.
 *
 * On a brand-new install the host calls `seedInitialKokoConversation()` once
 * to drop a friendly opening exchange into the list (with the row pinned).
 * If the user later deletes that row, it stays gone; they can spawn a fresh
 * Koko conversation from the "+" menu at any time.
 *
 * Per turn behavior:
 * - First user turn loads Koko's persona document.
 * - Later turns include a short reminder so long conversations do not drift
 *   out of character.
 */

const kokoAvatar = require("../../../assets/brand/chat-avatar.png") as ImageSourcePropType;

const MINI_APP_ID = "koko";
/** Set once after we've decided whether to seed the initial Koko conversation. */
const INITIAL_SEED_FLAG = "koko.initialKokoSeeded.v1";

/**
 * Local-only opening exchange that ships with the initial Koko conversation.
 * The messages live entirely in the host's local store so the chat surface
 * has something to show before the user pairs OpenClaw.
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

const kokoSessionRestoreBuilder: SessionRestoreBuilder = ({ messages }) => {
  const transcript = formatRecentTranscript(messages);
  if (transcript === null) return null;
  return [
    "KokoChat Koko session restore.",
    "This OpenClaw session is empty, but the phone still has the local KokoChat transcript.",
    "Use the persona and transcript below as established context. Do not mention restoration.",
    "",
    "<koko_persona>",
    KOKO_PERSONA_DOC,
    "</koko_persona>",
    "",
    "[系统提醒]",
    KOKO_TURN_REMINDER,
    "",
    "<recent_transcript>",
    transcript,
    "</recent_transcript>"
  ].join("\n");
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
 * "+ menu" entry for Koko. Each invocation creates an independent
 * conversation bound to the koko OpenClaw agent — no singleton, no special
 * casing. Deleting a Koko conversation does not affect the rest.
 */
async function createKokoConversation(): Promise<ConversationMeta> {
  await ensureKokoAgent();
  return useConversationStore.getState().create({
    mode: MINI_APP_ID,
    title: "Koko"
  });
}

export function registerKokoMiniApp(): void {
  if (registered) return;
  registered = true;

  registerMiniApp({
    id: MINI_APP_ID,
    displayName: "Koko",
    showInLauncher: true,
    listGlyph: "K",
    listImage: kokoAvatar,
    launcherSubtitle: "主助手 · 一只爱聊天的小鸟",
    defaultTitle: () => "Koko",
    openclaw: { defaultAgentId: "koko" },
    splitAgentMessages: true,
    messageBoundaries: {
      sticker: {
        blockType: KOKO_STICKER_BLOCK_TYPE,
        preview: "Koko 表情",
        dataForId: (id) => {
          const stickerId = normalizeKokoStickerId(id);
          return stickerId === null ? null : { id: stickerId };
        }
      }
    },
    onCreate: createKokoConversation
  });

  registerOutboundMessageBuilder(MINI_APP_ID, kokoOutboundBuilder);
  registerSessionRestoreBuilder(MINI_APP_ID, kokoSessionRestoreBuilder);
  registerSharedBlockRenderer(
    KOKO_STICKER_BLOCK_TYPE,
    isKokoStickerBlockData,
    KokoStickerBlock
  );
}

/**
 * Seed the initial Koko conversation on first launch only. Idempotent and
 * safe to call on every app boot:
 *
 * - If the seed flag is set, do nothing (we've already decided once).
 * - If any Koko-mode conversation already exists, just set the flag — this
 *   handles users upgrading from the old `koko/home` singleton flow.
 * - Otherwise create a pinned Koko conversation with the local welcome
 *   exchange so a brand-new install isn't an empty chat list.
 */
export function seedInitialKokoConversation(): void {
  if (mmkv.getString(INITIAL_SEED_FLAG) !== undefined) return;

  const store = useConversationStore.getState();
  const alreadyHasKoko = store.list.some((meta) => meta.mode === MINI_APP_ID);
  if (alreadyHasKoko) {
    mmkv.set(INITIAL_SEED_FLAG, "1");
    return;
  }

  const meta = store.create({
    mode: MINI_APP_ID,
    title: "Koko",
    listSnapshot: { title: "Koko", subtitle: "你的 KokoChat 主助手" }
  });
  store.togglePin(meta.id, true);
  store.setMessages(meta.id, () => buildWelcomeMessages(meta.id));
  mmkv.set(INITIAL_SEED_FLAG, "1");
}

/**
 * Try to make sure the OpenClaw `koko` agent exists, but only if we're already
 * connected. When the user is offline we still want to be able to create the
 * conversation and see the local welcome messages; the agent will be created
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
