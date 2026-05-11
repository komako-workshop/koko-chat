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
  loadOrCreateDeviceSeed,
  saveDeviceToken,
  saveGatewayUrl,
  clearDeviceIdentity
} from "@/gateway/identityStorage";
import type { OpenClawSetup } from "@/gateway/setupCode";
import { buildOutboundMessage, isFirstUserTurn } from "@/runtime/outboundMessages";
import { useConversationStore, type ChatMessage } from "@/state/conversations";

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

interface GatewayState {
  client: BrowserGatewayClient | null;
  status: ConnectionStatus;
  setup: OpenClawSetup | null;
  lastError: string | null;

  connect: (setup: OpenClawSetup) => Promise<void>;
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

function applyDelta(
  conversationId: string,
  event: ChatEventPayload,
  done: boolean
): void {
  const text = extractText(event);
  useConversationStore.getState().setMessages(conversationId, (prev) => {
    const idx = prev.findIndex((m) => m.runId === event.runId && m.role === "agent");
    if (idx < 0) {
      return [
        ...prev,
        {
          id: newMessageId(),
          role: "agent",
          text,
          ...(typeof event.runId === "string" ? { runId: event.runId } : {}),
          streaming: !done
        }
      ];
    }
    const existing = prev[idx];
    if (existing === undefined) return prev;
    const next = [...prev];
    next[idx] = { ...existing, text, streaming: !done };
    return next;
  });
  if (done) {
    useConversationStore
      .getState()
      .touch(conversationId, text.length > 0 ? text.slice(0, 120) : undefined);
  }
}

function applyError(conversationId: string, event: ChatEventPayload): void {
  useConversationStore.getState().setMessages(conversationId, (prev) => {
    const idx = prev.findIndex((m) => m.runId === event.runId && m.role === "agent");
    const errorText = typeof event.errorMessage === "string" ? event.errorMessage : "unknown error";
    if (idx < 0) {
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
    const existing = prev[idx];
    if (existing === undefined) return prev;
    const next = [...prev];
    next[idx] = { ...existing, streaming: false, error: errorText };
    return next;
  });
  useConversationStore.getState().touch(conversationId);
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
    const storedDeviceToken = loadDeviceToken();

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

    const idempotencyKey = `koko-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await client.call("chat.send", {
      sessionKey: meta.sessionKey,
      message: gatewayText,
      idempotencyKey
    });
  },

  resetError() {
    set({ lastError: null });
  }
}));
