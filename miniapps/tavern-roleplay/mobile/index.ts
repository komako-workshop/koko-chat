import { registerConversationMode } from "@/runtime/conversationModes";
import { getMiniAppStorage } from "@/runtime/miniAppStorage";
import { openConversation } from "@/runtime/navigation";
import {
  registerOutboundMessageBuilder,
  type OutboundMessageBuilder
} from "@/runtime/outboundMessages";
import { registerBootstrapRetryHandler } from "@/runtime/bootstrapRetries";
import { runWithBackgroundTask } from "@/runtime/backgroundTasks";
import { extractFencedBlock } from "@/runtime/messageBlocks";
import { inferOnce } from "@/runtime/openclaw";
import {
  buildDefaultSessionRestoreMessage,
  formatRecentTranscript,
  registerRemoteSessionRestoreDecider,
  registerSessionRestoreBuilder,
  type SessionRestoreBuilder
} from "@/runtime/sessionRestore";
import { useConversationStore } from "@/state/conversations";
import { useGatewayStore } from "@/state/gateway";

import { resolvePersonaName } from "@/state/tavernPersona";

import { applyTavernMacros } from "../../tavern/mobile/macros";

/**
 * Tavern Roleplay mode: 酒馆产品里的角色聊天子模式。
 *
 * Product loop:
 *   1. User taps a recommended card in the Tavern (酒馆助手) conversation.
 *   2. The Tavern mini-app calls `startTavernRoleplaySession` with the card
 *      summary it has on hand (pageUrl / imageUrl / nameZh / etc.).
 *   3. This module fetches the full SillyTavern-shape card via the
 *      `kokochat-tavern-search` skill's `fetch-card` bin, translates the
 *      `first_mes` into Chinese with `inferOnce`, creates a conversation in
 *      hidden `tavern-roleplay` mode and pre-seeds the chat with the
 *      localized opening line as the first agent message.
 *   4. When the user sends their first message, this mini-app's outbound
 *      builder prepends the full card JSON inline so the bound OpenClaw
 *      `tavern-roleplay` agent picks it up. From the second turn on the
 *      builder is transparent and the host's default chat.send carries the
 *      conversation forward.
 *
 * This mode is intentionally *not* shown in the launcher: the only entry
 * point is tapping a recommended card from the Tavern product.
 */

const MINI_APP_ID = "tavern-roleplay";
const STORAGE = getMiniAppStorage(MINI_APP_ID);
const CARD_DETAIL_BLOCK_TYPE = "koko.tavern.card-detail";
const CHARACTER_TAVERN_CARD_FETCH_TIMEOUT_MS = 15_000;
const CARD_FETCH_MAX_ATTEMPTS = 3;
const CARD_FETCH_RETRY_DELAYS_MS = [1_500, 3_500];

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
  /**
   * Optional pre-fetched payload from the Tavern browse page. When supplied
   * we skip both the remote `fetchFullCard()` HTTP hop and the LLM
   * `translateFirstMes()` round-trip — the chat opens instantly with the
   * pre-baked Chinese opening line. Used by `BrowseScreen` so cards from
   * the curated catalogue don't pay any network cost on entry.
   *
   * Fields:
   *   - description: original English description (kept for the agent
   *                  bootstrap prompt — see `buildBootstrapPrefix`).
   *   - personality / scenario: original English persona definitions, also
   *                  used by the bootstrap prompt.
   *   - firstMessage: original English first_mes, used as the canonical
   *                  card text the agent sees.
   *   - firstMessageZh: pre-translated Chinese first_mes, surfaced as the
   *                  conversation's first agent message.
   */
  prefetched?: {
    description?: string;
    personality?: string;
    scenario?: string;
    firstMessage?: string;
    firstMessageZh?: string;
  };
}

interface TavernRoleplaySessionState {
  cardPath: string;
  /**
   * Legacy local flag. Older builds set this before `chat.send` completed,
   * so it cannot be trusted as proof that OpenClaw received the card.
   */
  bootstrapped: boolean;
  /** True only after OpenClaw accepts a send that included card/restore context. */
  remoteBootstrapped?: boolean;
  summary?: TavernRoleplayCardSummary;
}

