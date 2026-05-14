import { registerMiniApp } from "@/runtime/miniApps";
import { registerSharedBlockRenderer } from "@/runtime/messageBlocks";
import {
  registerOutboundMessageBuilder,
  type OutboundMessageBuilder
} from "@/runtime/outboundMessages";
import { inferOnce } from "@/runtime/openclaw";
import {
  useConversationStore,
  type ChatMessage,
  type MessageBlock
} from "@/state/conversations";

import {
  isTavernRecommendations,
  parseTavernRecommendations,
  type TavernRecommendations
} from "./parseRecommendations";
import { TavernRecommendationsBlock } from "./RecommendationsBlock";

/**
 * Tavern mini-app: 酒馆助手.
 *
 * Product loop:
 *   1. User describes the kind of roleplay character they want.
 *   2. Mini-app forwards the message to the `tavern` OpenClaw agent via
 *      `inferOnce`, with the mini-app id steering session/agent routing.
 *   3. The `tavern` agent calls its `kokochat-tavern-search` skill, which
 *      hits Character Tavern's catalog endpoint and returns normalized hits.
 *   4. The agent picks 3-5 cards and replies with a koko.tavern.recommendations
 *      fenced block.
 *   5. KokoChat parses + validates the block and renders a stack of character
 *      cards. Tapping a card opens its Character Tavern detail page (v0).
 *
 * The mini-app intentionally owns no scraping logic, no prompt about the
 * Character Tavern API, and no per-card detail fetching: that all lives in the
 * skill. Anything UI-shaped lives here.
 */

const MINI_APP_ID = "tavern";
const RECOMMENDATIONS_BLOCK_TYPE = "koko.tavern.recommendations";
// 1 hour. A normal Tavern turn (search-cards tool call + 3-5 card
// translation + reason writing) usually completes within 30-90s, but agent
// runs that involve a retry, a slow upstream, or longer prompt windows can
// occasionally push past several minutes. The host's per-request RPC timeout
// is also 1 hour, so this matches the cap rather than under-cutting it.
const INFER_TIMEOUT_MS = 3_600_000;

let registered = false;

const tavernOutboundBuilder: OutboundMessageBuilder = async ({ conversation, visibleText }) => {
  // The host appends the user's own message into the store *after* this
  // builder resolves. If we schedule the placeholder synchronously here, it
  // ends up sitting above the user's message in the chat list. Defer the
  // placeholder push to the next macrotask so the host's synchronous user
  // message append (which happens right after `await buildOutboundMessage`)
  // lands first. The visible effect is "user bubble first, then a streaming
  // agent placeholder", matching every other chat surface's read order.
  setTimeout(() => schedulePlaceholderAndReply(conversation.id, visibleText), 0);
  return {
    visibleText,
    gatewayText: visibleText,
    // The `tavern` agent is reached via inferOnce below; the host should not
    // also forward this message to the conversation's bound session.
    localOnly: true
  };
};

function schedulePlaceholderAndReply(conversationId: string, userText: string): void {
  const placeholderId = `tavern-pending-${Date.now()}`;
  useConversationStore.getState().setMessages(conversationId, (prev) => [
    ...prev,
    {
      id: placeholderId,
      role: "agent",
      text: "",
      streaming: true
    }
  ]);
  void runRecommendation(conversationId, placeholderId, userText);
}

async function runRecommendation(
  conversationId: string,
  placeholderId: string,
  userText: string
): Promise<void> {
  const store = useConversationStore.getState();
  try {
    const result = await inferOnce({
      miniAppId: MINI_APP_ID,
      prompt: userText,
      timeoutMs: INFER_TIMEOUT_MS
    });
    const assistantText = result.text;
    const parsed = parseTavernRecommendations(assistantText);

    if (!parsed.ok) {
      // Two failure shapes to handle:
      //
      //   (a) The agent replied with prose only — typically because the
      //       user said something off-topic or too short to search on.
      //       Show the prose; do NOT surface the parser error to the user
      //       (it is internal to the recommendation contract and not
      //       actionable for them).
      //
      //   (b) The agent produced no text at all — likely an upstream tool
      //       failure or model timeout. Show a short, plain-Chinese fallback
      //       so the user knows the turn is over.
      //
      // In both cases we keep the parser error in console for debugging.
      if (__DEV__) {
        console.warn("[tavern] recommendations parse failed:", parsed.error);
      }
      const fallback = assistantText.trim();
      finalize(conversationId, placeholderId, {
        text: fallback.length > 0 ? fallback : "（这次没有给出推荐，再换个说法试试？）"
      });
      if (fallback.length > 0) {
        store.touch(conversationId, fallback.slice(0, 120));
      }
      return;
    }

    const block: MessageBlock<TavernRecommendations> = {
      type: RECOMMENDATIONS_BLOCK_TYPE,
      version: 1,
      data: parsed.value
    };
    finalize(conversationId, placeholderId, {
      text: parsed.value.intro ?? "",
      blocks: [block]
    });

    const preview =
      parsed.value.cards
        .slice(0, 2)
        .map((card) => card.nameZh)
        .join("、") || parsed.value.query;
    store.touch(conversationId, `推荐了 ${parsed.value.cards.length} 个：${preview}`);
  } catch (error) {
    // Surface a short, actionable Chinese message to the user. Keep the raw
    // error in the dev console for debugging.
    const raw = error instanceof Error ? error.message : String(error);
    if (__DEV__) {
      console.warn("[tavern] inferOnce failed:", raw);
    }
    const userMessage = isTimeout(raw)
      ? "推荐这次跑得有点久，超时了。再发一次试试？"
      : "推荐失败了，稍后再试一次吧。";
    finalize(conversationId, placeholderId, {
      text: "",
      error: userMessage
    });
  }
}

function isTimeout(message: string): boolean {
  return /timed?\s*out|timeout/i.test(message);
}

interface FinalizePatch {
  text: string;
  blocks?: MessageBlock[];
  error?: string;
}

function finalize(conversationId: string, placeholderId: string, patch: FinalizePatch): void {
  useConversationStore.getState().setMessages(conversationId, (prev) => {
    const idx = prev.findIndex((m) => m.id === placeholderId);
    if (idx < 0) return prev;
    const existing = prev[idx];
    if (existing === undefined) return prev;
    const next = [...prev];
    const updated: ChatMessage = {
      ...existing,
      text: patch.text,
      streaming: false,
      ...(patch.blocks !== undefined ? { blocks: patch.blocks } : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {})
    };
    next[idx] = updated;
    return next;
  });
}

export function registerTavernMiniApp(): void {
  if (registered) return;
  registered = true;

  registerMiniApp({
    id: MINI_APP_ID,
    displayName: "酒馆",
    listGlyph: "🍺",
    showInLauncher: true,
    defaultTitle: () => "酒馆助手",
    openclaw: {
      defaultAgentId: "tavern",
      requiredSkills: ["kokochat-tavern-search"],
      requiredCoreTools: ["exec"],
      localSkillDirs: ["miniapps/tavern/openclaw/skills/kokochat-tavern-search"]
    },
    onCreate: () =>
      useConversationStore.getState().create({
        mode: MINI_APP_ID,
        title: "酒馆助手",
        listSnapshot: { title: "酒馆助手", subtitle: "找一张对味的角色卡", icon: "🍺" }
      })
  });

  registerOutboundMessageBuilder(MINI_APP_ID, tavernOutboundBuilder);
  registerSharedBlockRenderer(
    RECOMMENDATIONS_BLOCK_TYPE,
    isTavernRecommendations,
    TavernRecommendationsBlock
  );
}
