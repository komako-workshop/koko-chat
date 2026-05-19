/**
 * Gateway connection store for KokoChat.
 *
 * Owns the single OpenClaw WebSocket connection and routes inbound chat
 * events to the matching conversation's message buffer (see
 * useConversationStore). It does not own messages itself.
 *
 * The client listens once per connect and dispatches by `event.sessionKey`:
 * any conversation whose meta has that sessionKey receives the update.
 */

import { create } from "zustand";
import type { ConnectionStatus, JsonRecord } from "@koko/openclaw-client/protocol";
import { BrowserGatewayClient } from "@/gateway/BrowserGatewayClient";
import {
  loadDeviceToken,
  loadGatewayUrl,
  loadOrCreateDeviceSeed,
  saveDeviceToken,
  saveGatewayUrl,
  clearDeviceIdentity
} from "@/gateway/identityStorage";
import type { OpenClawSetup } from "@/gateway/setupCode";
import { buildOutboundMessage, isFirstUserTurn } from "@/runtime/outboundMessages";
import { getMiniAppDescriptor } from "@/runtime/miniApps";
import { parseMessageBoundaries } from "@/runtime/messageBoundary";
import {
  buildSessionRestoreMessage,
  hasRestorableLocalHistory,
  wrapGatewayTextWithSessionRestore
} from "@/runtime/sessionRestore";
import { useConversationStore, type ChatMessage, type ConversationMeta } from "@/state/conversations";

/** Minimal shape of an OpenClaw chat event payload as observed on the wire. */
export interface ChatEventPayload extends JsonRecord {
  sessionKey?: string;
  runId?: string;
  state?: "delta" | "final" | "error";
  message?: {
    content?: Array<{ type?: string; text?: string } | unknown>;
  };
  errorMessage?: string;
}

export type { ChatMessage };

const KOKO_STICKER_BLOCK_TYPE = "koko.sticker";
const REMOTE_SESSION_HISTORY_TIMEOUT_MS = 8_000;

interface GatewayState {
  client: BrowserGatewayClient | null;
  status: ConnectionStatus;
  setup: OpenClawSetup | null;
  lastError: string | null;

  connect: (setup: OpenClawSetup) => Promise<void>;
  reconnectIfPossible: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  forgetIdentity: () => Promise<void>;
  sendUserMessage: (conversationId: string, text: string) => Promise<void>;
  resetError: () => void;
}

let nextMessageId = 1;
function newMessageId(): string {
  return `msg-${Date.now()}-${nextMessageId++}`;
}

function extractText(event: ChatEventPayload): string {
  const blocks = event.message?.content;
  if (!Array.isArray(blocks)) {
    return "";
  }
  return blocks
    .filter(
      (b): b is { type: string; text: string } =>
        b !== null &&
        typeof b === "object" &&
        "type" in b &&
        (b as { type: unknown }).type === "text" &&
        "text" in b &&
        typeof (b as { text: unknown }).text === "string"
    )
    .map((b) => b.text)
    .join("");
}

/**
 * Look up a conversation id by the sessionKey carried on inbound events.
 * Returns null when we see traffic for a session we don't know — in that
 * case we silently drop the event rather than surface it in a random UI.
 */
function conversationIdForSessionKey(sessionKey: string | undefined): string | null {
  if (typeof sessionKey !== "string" || sessionKey.length === 0) return null;
  const list = useConversationStore.getState().list;
  const match = list.find((m) => m.sessionKey === sessionKey);
  return match?.id ?? null;
}

function shouldSplitAgentMessages(conversationId: string): boolean {
  const conv = useConversationStore.getState().list.find((m) => m.id === conversationId);
  if (conv === undefined) return false;
  return getMiniAppDescriptor(conv.mode)?.splitAgentMessages === true;
}

function applyDelta(
  conversationId: string,
  event: ChatEventPayload,
  done: boolean
): void {
  const fullText = extractText(event);
  const runId = typeof event.runId === "string" ? event.runId : null;

  // Claim any unclaimed streaming placeholder this conversation has.
  // sendUserMessage pre-inserts a blank streaming bubble so the
  // breathing-pulse animation appears the instant the user hits send,
  // instead of waiting for the gateway's first delta event. The first
  // delta with a runId "adopts" that placeholder by stamping its runId
  // on it, so the existing single-/multi-bubble update logic finds it.
  if (runId !== null) {
    claimPendingPlaceholder(conversationId, runId);
  }

  if (runId !== null && shouldSplitAgentMessages(conversationId)) {
    applyMultiBubbleDelta(conversationId, runId, fullText, done);
  } else {
    applySingleBubbleDelta(conversationId, event, done, fullText);
  }
}