/**
 * Public entry point used by the Tavern recommendations renderer.
 *
 * UX requirement: the user taps a card and lands in the roleplay chat
 * window *immediately*, even though we need to hit character-tavern.com
 * for the full card and run an LLM translation pass for the opening
 * line. We split the work in two:
 *
 *   1. Synchronous (this function, before it returns):
 *      - create the conversation with what we already know from the
 *        recommendation summary (avatar, names, tagline)
 *      - mark the conversation as `bootstrap: "loading"` so the chat
 *        page shows a status banner and locks the input
 *      - push the route — user sees the new chat window within a frame
 *
 *   2. Background (`bootstrapInBackground`):
 *      - fetch the full Character Tavern card
 *      - translate the opening line
 *      - seed the first agent message
 *      - flip the bootstrap state to `ready` (chat unlocks)
 *      - on failure, set `error` so the user sees what broke
 */
export function startTavernRoleplaySession(summary: TavernRoleplayCardSummary): void {
  registerTavernRoleplayMiniApp();

  const characterName = summary.nameZh || summary.name;
  const titleZh = characterName;
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
    },
    bootstrap: {
      status: "loading",
      hint: "正在拉角色卡 + 翻译开场白，准备好就可以开始聊天～"
    }
  });

  STORAGE.setJson(`session.${meta.id}`, {
    cardPath: summary.path,
    bootstrapped: false,
    remoteBootstrapped: false,
    summary
  } satisfies TavernRoleplaySessionState);

  openConversation(meta.id);

  // Browse-page entry: we already have the full English card + Chinese
  // first_mes in the bundle, no remote work needed. Hydrate everything
  // synchronously on the next tick and flip bootstrap to "ready" without
  // ever showing the loading banner.
  if (summary.prefetched !== undefined && hasUsablePrefetch(summary.prefetched)) {
    bootstrapFromPrefetched(meta.id, summary);
    return;
  }

  // Recommendation-card entry (酒馆助手): we only have a card summary; need
  // to fetch the full card + translate first_mes from character-tavern.
  void bootstrapInBackground(meta.id, summary);
}

export function retryTavernRoleplayBootstrap(conversationId: string): void {
  const state = STORAGE.getJson<TavernRoleplaySessionState>(`session.${conversationId}`);
  if (state?.summary === undefined) {
    useConversationStore.getState().setBootstrap(conversationId, {
      status: "error",
      error: "角色卡加载失败：缺少可重试的角色卡信息。"
    });
    return;
  }
  STORAGE.setJson(`session.${conversationId}`, {
    ...state,
    bootstrapped: false,
    remoteBootstrapped: false
  } satisfies TavernRoleplaySessionState);
  const store = useConversationStore.getState();
  store.setMessages(conversationId, () => []);
  store.setBootstrap(conversationId, {
    status: "loading",
    hint: "正在重新拉角色卡 + 准备开场白。"
  });
  void bootstrapInBackground(conversationId, state.summary);
}

function hasUsablePrefetch(p: NonNullable<TavernRoleplayCardSummary["prefetched"]>): boolean {
  // The minimum needed to open the chat sensibly is a first_mes (or its
  // Chinese version). Everything else (description / personality /
  // scenario) is gravy used by the system prompt.
  return (
    (typeof p.firstMessageZh === "string" && p.firstMessageZh.trim().length > 0) ||
    (typeof p.firstMessage === "string" && p.firstMessage.trim().length > 0)
  );
}

