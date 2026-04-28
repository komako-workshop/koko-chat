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

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  runId?: string;
  streaming?: boolean;
  error?: string;
}

interface GatewayState {
  client: BrowserGatewayClient | null;
  status: ConnectionStatus;
  setup: OpenClawSetup | null;
  lastError: string | null;
  messages: ChatMessage[];
  sessionKey: string;

  connect: (setup: OpenClawSetup) => Promise<void>;
  disconnect: () => Promise<void>;
  forgetIdentity: () => Promise<void>;
  sendUserMessage: (text: string) => Promise<void>;
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
    .filter((b): b is { type: string; text: string } =>
      b !== null && typeof b === "object" && "type" in b && (b as { type: unknown }).type === "text" &&
      "text" in b && typeof (b as { text: unknown }).text === "string"
    )
    .map((b) => b.text)
    .join("");
}

export const useGatewayStore = create<GatewayState>((set, get) => ({
  client: null,
  status: "disconnected",
  setup: null,
  lastError: null,
  messages: [],
  // OpenClaw's main session key. Users running `openclaw` normally have this
  // session already.
  sessionKey: "agent:main:main",

  async connect(setup) {
    const existing = get().client;
    if (existing !== null) {
      await existing.disconnect();
    }

    const deviceSeed = loadOrCreateDeviceSeed();
    const storedDeviceToken = loadDeviceToken();

    const client = new BrowserGatewayClient({
      url: setup.url,
      token: setup.bootstrapToken,
      ...(storedDeviceToken !== undefined ? { deviceToken: storedDeviceToken } : {}),
      deviceSeed,
      onStatusChange: (status: ConnectionStatus) => {
        set({ status });
      },
      onDeviceToken: (deviceToken: string) => {
        // Persist so subsequent sessions skip pairing approval entirely.
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

    set({ client, setup, lastError: null, messages: [] });

    // Subscribe to chat events before connect so we don't miss the first delta.
    client.on("chat", (payload: JsonRecord) => {
      const event = payload as unknown as ChatEventPayload;
      if (event.sessionKey !== get().sessionKey) {
        return;
      }
      if (event.state === "delta" || event.state === "final") {
        const text = extractText(event);
        set((state) => {
          const idx = state.messages.findIndex(
            (m) => m.runId === event.runId && m.role === "agent"
          );
          if (idx < 0) {
            return {
              messages: [
                ...state.messages,
                {
                  id: newMessageId(),
                  role: "agent",
                  text,
                  ...(typeof event.runId === "string" ? { runId: event.runId } : {}),
                  streaming: event.state === "delta"
                }
              ]
            };
          }
          const updated = [...state.messages];
          const existingMsg = updated[idx];
          if (existingMsg === undefined) {
            return { messages: state.messages };
          }
          updated[idx] = {
            ...existingMsg,
            text,
            streaming: event.state === "delta"
          };
          return { messages: updated };
        });
      } else if (event.state === "error") {
        set((state) => {
          const idx = state.messages.findIndex(
            (m) => m.runId === event.runId && m.role === "agent"
          );
          if (idx < 0) {
            return {
              messages: [
                ...state.messages,
                {
                  id: newMessageId(),
                  role: "agent",
                  text: "",
                  ...(typeof event.runId === "string" ? { runId: event.runId } : {}),
                  streaming: false,
                  ...(typeof event.errorMessage === "string" ? { error: event.errorMessage } : { error: "unknown error" })
                }
              ]
            };
          }
          const updated = [...state.messages];
          const existingMsg = updated[idx];
          if (existingMsg === undefined) {
            return { messages: state.messages };
          }
          updated[idx] = {
            ...existingMsg,
            streaming: false,
            ...(typeof event.errorMessage === "string" ? { error: event.errorMessage } : { error: "unknown error" })
          };
          return { messages: updated };
        });
      }
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
    if (client === null) {
      return;
    }
    await client.disconnect();
    set({ client: null, status: "disconnected", messages: [], setup: null });
  },

  async forgetIdentity() {
    await get().disconnect();
    clearDeviceIdentity();
  },

  async sendUserMessage(text) {
    const { client, sessionKey } = get();
    if (client === null) {
      throw new Error("not connected");
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return;
    }
    set((state) => ({
      messages: [
        ...state.messages,
        { id: newMessageId(), role: "user", text: trimmed }
      ]
    }));

    const idempotencyKey = `koko-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await client.call("chat.send", {
      sessionKey,
      message: trimmed,
      idempotencyKey
    });
  },

  resetError() {
    set({ lastError: null });
  }
}));