function claimPendingPlaceholder(conversationId: string, runId: string): void {
  useConversationStore.getState().setMessages(conversationId, (prev) => {
    const idx = prev.findIndex(
      (m) =>
        m.role === "agent" &&
        m.streaming === true &&
        m.runId === undefined &&
        m.text.length === 0 &&
        (m.blocks === undefined || m.blocks.length === 0) &&
        m.error === undefined
    );
    if (idx < 0) return prev;
    // If there's already a message with this runId (e.g. a multi-delta
    // race), drop the placeholder rather than duplicating the row.
    const alreadyHasRun = prev.some((m) => m.runId === runId && m.role === "agent");
    const next = [...prev];
    if (alreadyHasRun) {
      next.splice(idx, 1);
    } else {
      const existing = next[idx];
      if (existing === undefined) return prev;
      next[idx] = { ...existing, runId };
    }
    return next;
  });
}

function applySingleBubbleDelta(
  conversationId: string,
  event: ChatEventPayload,
  done: boolean,
  fullText: string
): void {
  useConversationStore.getState().setMessages(conversationId, (prev) => {
    const idx = prev.findIndex((m) => m.runId === event.runId && m.role === "agent");
    if (idx < 0) {
      return [
        ...prev,
        {
          id: newMessageId(),
          role: "agent",
          text: fullText,
          ...(typeof event.runId === "string" ? { runId: event.runId } : {}),
          streaming: !done
        }
      ];
    }
    const existing = prev[idx];
    if (existing === undefined) return prev;
    const next = [...prev];
    next[idx] = { ...existing, text: fullText, streaming: !done };
    return next;
  });
  if (done) {
    useConversationStore
      .getState()
      .touch(conversationId, previewFromText(fullText));
  }
}

function applyMultiBubbleDelta(
  conversationId: string,
  runId: string,
  fullText: string,
  done: boolean
): void {
  const segments = parseMessageBoundaries(fullText, done);

  useConversationStore.getState().setMessages(conversationId, (prev) => {
    // Replace every message previously emitted under this runId. The parser
    // is deterministic on the full accumulated text, so re-deriving the
    // segments each delta keeps the view in lockstep with the model output
    // without needing diffing.
    const others = prev.filter((m) => m.runId !== runId);

    if (segments.length === 0) {
      // Nothing to render yet (empty initial delta). Insert nothing rather
      // than an empty placeholder bubble.
      return others;
    }

    const newMessages: ChatMessage[] = segments.map((seg) => {
      if (seg.kind === "sticker" && seg.stickerId !== undefined) {
        return {
          id: `${runId}-msg-${seg.index}`,
          role: "agent",
          text: "",
          runId,
          streaming: false,
          blocks: [
            {
              type: KOKO_STICKER_BLOCK_TYPE,
              version: 1,
              data: { id: seg.stickerId }
            }
          ]
        };
      }
      return {
        id: `${runId}-msg-${seg.index}`,
        role: "agent",
        text: seg.text,
        runId,
        streaming: !seg.complete
      };
    });

    return [...others, ...newMessages];
  });
  if (done) {
    // Use the last visible bubble for the list preview rather than the raw
    // accumulated text, so `<msg>` markup never leaks into the chat list.
    const lastSegment = segments[segments.length - 1];
    useConversationStore
      .getState()
      .touch(conversationId, previewFromSegment(lastSegment));
  }
}

function previewFromSegment(
  segment: ReturnType<typeof parseMessageBoundaries>[number] | undefined
): string | undefined {
  if (segment === undefined) return undefined;
  if (segment.kind === "sticker") return "Koko 表情";
  return previewFromText(segment.text);
}

function previewFromText(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, 120);
}

function applyError(conversationId: string, event: ChatEventPayload): void {
  useConversationStore.getState().setMessages(conversationId, (prev) => {
    const errorText = typeof event.errorMessage === "string" ? event.errorMessage : "unknown error";

    // Find the last agent message in this run, if any. Errors attach there
    // (works for both single-bubble and multi-bubble runs).
    let lastIdx = -1;
    for (let i = prev.length - 1; i >= 0; i -= 1) {
      const message = prev[i];
      if (message === undefined) continue;
      if (message.runId === event.runId && message.role === "agent") {
        lastIdx = i;
        break;
      }
    }

    if (lastIdx < 0) {
      return [
        ...prev,
        {
          id: newMessageId(),
          role: "agent",
          text: "",
          ...(typeof event.runId === "string" ? { runId: event.runId } : {}),
          streaming: false,
          error: errorText
        }
      ];
    }
    const existing = prev[lastIdx];
    if (existing === undefined) return prev;
    const next = [...prev];
    next[lastIdx] = { ...existing, streaming: false, error: errorText };
    return next;
  });
  useConversationStore.getState().touch(conversationId);
}