function bootstrapFromPrefetched(
  conversationId: string,
  summary: TavernRoleplayCardSummary
): void {
  const store = useConversationStore.getState();
  const pre = summary.prefetched!;
  // Synthesise the same in-memory card shape `fetchFullCard()` produces,
  // so the existing outbound builder + buildBootstrapPrefix path works
  // unchanged. Fields we don't have stay empty.
  const card: PartialFetchedCard = {
    source: "character_tavern",
    id: summary.path,
    path: summary.path,
    pageUrl: summary.pageUrl,
    imageUrl: summary.imageUrl,
    name: summary.name,
    inChatName: summary.nameZh || summary.name,
    tagline: summary.tagline ?? "",
    pageDescription: pre.description ?? "",
    isNSFW: false,
    isOC: false,
    tokenTotal: 0,
    data: {
      name: summary.nameZh || summary.name,
      description: pre.description ?? "",
      personality: pre.personality ?? "",
      scenario: pre.scenario ?? "",
      first_mes: pre.firstMessage ?? "",
      mes_example: "",
      system_prompt: "",
      post_history_instructions: "",
      alternate_greetings: [],
      character_book: null,
      tags: []
    }
  };
  STORAGE.setJson(`card.${summary.path}`, card);

  // Pick the Chinese first_mes when available; fall back to the original
  // English one. The browse catalogue ships both for almost every card.
  const opening =
    (pre.firstMessageZh && pre.firstMessageZh.trim().length > 0
      ? pre.firstMessageZh
      : pre.firstMessage) ?? "";

  if (opening.trim().length > 0) {
    store.setMessages(conversationId, () => [
      {
        id: `tavern-roleplay-firstmes-${conversationId}`,
        role: "agent",
        text: opening
      }
    ]);
    store.touch(conversationId, opening.slice(0, 120));
  }

  store.setBootstrap(conversationId, { status: "ready" });
}

async function bootstrapInBackground(
  conversationId: string,
  summary: TavernRoleplayCardSummary
): Promise<void> {
  return runWithBackgroundTask("KokoChat Tavern roleplay bootstrap", async () => {
    await runTavernRoleplayBootstrap(conversationId, summary);
  });
}

