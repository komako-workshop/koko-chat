import { registerMiniApp } from "@/runtime/miniApps";
import { getMiniAppStorage } from "@/runtime/miniAppStorage";
import {
  registerOutboundMessageBuilder,
  type OutboundMessageBuilder
} from "@/runtime/outboundMessages";
import { inferOnce } from "@/runtime/openclaw";
import { useConversationStore } from "@/state/conversations";
import { router } from "expo-router";

/**
 * Tavern Roleplay mini-app: 用一张 Character Tavern 角色卡开启一场长会话。
 *
 * Product loop:
 *   1. User taps a recommended card in the Tavern (酒馆助手) conversation.
 *   2. The Tavern mini-app calls `startTavernRoleplaySession` with the card
 *      summary it has on hand (pageUrl / imageUrl / nameZh / etc.).
 *   3. This module fetches the full SillyTavern-shape card via the
 *      `kokochat-tavern-search` skill's `fetch-card` bin, translates the
 *      `first_mes` into Chinese with `inferOnce`, creates a conversation in
 *      `tavern-roleplay` mode and pre-seeds the chat with the localized
 *      opening line as the first agent message.
 *   4. When the user sends their first message, this mini-app's outbound
 *      builder prepends the full card JSON inline so the bound OpenClaw
 *      `tavern-roleplay` agent picks it up. From the second turn on the
 *      builder is transparent and the host's default chat.send carries the
 *      conversation forward.
 *
 * The mini-app is intentionally *not* shown in the launcher: the only entry
 * point is tapping a recommended card.
 */

const MINI_APP_ID = "tavern-roleplay";
const STORAGE = getMiniAppStorage(MINI_APP_ID);

let registered = false;

export interface TavernRoleplayCardSummary {
  /** "<author>/<slug>" path on Character Tavern. */
  path: string;
  pageUrl: string;
  imageUrl: string;
  /** English display name, never empty. */
  name: string;
  /** Localized Chinese name when the recommender produced one. */
  nameZh?: string;
  /** Original tagline, may be empty. */
  tagline?: string;
  /** Localized Chinese tagline when available. */
  taglineZh?: string;
}

/** Public entry point used by the Tavern recommendations renderer. */
export async function startTavernRoleplaySession(summary: TavernRoleplayCardSummary): Promise<void> {
  registerTavernRoleplayMiniApp();
  const card = await fetchFullCard(summary.path);
  STORAGE.setJson(`card.${summary.path}`, card);

  const characterName = card.inChatName || card.name || summary.nameZh || summary.name;
  const localizedFirstMes = await translateFirstMes(card, characterName);
  const titleZh = summary.nameZh || characterName;
  const subtitle = summary.taglineZh || summary.tagline || "";

  const meta = useConversationStore.getState().create({
    mode: MINI_APP_ID,
    title: titleZh,
    sessionScope: `${slug(summary.path)}:${Date.now().toString(36)}`,
    artifactRef: {
      type: "koko.tavern.character",
      id: summary.path,
      miniAppId: MINI_APP_ID
    },
    listSnapshot: {
      title: titleZh,
      ...(subtitle.length > 0 ? { subtitle } : {}),
      avatarUri: summary.imageUrl
    }
  });

  STORAGE.setJson(`session.${meta.id}`, {
    cardPath: summary.path,
    bootstrapped: false
  });

  if (localizedFirstMes.trim().length > 0) {
    useConversationStore.getState().setMessages(meta.id, () => [
      {
        id: `tavern-roleplay-firstmes-${meta.id}`,
        role: "agent",
        text: localizedFirstMes
      }
    ]);
    useConversationStore.getState().touch(meta.id, localizedFirstMes.slice(0, 120));
  }

  router.push({ pathname: "/chat/[id]", params: { id: meta.id } });
}

const tavernRoleplayOutboundBuilder: OutboundMessageBuilder = async ({ conversation, visibleText }) => {
  const state = STORAGE.getJson<{ cardPath: string; bootstrapped: boolean }>(`session.${conversation.id}`);
  if (state === undefined) {
    // Conversation was created outside startTavernRoleplaySession (e.g. legacy
    // record); fall back to host default behaviour.
    return { visibleText, gatewayText: visibleText };
  }
  if (state.bootstrapped) {
    return { visibleText, gatewayText: visibleText };
  }
  const card = STORAGE.getJson<unknown>(`card.${state.cardPath}`);
  if (card === undefined) {
    return { visibleText, gatewayText: visibleText };
  }
  STORAGE.setJson(`session.${conversation.id}`, { ...state, bootstrapped: true });
  return {
    visibleText,
    gatewayText: buildBootstrapPrefix(card) + "\n\n" + visibleText
  };
};

function buildBootstrapPrefix(card: unknown): string {
  return [
    "KokoChat Tavern roleplay bootstrap.",
    "The character card for this session is inlined below as JSON.",
    "Use it as the binding for every reply in this session. Do not ask the user to provide it again.",
    "The KokoChat client has already displayed the card's first_mes locally; do not repeat it.",
    "After parsing the card, reply in character to the user's message that follows the JSON block.",
    "Default to natural Chinese replies. Keep names, proper nouns, quoted catchphrases, and setting-specific terms in their original language when natural.",
    "",
    "```json",
    JSON.stringify(card),
    "```"
  ].join("\n");
}