async function shouldRestoreRemoteSession({
  client,
  sessionKey,
  localMessages
}: {
  client: BrowserGatewayClient;
  sessionKey: string;
  localMessages: ChatMessage[];
}): Promise<boolean> {
  if (!hasRestorableLocalHistory(localMessages)) return false;

  try {
    const remoteMessages = await withTimeout(
      readRemoteSessionMessages(client, sessionKey),
      REMOTE_SESSION_HISTORY_TIMEOUT_MS
    );
    return remoteMessages.length === 0;
  } catch (error) {
    if (isMissingRemoteSessionError(error)) return true;
    if (__DEV__) {
      console.warn(
        "[koko] remote session history check failed; skipping restore:",
        error instanceof Error ? error.message : String(error)
      );
    }
    return false;
  }
}

async function buildBestEffortSessionRestoreMessage({
  conversationId,
  conversation,
  messages,
  currentGatewayText
}: {
  conversationId: string;
  conversation: ConversationMeta;
  messages: ChatMessage[];
  currentGatewayText: string;
}): Promise<string | null> {
  try {
    return await buildSessionRestoreMessage({
      conversation,
      messages,
      currentGatewayText
    });
  } catch (error) {
    if (__DEV__) {
      console.warn(
        `[koko] session restore prompt failed for ${conversationId}; sending without restore:`,
        error instanceof Error ? error.message : String(error)
      );
    }
    return null;
  }
}

