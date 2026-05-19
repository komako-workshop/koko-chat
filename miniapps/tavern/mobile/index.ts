import type { ImageSourcePropType } from "react-native";

import { registerMiniApp } from "@/runtime/miniApps";
import { registerSharedBlockRenderer } from "@/runtime/messageBlocks";
import {
  registerOutboundMessageBuilder,
  type OutboundMessageBuilder
} from "@/runtime/outboundMessages";
import { inferOnce } from "@/runtime/openclaw";
import { useConversationStore, type ChatMessage } from "@/state/conversations";

import {
  parseTavernRecommendations,
  type TavernRecommendationItem
} from "./parseRecommendations";
import { TavernCardBlock, isTavernRecommendationCard } from "./RecommendationsBlock";

/**
 * Tavern mini-app: 酒馆助手.
 *
 * Product loop:
 *   1. User describes the kind of roleplay character they want.
 *   2. Mini-app forwards the message to the `tavern` OpenClaw agent via
 *      `inferOnce`, with the mini-app id steering session/agent routing.
 *   3. The `tavern` agent calls its `kokochat-tavern-search` skill, which
 *      hits Character Tavern's catalog endpoint and returns normalized hits.
 *   4. The agent replies with a single `koko.tavern.recommendations` fenced
 *      block whose `items` array interleaves short prose bubbles with 3-5
 *      character cards (IM-style stream).
 *   5. KokoChat parses + validates the block and expands `items` into
 *      multiple agent messages: text → plain bubble, card → single-card
 *      `koko.tavern.card` block. Tapping a card hands off to the
 *      `tavern-roleplay` mini-app.
 *
 * The mini-app intentionally owns no scraping logic, no prompt about the
 * Character Tavern API, and no per-card detail fetching: that all lives in
 * the skill. Anything UI-shaped lives here.
 */

const MINI_APP_ID = "tavern";
/**
 * Single-card block type, emitted one-per-card from the recommendations
 * fenced block. The mini-app no longer registers a "whole batch" block —
 * the host renders a stream of agent messages instead.
 */
const CARD_BLOCK_TYPE = "koko.tavern.card";
// Character Tavern's own mascot artwork. Surfaces in the chat list / launcher
// so users immediately associate the row with the upstream catalog.
const tavernAvatar = require("./assets/character-tavern-logo.png") as ImageSourcePropType;
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
    const localFallback = localFallbackForNonSearchInput(userText);
    if (localFallback !== null) {
      finalizePlaceholder(conversationId, placeholderId, { text: localFallback });
      store.touch(conversationId, localFallback.slice(0, 120));
      return;
    }

    const result = await inferOnce({
      miniAppId: MINI_APP_ID,
      prompt: buildRecommendationPrompt(userText),
      timeoutMs: INFER_TIMEOUT_MS
    });
    const assistantText = result.text;
    const parsed = parseTavernRecommendations(assistantText);

    if (!parsed.ok) {
      // Never surface arbitrary OpenClaw prose here. A fresh `tavern` agent
      // can otherwise leak its first-run onboarding text into the product UI
      // when it misses the structured recommendation contract.
      if (__DEV__) {
        console.warn("[tavern] recommendations parse failed:", parsed.error, assistantText.slice(0, 500));
      }
      const fallback = "这次没有拿到可渲染的角色卡推荐。换个更具体的说法试试？比如题材、性格、关系或世界观。";
      finalizePlaceholder(conversationId, placeholderId, {
        text: fallback
      });
      store.touch(conversationId, fallback.slice(0, 120));
      return;
    }

    expandItemsIntoMessages(conversationId, placeholderId, parsed.value.items);

    const cards = parsed.value.items.filter(
      (item): item is Extract<TavernRecommendationItem, { kind: "card" }> => item.kind === "card"
    );
    const previewNames = cards
      .slice(0, 2)
      .map((item) => item.card.nameZh)
      .join("、");
    const preview = previewNames.length > 0
      ? `推荐了 ${cards.length} 张：${previewNames}`
      : `推荐了 ${cards.length} 张`;
    store.touch(conversationId, preview);
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
    finalizePlaceholder(conversationId, placeholderId, {
      text: "",
      error: userMessage
    });
  }
}

function localFallbackForNonSearchInput(userText: string): string | null {
  const normalized = userText
    .trim()
    .toLowerCase()
    .replace(/[~～!！.。?？,，\s]/g, "");
  if (normalized.length === 0) return "说说你想找什么样的角色卡？比如题材、性格、关系或世界观。";
  if (/^(你好|你好啊|嗨|hi|hello|哈喽|在吗|start|\/start)$/.test(normalized)) {
    return "我可以帮你从 Character Tavern 找角色卡。说说你想要什么样的？比如侦探、校园、治愈、病娇、室友。";
  }
  if (/^(谢谢|谢啦|好的|好|晚安|拜拜|再见)$/.test(normalized)) {
    return "好呀。想继续找角色卡时，直接告诉我题材、性格或关系就行。";
  }
  return null;
}

function buildRecommendationPrompt(userText: string): string {
  return [
    "KokoChat Tavern recommendation request.",
    "You are serving the KokoChat Tavern mini-app, not starting a new OpenClaw companion onboarding.",
    "Do not ask the user to name you, define your identity, choose your vibe, or pick an emoji.",
    "Follow the kokochat-tavern-search skill contract.",
    "If the request is concrete enough, search Character Tavern and return exactly one koko.tavern.recommendations fenced block.",
    "If the request is too vague to search, ask one short Chinese clarification question and do not mention OpenClaw setup.",
    "",
    "User request:",
    userText
  ].join("\n");
}

/**
 * Expand a parsed items[] into a stream of agent messages, replacing the
 * single streaming placeholder. All synthesized messages share one runId so
 * the chat UI groups them (collapsed avatars on continuation rows, etc).
 */
function expandItemsIntoMessages(
  conversationId: string,
  placeholderId: string,
  items: TavernRecommendationItem[]
): void {
  const runId = `tavern-${Date.now()}`;
  const messages: ChatMessage[] = items.map((item, idx) => {
    const id = `${runId}-${idx}`;
    if (item.kind === "text") {
      return {
        id,
        role: "agent",
        text: item.text,
        runId,
        streaming: false
      };
    }
    return {
      id,
      role: "agent",
      text: "",
      runId,
      streaming: false,
      blocks: [
        {
          type: CARD_BLOCK_TYPE,
          version: 1,
          data: item.card
        }
      ]
    };
  });

  useConversationStore.getState().setMessages(conversationId, (prev) => {
    const idx = prev.findIndex((m) => m.id === placeholderId);
    if (idx < 0) {
      // Placeholder was already removed somehow; just append.
      return [...prev, ...messages];
    }
    const next = [...prev];
    next.splice(idx, 1, ...messages);
    return next;
  });
}

function isTimeout(message: string): boolean {
  return /timed?\s*out|timeout/i.test(message);
}

interface FinalizePatch {
  text: string;
  error?: string;
}

/**
 * Replace the streaming placeholder in-place with a single final message
 * (used for failure / fallback paths). Successful recommendations go
 * through `expandItemsIntoMessages` instead.
 */
function finalizePlaceholder(
  conversationId: string,
  placeholderId: string,
  patch: FinalizePatch
): void {
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
    listImage: tavernAvatar,
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
    CARD_BLOCK_TYPE,
    isTavernRecommendationCard,
    TavernCardBlock
  );
}