async function fetchFullCard(path: string): Promise<FetchedCard> {
  // V0: KokoChat fetches the Character Tavern detail endpoint directly from
  // the device. This is fine on the iOS simulator and on networks that can
  // reach character-tavern.com; in restricted networks the fetch will fail
  // and the call will surface the error to the user.
  //
  // A future iteration should route this through an OpenClaw bin (see
  // `kokochat-tavern-search/bin/fetch-card.mjs`) so the request goes out from
  // the Mac instead of the device.
  const cleanPath = path.trim().replace(/^\/+|\/+$/g, "");
  if (cleanPath.length === 0) throw new Error("fetchFullCard: empty path");
  const url = `https://character-tavern.com/api/character/${cleanPath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let payload: { card?: Record<string, unknown> };
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`character-tavern HTTP ${response.status}`);
    }
    payload = (await response.json()) as { card?: Record<string, unknown> };
  } finally {
    clearTimeout(timer);
  }
  const card = normalizeCharacterTavernDetail(payload?.card);
  if (card === null) throw new Error("character-tavern detail response missing card");
  return card;
}

function normalizeCharacterTavernDetail(raw: unknown): FetchedCard | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const path = stringOr(r.path, "").trim();
  if (path.length === 0) return null;
  return {
    source: "character_tavern",
    id: stringOr(r.id, path),
    path,
    pageUrl: `https://character-tavern.com/character/${path}`,
    imageUrl: `https://cards.character-tavern.com/${path}.png`,
    name: stringOr(r.name, ""),
    inChatName: stringOr(r.inChatName, "") || stringOr(r.name, ""),
    tagline: stringOr(r.tagline, ""),
    pageDescription: stringOr(r.description, ""),
    isNSFW: r.isNSFW === true,
    isOC: r.isOC === true,
    tokenTotal: numberOr(r.tokenTotal, 0),
    data: {
      name: stringOr(r.inChatName, "") || stringOr(r.name, ""),
      description: stringOr(r.definition_character_description, ""),
      personality: stringOr(r.definition_personality, ""),
      scenario: stringOr(r.definition_scenario, ""),
      first_mes: stringOr(r.definition_first_message, ""),
      mes_example: stringOr(r.definition_example_messages, ""),
      system_prompt: stringOr(r.definition_system_prompt, ""),
      post_history_instructions: stringOr(r.definition_post_history_prompt, ""),
      alternate_greetings: arrayOfStrings(r.alternate_greetings),
      character_book: isPlainObject(r.character_book) ? r.character_book : null,
      tags: arrayOfStrings(r.tags)
    }
  };
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed.length > 0) out.push(trimmed);
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

interface FetchedCard {
  source: string;
  id: string;
  path: string;
  pageUrl: string;
  imageUrl: string;
  name: string;
  inChatName: string;
  tagline: string;
  pageDescription: string;
  isNSFW: boolean;
  isOC: boolean;
  tokenTotal: number;
  data: {
    name: string;
    description: string;
    personality: string;
    scenario: string;
    first_mes: string;
    mes_example: string;
    system_prompt: string;
    post_history_instructions: string;
    alternate_greetings: string[];
    character_book: Record<string, unknown> | null;
    tags: string[];
  };
}

async function translateFirstMes(card: FetchedCard, characterName: string): Promise<string> {
  const original = typeof card.data?.first_mes === "string" ? card.data.first_mes.trim() : "";
  if (original.length === 0) return "";
  if (looksMostlyChinese(original)) return original;
  const result = await inferOnce({
    miniAppId: MINI_APP_ID,
    prompt: [
      "把下面的角色开场白翻译成自然中文。",
      "要求：",
      "- 保留角色语气、动作描写、段落结构和 Markdown / 斜体标记。",
      "- 人名、乐队名、地名、专有名词可保留原文。",
      "- 只输出译文，不要解释。",
      "",
      `角色名：${characterName}`,
      "",
      "原文：",
      original
    ].join("\n"),
    timeoutMs: 300_000
  });
  const translated = result.text.trim();
  return translated.length > 0 ? translated : original;
}

function looksMostlyChinese(text: string): boolean {
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length;
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  return cjk > 0 && cjk >= letters * 0.2;
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "card";
}

export function registerTavernRoleplayMiniApp(): void {
  if (registered) return;
  registered = true;

  registerMiniApp({
    id: MINI_APP_ID,
    displayName: "酒馆角色聊天",
    listGlyph: "🎭",
    // The launcher should not show this mini-app: the only legitimate way in
    // is tapping a recommended card. Showing it would let users open an empty
    // roleplay conversation with no bound character.
    showInLauncher: false,
    defaultTitle: () => "酒馆角色",
    openclaw: {
      defaultAgentId: "tavern-roleplay",
      requiredSkills: ["kokochat-tavern-roleplay", "kokochat-tavern-search"],
      requiredCoreTools: ["exec"],
      localSkillDirs: [
        "miniapps/tavern/openclaw/skills/kokochat-tavern-roleplay",
        "miniapps/tavern/openclaw/skills/kokochat-tavern-search"
      ]
    },
    onCreate: () => {
      // The mini-app does not expose a generic "new conversation" entry; the
      // launcher is hidden and direct creation requires a bound card. Throw a
      // visible error so anything that misuses the registry surface fails
      // loudly during development.
      throw new Error("tavern-roleplay sessions are created via startTavernRoleplaySession(card)");
    }
  } as Parameters<typeof registerMiniApp>[0]);

  registerOutboundMessageBuilder(MINI_APP_ID, tavernRoleplayOutboundBuilder);
}
