import type { ImageSourcePropType } from "react-native";

import { registerAgentResponseTransformer } from "@/runtime/agentResponses";
import { registerMiniApp } from "@/runtime/miniApps";
import { registerSharedBlockRenderer } from "@/runtime/messageBlocks";
import {
  registerOutboundMessageBuilder,
  type OutboundMessageBuilder
} from "@/runtime/outboundMessages";
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
 *   2. Mini-app forwards a KokoChat-specific prompt to the conversation's
 *      persistent `tavern` OpenClaw agent session.
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

let registered = false;

const tavernOutboundBuilder: OutboundMessageBuilder = async ({ visibleText }) => {
  return {
    visibleText,
    gatewayText: buildRecommendationPrompt(visibleText)
  };
};

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
 * Expand a parsed items[] into a stream of agent messages. All synthesized
 * messages share the OpenClaw runId so the chat UI groups them (collapsed
 * avatars on continuation rows, etc).
 */
function buildRecommendationMessages(
  runId: string,
  items: TavernRecommendationItem[]
): ChatMessage[] {
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

  return messages;
}

function transformTavernAgentResponse({
  runId,
  text
}: {
  runId: string;
  text: string;
}): { messages: ChatMessage[]; preview?: string } | null {
  const parsed = parseTavernRecommendations(text);
  if (!parsed.ok) return null;

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

  return {
    messages: buildRecommendationMessages(runId, parsed.value.items),
    preview
  };
}

function isTavernRecommendationStream({ text }: { text: string }): boolean {
  return /```[ \t]*koko\.tavern\.recommendations\b/.test(text);
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
      requiredCoreTools: ["exec", "process"],
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
  registerAgentResponseTransformer(MINI_APP_ID, transformTavernAgentResponse, {
    shouldDeferStreamingText: isTavernRecommendationStream
  });
  registerSharedBlockRenderer(
    CARD_BLOCK_TYPE,
    isTavernRecommendationCard,
    TavernCardBlock
  );
}