async function runTavernRoleplayBootstrap(
  conversationId: string,
  summary: TavernRoleplayCardSummary
): Promise<void> {
  const store = useConversationStore.getState();
  try {
    const card = await fetchFullCardForBootstrap(conversationId, summary.path);

    const characterName = card.inChatName || card.name || summary.nameZh || summary.name;
    // SillyTavern macros (`{{user}}` / `{{char}}`) live throughout the card
    // body. Substitute them once here using the persona name the user set
    // in Tavern settings, so neither the agent nor the localised opening
    // line ever sees raw placeholders. We use the "prompt" form of the
    // persona name ("用户") for the card payload the agent will read, and
    // the user-facing form ("你") for the message rendered in chat.
    const promptCtx = { user: resolvePersonaName(true), char: characterName };
    const uiCtx = { user: resolvePersonaName(false), char: characterName };
    const expandedCard: typeof card = {
      ...card,
      data: {
        ...card.data,
        description: applyTavernMacros(card.data.description, promptCtx),
        personality: applyTavernMacros(card.data.personality, promptCtx),
        scenario: applyTavernMacros(card.data.scenario, promptCtx),
        first_mes: applyTavernMacros(card.data.first_mes, promptCtx),
        mes_example: applyTavernMacros(card.data.mes_example, promptCtx)
      }
    };
    STORAGE.setJson(`card.${summary.path}`, expandedCard);

    const localizedFirstMes = await translateFirstMes(expandedCard, characterName, (partial) => {
      const renderedPartial = applyTavernMacros(partial, uiCtx);
      if (renderedPartial.trim().length > 0) {
        upsertOpeningMessage(conversationId, renderedPartial, true);
      }
    });
    const renderedFirstMes = applyTavernMacros(localizedFirstMes, uiCtx);

    if (renderedFirstMes.trim().length > 0) {
      upsertOpeningMessage(conversationId, renderedFirstMes, false);
      store.touch(conversationId, renderedFirstMes.slice(0, 120));
    }

    store.setBootstrap(conversationId, { status: "ready" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (__DEV__) {
      console.warn("[tavern-roleplay] bootstrap failed:", message);
    }
    store.setBootstrap(conversationId, {
      status: "error",
      error: `角色卡加载失败：${message.slice(0, 200)}`
    });
  }
}

type PartialFetchedCard = FetchedCard;

function upsertOpeningMessage(
  conversationId: string,
  text: string,
  streaming: boolean
): void {
  const messageId = `tavern-roleplay-firstmes-${conversationId}`;
  useConversationStore.getState().setMessages(conversationId, (prev) => {
    const idx = prev.findIndex((message) => message.id === messageId);
    if (idx < 0) {
      return [
        ...prev,
        {
          id: messageId,
          role: "agent",
          text,
          streaming
        }
      ];
    }
    const existing = prev[idx];
    if (existing === undefined) return prev;
    const next = [...prev];
    next[idx] = { ...existing, text, streaming };
    return next;
  });
}

async function fetchFullCardForBootstrap(
  conversationId: string,
  path: string
): Promise<FetchedCard> {
  const cleanPath = normalizeCharacterTavernPath(path);
  if (cleanPath.length === 0) throw new Error("角色卡 path 为空");

  try {
    return await fetchFullCardFromCharacterTavern(cleanPath);
  } catch (error) {
    if (__DEV__) {
      console.warn(
        "[tavern-roleplay] direct Character Tavern card fetch failed; falling back to OpenClaw:",
        error instanceof Error ? error.message : String(error)
      );
    }
    useConversationStore.getState().setBootstrap(conversationId, {
      status: "loading",
      hint: "手机直连角色卡失败，正在改用 OpenClaw 拉取。"
    });
    return fetchFullCardWithTransportRetry(conversationId, cleanPath);
  }
}

async function fetchFullCardFromCharacterTavern(path: string): Promise<FetchedCard> {
  const cleanPath = normalizeCharacterTavernPath(path);
  if (cleanPath.length === 0) throw new Error("fetchFullCardFromCharacterTavern: empty path");

  const payload = await fetchJsonWithTimeout(
    `https://character-tavern.com/api/character/${encodeCharacterTavernPath(cleanPath)}`,
    CHARACTER_TAVERN_CARD_FETCH_TIMEOUT_MS
  );
  if (!isPlainObject(payload)) {
    throw new Error("Character Tavern 返回的角色卡详情不可用");
  }

  const card = normalizeCharacterTavernApiCard(payload.card, cleanPath);
  if (card === null) throw new Error("Character Tavern 未返回可用角色卡");
  return card;
}

async function fetchFullCardWithTransportRetry(
  conversationId: string,
  path: string
): Promise<FetchedCard> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= CARD_FETCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fetchFullCard(path);
    } catch (error) {
      lastError = error;
      if (!isRecoverableTransportError(error) || attempt >= CARD_FETCH_MAX_ATTEMPTS) {
        throw error;
      }
      if (__DEV__) {
        console.warn(
          `[tavern-roleplay] card fetch transport error; retrying ${attempt + 1}/${CARD_FETCH_MAX_ATTEMPTS}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
      useConversationStore.getState().setBootstrap(conversationId, {
        status: "loading",
        hint: `连接中断，正在重试角色卡加载（${attempt + 1}/${CARD_FETCH_MAX_ATTEMPTS}）…`
      });
      await useGatewayStore.getState().reconnectIfPossible({ force: true }).catch(() => false);
      await sleep(CARD_FETCH_RETRY_DELAYS_MS[attempt - 1] ?? CARD_FETCH_RETRY_DELAYS_MS.at(-1) ?? 1_500);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function isRecoverableTransportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(^|\s)disconnect($|\s)|websocket closed:\s*(1000|1001|1005|1006|1012|1013)\b|ws not open|not connected/i.test(
    message
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const tavernRoleplayOutboundBuilder: OutboundMessageBuilder = async ({
  conversation,
  visibleText,
  isFirstUserTurn
}) => {
  const state = STORAGE.getJson<TavernRoleplaySessionState>(`session.${conversation.id}`);
  if (state === undefined) {
    // Conversation was created outside startTavernRoleplaySession (e.g. legacy
    // record); fall back to host default behaviour.
    return { visibleText, gatewayText: visibleText };
  }
  if (state.remoteBootstrapped === true) {
    return { visibleText, gatewayText: visibleText };
  }
  const card = STORAGE.getJson<unknown>(`card.${state.cardPath}`);
  if (card === undefined) {
    return { visibleText, gatewayText: visibleText };
  }
  const markAccepted = (): void => {
    const latest = STORAGE.getJson<TavernRoleplaySessionState>(`session.${conversation.id}`) ?? state;
    STORAGE.setJson(`session.${conversation.id}`, {
      ...latest,
      bootstrapped: true,
      remoteBootstrapped: true
    } satisfies TavernRoleplaySessionState);
  };
  if (!isFirstUserTurn) {
    return {
      visibleText,
      gatewayText: visibleText,
      onSendAccepted: markAccepted
    };
  }
  return {
    visibleText,
    gatewayText: buildBootstrapPrefix(card) + "\n\n" + visibleText,
    onSendAccepted: markAccepted
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

const tavernRoleplaySessionRestoreBuilder: SessionRestoreBuilder = (input) => {
  const state = STORAGE.getJson<TavernRoleplaySessionState>(`session.${input.conversation.id}`);
  if (state === undefined) return buildDefaultSessionRestoreMessage(input);

  const card = STORAGE.getJson<unknown>(`card.${state.cardPath}`);
  if (card === undefined) return buildDefaultSessionRestoreMessage(input);

  const transcript = formatRecentTranscript(input.messages);
  if (transcript === null) return null;

  return [
    "KokoChat Tavern roleplay session restore.",
    "The phone has local roleplay history, but this OpenClaw session is empty or missing.",
    "Use the character card and transcript below as established context.",
    "Stay in character. Do not repeat the opening message, summarize the restore, or ask for setup again.",
    "Reply only to the current user turn that follows this restore block.",
    "",
    "<character_card_json>",
    JSON.stringify(card),
    "</character_card_json>",
    "",
    "<recent_transcript>",
    transcript,
    "</recent_transcript>"
  ].join("\n");
};

function shouldRestoreTavernRoleplaySession(input: {
  conversation: { id: string };
}): boolean {
  const state = STORAGE.getJson<TavernRoleplaySessionState>(`session.${input.conversation.id}`);
  if (state === undefined) return false;
  if (state.remoteBootstrapped === true) return false;
  return STORAGE.getJson<unknown>(`card.${state.cardPath}`) !== undefined;
}

async function fetchFullCard(path: string): Promise<FetchedCard> {
  const cleanPath = normalizeCharacterTavernPath(path);
  if (cleanPath.length === 0) throw new Error("fetchFullCard: empty path");

  const result = await inferOnce({
    miniAppId: "tavern",
    prompt: buildFetchCardPrompt(cleanPath),
    timeoutMs: 180_000
  });
  const fenced = extractFencedBlock(result.text, CARD_DETAIL_BLOCK_TYPE);
  if (fenced === null) {
    throw new Error("OpenClaw 未返回角色卡详情块");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(fenced.body);
  } catch (error) {
    throw new Error(
      `角色卡详情 JSON 解析失败: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!isPlainObject(payload) || payload.version !== 1) {
    throw new Error("角色卡详情块版本不正确");
  }
  if (typeof payload.error === "string" && payload.error.trim().length > 0) {
    throw new Error(payload.error.trim());
  }
  const card = normalizeFetchedCard(payload.card);
  if (card === null) throw new Error("OpenClaw 返回的角色卡详情不可用");
  return card;
}

function buildFetchCardPrompt(path: string): string {
  return [
    "KokoChat Tavern internal card detail fetch request.",
    "Run the kokochat-tavern-search fetch-card tool for this Character Tavern path.",
    "Do not recommend other cards. Do not roleplay.",
    "Return exactly one fenced block tagged koko.tavern.card-detail, with JSON:",
    '{"version":1,"card":<the normalized card object from fetch-card>}',
    "No prose outside the fenced block.",
    "",
    "Path:",
    path
  ].join("\n");
}

function normalizeFetchedCard(raw: unknown): FetchedCard | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const path = stringOr(r.path, "").trim();
  if (path.length === 0) return null;
  const data = isPlainObject(r.data) ? r.data : {};
  return {
    source: stringOr(r.source, "character_tavern"),
    id: stringOr(r.id, path),
    path,
    pageUrl: stringOr(r.pageUrl, `https://character-tavern.com/character/${path}`),
    imageUrl: stringOr(r.imageUrl, `https://cards.character-tavern.com/${path}.png`),
    name: stringOr(r.name, ""),
    inChatName: stringOr(r.inChatName, "") || stringOr(r.name, ""),
    tagline: stringOr(r.tagline, ""),
    pageDescription: stringOr(r.pageDescription, ""),
    isNSFW: r.isNSFW === true,
    isOC: r.isOC === true,
    tokenTotal: numberOr(r.tokenTotal, 0),
    data: {
      name: stringOr(data.name, "") || stringOr(r.inChatName, "") || stringOr(r.name, ""),
      description: stringOr(data.description, ""),
      personality: stringOr(data.personality, ""),
      scenario: stringOr(data.scenario, ""),
      first_mes: stringOr(data.first_mes, ""),
      mes_example: stringOr(data.mes_example, ""),
      system_prompt: stringOr(data.system_prompt, ""),
      post_history_instructions: stringOr(data.post_history_instructions, ""),
      alternate_greetings: arrayOfStrings(data.alternate_greetings),
      character_book: isPlainObject(data.character_book) ? data.character_book : null,
      tags: arrayOfStrings(data.tags)
    }
  };
}

function normalizeCharacterTavernApiCard(raw: unknown, requestedPath: string): FetchedCard | null {
  if (!isPlainObject(raw)) return null;
  const path = normalizeCharacterTavernPath(stringOr(raw.path, requestedPath));
  if (path.length === 0) return null;
  return normalizeFetchedCard({
    source: "character_tavern",
    id: stringOr(raw.id, path),
    path,
    pageUrl: `https://character-tavern.com/character/${path}`,
    imageUrl: `https://cards.character-tavern.com/${path}.png`,
    name: stringOr(raw.name, ""),
    inChatName: stringOr(raw.inChatName, "") || stringOr(raw.name, ""),
    tagline: stringOr(raw.tagline, ""),
    pageDescription: stringOr(raw.description, ""),
    isNSFW: raw.isNSFW === true,
    isOC: raw.isOC === true,
    tokenTotal: numberOr(raw.tokenTotal, 0),
    data: {
      name: stringOr(raw.inChatName, "") || stringOr(raw.name, ""),
      description: stringOr(raw.definition_character_description, ""),
      personality: stringOr(raw.definition_personality, ""),
      scenario: stringOr(raw.definition_scenario, ""),
      first_mes: stringOr(raw.definition_first_message, ""),
      mes_example: stringOr(raw.definition_example_messages, ""),
      system_prompt: stringOr(raw.definition_system_prompt, ""),
      post_history_instructions: stringOr(raw.definition_post_history_prompt, ""),
      alternate_greetings: arrayOfStrings(raw.alternate_greetings),
      character_book: isPlainObject(raw.character_book) ? raw.character_book : null,
      tags: arrayOfStrings(raw.tags)
    }
  });
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeCharacterTavernPath(value: string): string {
  const withoutQuery =
    value
      .trim()
      .replace(/^https?:\/\/character-tavern\.com\/character\//, "")
      .split(/[?#]/)[0] ?? "";
  return withoutQuery
    .trim()
    .replace(/^\/+|\/+$/g, "");
}

function encodeCharacterTavernPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
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

async function translateFirstMes(
  card: FetchedCard,
  characterName: string,
  onDelta?: (text: string) => void
): Promise<string> {
  const original = typeof card.data?.first_mes === "string" ? card.data.first_mes.trim() : "";
  if (original.length === 0) return "";
  if (looksMostlyChinese(original)) return original;
  try {
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
      timeoutMs: 300_000,
      ...(onDelta !== undefined
        ? {
            onDelta: (event) => {
              if (event.text.trim().length > 0) onDelta(event.text);
            }
          }
        : {})
    });
    const translated = result.text.trim();
    return translated.length > 0 ? translated : original;
  } catch (error) {
    if (__DEV__) {
      console.warn(
        "[tavern-roleplay] first_mes translation failed; falling back to original:",
        error instanceof Error ? error.message : String(error)
      );
    }
    return original;
  }
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

  registerConversationMode({
    id: MINI_APP_ID,
    ownerMiniAppId: "tavern",
    displayName: "酒馆角色聊天",
    listGlyph: "🎭",
    defaultTitle: () => "酒馆角色",
    surface: { kind: "standard-chat" },
    openclaw: {
      defaultAgentId: "tavern-roleplay",
      requiredSkills: ["kokochat-tavern-roleplay"],
      requiredCoreTools: ["exec"],
      localSkillDirs: ["miniapps/tavern/openclaw/skills/kokochat-tavern-roleplay"]
    }
  });

  registerOutboundMessageBuilder(MINI_APP_ID, tavernRoleplayOutboundBuilder);
  registerSessionRestoreBuilder(MINI_APP_ID, tavernRoleplaySessionRestoreBuilder);
  registerRemoteSessionRestoreDecider(MINI_APP_ID, shouldRestoreTavernRoleplaySession);
  registerBootstrapRetryHandler(MINI_APP_ID, retryTavernRoleplayBootstrap);
}