async function readRemoteSessionMessages(
  client: BrowserGatewayClient,
  sessionKey: string
): Promise<JsonRecord[]> {
  const params = {
    sessionKey,
    limit: 1,
    maxChars: 1_024
  };
  let payload: JsonRecord;
  try {
    payload = await client.call("chat.history", params);
  } catch (error) {
    if (!isUnsupportedHistoryMaxCharsError(error)) throw error;
    payload = await client.call("chat.history", {
      sessionKey: params.sessionKey,
      limit: params.limit
    });
  }
  return Array.isArray(payload.messages)
    ? payload.messages.filter(isRecord)
    : [];
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`remote session history check timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUnsupportedHistoryMaxCharsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /maxChars/i.test(message) &&
    /(unexpected|unknown|unrecognized|unsupported|invalid)/i.test(message)
  );
}

function isMissingRemoteSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(session|history).*(missing|not found|not exist|unknown)|no such session/i.test(message);
}

export const useGatewayStore = create<GatewayState>((set, get) => ({
  client: null,
  status: "disconnected",
  setup: null,
  lastError: null,

  async connect(setup) {
    const existing = get().client;
    if (existing !== null) {
      await existing.disconnect();
    }

    const deviceSeed = loadOrCreateDeviceSeed();
    const setupDeviceToken = setup.deviceToken;
    const storedDeviceToken = setupDeviceToken ?? loadDeviceToken();

    const client = new BrowserGatewayClient({
      url: setup.url,
      ...(setup.token !== undefined ? { token: setup.token } : {}),
      ...(setup.bootstrapToken !== undefined ? { bootstrapToken: setup.bootstrapToken } : {}),
      ...(storedDeviceToken !== undefined ? { deviceToken: storedDeviceToken } : {}),
      deviceSeed,
      onStatusChange: (status: ConnectionStatus) => {
        set({ status });
      },
      onDeviceToken: (deviceToken: string) => {
        saveDeviceToken(deviceToken);
        console.info("[koko] gateway issued deviceToken", deviceToken.slice(0, 8), "... (persisted)");
      },
      logger: {
        trace: () => undefined,
        debug: (...args: unknown[]) => console.debug("[koko]", ...args),
        info: (...args: unknown[]) => console.info("[koko]", ...args),
        warn: (...args: unknown[]) => console.warn("[koko]", ...args),
        error: (...args: unknown[]) => console.error("[koko]", ...args)
      }
    });

    set({ client, setup, lastError: null });

    // Subscribe to chat events before connect so we don't miss the first delta.
    client.on("chat", (payload: JsonRecord) => {
      const event = payload as unknown as ChatEventPayload;
      const conversationId = conversationIdForSessionKey(event.sessionKey);
      if (conversationId === null) return;
      if (event.state === "delta") applyDelta(conversationId, event, false);
      else if (event.state === "final") applyDelta(conversationId, event, true);
      else if (event.state === "error") applyError(conversationId, event);
    });

    try {
      await client.connect();
      if (setupDeviceToken !== undefined) {
        saveDeviceToken(setupDeviceToken);
      }
      saveGatewayUrl(setup.url);
    } catch (error) {
      set({
        client: null,
        status: "disconnected",
        lastError: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  },

  async reconnectIfPossible() {
    const { status, setup } = get();
    if (status === "connected" || status === "connecting" || status === "handshaking") {
      return true;
    }

    const fallbackUrl = setup?.url ?? loadGatewayUrl();
    if (fallbackUrl === undefined) {
      return false;
    }

    const fallbackSetup: OpenClawSetup = setup ?? { url: fallbackUrl };
    try {
      await get().connect(fallbackSetup);
      return true;
    } catch {
      return false;
    }
  },

  async disconnect() {
    const client = get().client;
    if (client === null) return;
    await client.disconnect();
    set({ client: null, status: "disconnected", setup: null });
  },

  async forgetIdentity() {
    await get().disconnect();
    clearDeviceIdentity();
  },

  async sendUserMessage(conversationId, text) {
    const { client } = get();
    if (client === null) {
      throw new Error("not connected");
    }
    const meta = useConversationStore.getState().list.find((m) => m.id === conversationId);
    if (meta === undefined) {
      throw new Error(`unknown conversation: ${conversationId}`);
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) return;

    const messages = useConversationStore.getState().getMessages(conversationId);
    const outbound = await buildOutboundMessage({
      conversation: meta,
      visibleText: trimmed,
      isFirstUserTurn: isFirstUserTurn(messages)
    });
    const visibleText = outbound.visibleText.trim();
    const gatewayText = outbound.gatewayText.trim();
    if (visibleText.length === 0) return;

    useConversationStore.getState().setMessages(conversationId, (prev) => [
      ...prev,
      { id: newMessageId(), role: "user", text: visibleText }
    ]);
    useConversationStore.getState().touch(conversationId, visibleText.slice(0, 120));

    if (outbound.localOnly === true) return;
    if (gatewayText.length === 0) {
      throw new Error("outbound gatewayText is empty");
    }

    // Pre-insert a blank streaming placeholder so the chat surface can
    // render the breathing-pulse animation immediately. The first delta
    // event from the gateway will claim this row (see applyDelta).
    // Particularly noticeable for tavern-roleplay, where the first turn
    // carries a multi-KB card JSON prefix and the model can take 5-30
    // seconds before emitting the first token.
    const placeholderId = newMessageId();
    useConversationStore.getState().setMessages(conversationId, (prev) => [
      ...prev,
      { id: placeholderId, role: "agent", text: "", streaming: true }
    ]);

    const idempotencyKey = `koko-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      const needsRestore = await shouldRestoreRemoteSession({
        client,
        sessionKey: meta.sessionKey,
        localMessages: messages
      });
      const restoreMessage = needsRestore
        ? await buildBestEffortSessionRestoreMessage({
            conversationId,
            conversation: meta,
            messages,
            currentGatewayText: gatewayText
          })
        : null;
      const messageToSend = restoreMessage === null
        ? gatewayText
        : wrapGatewayTextWithSessionRestore(restoreMessage, gatewayText);
      await client.call("chat.send", {
        sessionKey: meta.sessionKey,
        message: messageToSend,
        idempotencyKey
      });
    } catch (error) {
      // If chat.send failed before any delta arrived, the placeholder is
      // still unclaimed (no runId). Surface the error on it so the user
      // gets feedback instead of a pulse that never stops.
      useConversationStore.getState().setMessages(conversationId, (prev) => {
        const idx = prev.findIndex(
          (m) => m.id === placeholderId && m.runId === undefined
        );
        if (idx < 0) return prev;
        const existing = prev[idx];
        if (existing === undefined) return prev;
        const next = [...prev];
        next[idx] = {
          ...existing,
          streaming: false,
          error: error instanceof Error ? error.message : String(error)
        };
        return next;
      });
      throw error;
    }
  },

  resetError() {
    set({ lastError: null });
  }
}));
