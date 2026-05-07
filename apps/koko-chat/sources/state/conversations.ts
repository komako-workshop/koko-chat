/**
 * Conversation registry for KokoChat.
 *
 * A conversation is a user-facing chat thread. Each conversation maps to
 * exactly one OpenClaw session via a deterministic key:
 *
 *   agent:<agentId>:kokochat:<miniAppId>:<conversationScope>
 *
 * For Milestone 0.5 there is only one mini-app mode (`claw`), and the
 * scope is the conversation id itself. Feed / Book Tutor will be added
 * later as additional mini-app ids; this store already allows them.
 *
 * This store owns:
 *   - conversation metadata (id, title, sessionKey, mode, timestamps)
 *   - the active conversation selection
 *   - the in-memory messages cache per conversation
 *
 * It explicitly does NOT own:
 *   - the OpenClaw Gateway connection (see useGatewayStore)
 *   - the canonical transcript (OpenClaw Gateway owns that on disk)
 *
 * The messages cache here is a UI cache, not the source of truth. On
 * reconnect or rehydrate we can start empty and still show new traffic;
 * later we can backfill from OpenClaw's transcript.
 */

import { create } from "zustand";

import { mmkv } from "@/storage/mmkv";

export const DEFAULT_AGENT_ID = "main";
export type MiniAppId = "claw";

export interface ConversationMeta {
  id: string;
  mode: MiniAppId;
  title: string;
  sessionKey: string;
  createdAt: number;
  updatedAt: number;
  lastPreview?: string;
  archived?: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  runId?: string;
  streaming?: boolean;
  error?: string;
}

interface ConversationState {
  /** Stable list of known conversations, newest first. */
  list: ConversationMeta[];
  /** Currently open conversation id, or null for the thread list. */
  activeId: string | null;
  /** Per-conversation in-memory message cache. */
  messages: Record<string, ChatMessage[]>;

  rehydrate(): void;
  create(input?: { mode?: MiniAppId; title?: string }): ConversationMeta;
  select(conversationId: string): void;
  clearActive(): void;
  rename(conversationId: string, title: string): void;
  archive(conversationId: string): void;
  getMessages(conversationId: string): ChatMessage[];
  setMessages(
    conversationId: string,
    updater: (prev: ChatMessage[]) => ChatMessage[]
  ): void;
  touch(conversationId: string, preview?: string): void;
}

const INDEX_KEY = "koko.conversations.index.v1";
const CONVERSATION_PREFIX = "koko.conversation.v1.";
const MESSAGES_PREFIX = "koko.conversation.messages.v1.";

function now(): number {
  return Date.now();
}

function uuid(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID().toLowerCase();
  }
  // Fallback for runtimes that only have getRandomValues (RN Hermes).
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  // RFC 4122 v4
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join("")
  ].join("-");
}

/**
 * Build the OpenClaw sessionKey for a new conversation, following the
 * product contract documented in docs/mini-app-runtime.md.
 */
export function buildSessionKey(
  mode: MiniAppId,
  conversationId: string,
  agentId: string = DEFAULT_AGENT_ID
): string {
  return `agent:${agentId}:kokochat:${mode}:${conversationId}`.toLowerCase();
}

function defaultTitleFor(mode: MiniAppId, createdAt: number): string {
  const d = new Date(createdAt);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  switch (mode) {
    case "claw":
    default:
      return `Chat ${hh}:${mm}`;
  }
}

function readIndex(): string[] {
  const raw = mmkv.getString(INDEX_KEY);
  if (raw === undefined || raw.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

function writeIndex(ids: string[]): void {
  mmkv.set(INDEX_KEY, JSON.stringify(ids));
}

function readMeta(conversationId: string): ConversationMeta | null {
  const raw = mmkv.getString(`${CONVERSATION_PREFIX}${conversationId}`);
  if (raw === undefined || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(raw) as ConversationMeta;
    if (typeof parsed !== "object" || parsed === null) return null;
    if (typeof parsed.id !== "string" || typeof parsed.sessionKey !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeMeta(meta: ConversationMeta): void {
  mmkv.set(`${CONVERSATION_PREFIX}${meta.id}`, JSON.stringify(meta));
}

function deleteMeta(conversationId: string): void {
  mmkv.delete(`${CONVERSATION_PREFIX}${conversationId}`);
  mmkv.delete(`${MESSAGES_PREFIX}${conversationId}`);
}

function compareByUpdatedDesc(a: ConversationMeta, b: ConversationMeta): number {
  return b.updatedAt - a.updatedAt;
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  list: [],
  activeId: null,
  messages: {},

  rehydrate() {
    const ids = readIndex();
    const metas: ConversationMeta[] = [];
    for (const id of ids) {
      const meta = readMeta(id);
      if (meta !== null && meta.archived !== true) {
        metas.push(meta);
      }
    }
    metas.sort(compareByUpdatedDesc);
    set({ list: metas });
  },

  create(input) {
    const mode: MiniAppId = input?.mode ?? "claw";
    const id = uuid();
    const createdAt = now();
    const meta: ConversationMeta = {
      id,
      mode,
      title: input?.title !== undefined && input.title.length > 0 ? input.title : defaultTitleFor(mode, createdAt),
      sessionKey: buildSessionKey(mode, id),
      createdAt,
      updatedAt: createdAt
    };
    writeMeta(meta);
    const ids = [id, ...readIndex().filter((existing) => existing !== id)];
    writeIndex(ids);
    set((state) => ({
      list: [meta, ...state.list.filter((m) => m.id !== id)],
      activeId: id,
      messages: { ...state.messages, [id]: [] }
    }));
    return meta;
  },

  select(conversationId) {
    const meta = get().list.find((m) => m.id === conversationId);
    if (meta === undefined) return;
    set({ activeId: conversationId });
  },

  clearActive() {
    set({ activeId: null });
  },

  rename(conversationId, title) {
    const next = title.trim();
    if (next.length === 0) return;
    const existing = get().list.find((m) => m.id === conversationId);
    if (existing === undefined) return;
    const updated: ConversationMeta = { ...existing, title: next, updatedAt: now() };
    writeMeta(updated);
    set((state) => ({
      list: [updated, ...state.list.filter((m) => m.id !== conversationId)].sort(compareByUpdatedDesc)
    }));
  },

  archive(conversationId) {
    const existing = get().list.find((m) => m.id === conversationId);
    if (existing === undefined) return;
    const updated: ConversationMeta = { ...existing, archived: true, updatedAt: now() };
    writeMeta(updated);
    // For MVP we simply drop archived conversations from the visible list.
    // We do not delete the underlying OpenClaw transcript or the stored meta.
    set((state) => {
      const nextList = state.list.filter((m) => m.id !== conversationId);
      const nextActive = state.activeId === conversationId ? null : state.activeId;
      const nextMessages = { ...state.messages };
      delete nextMessages[conversationId];
      return { list: nextList, activeId: nextActive, messages: nextMessages };
    });
    // Intentionally do not call deleteMeta here — archived meta stays on disk
    // so a future "restore archived" feature can bring it back. Physical
    // deletion would be a separate explicit action.
  },

  getMessages(conversationId) {
    return get().messages[conversationId] ?? [];
  },

  setMessages(conversationId, updater) {
    const prev = get().messages[conversationId] ?? [];
    const next = updater(prev);
    if (next === prev) return;
    set((state) => ({
      messages: { ...state.messages, [conversationId]: next }
    }));
  },

  touch(conversationId, preview) {
    const existing = get().list.find((m) => m.id === conversationId);
    if (existing === undefined) return;
    const updated: ConversationMeta = {
      ...existing,
      updatedAt: now(),
      ...(preview !== undefined ? { lastPreview: preview } : {})
    };
    writeMeta(updated);
    set((state) => ({
      list: [updated, ...state.list.filter((m) => m.id !== conversationId)].sort(compareByUpdatedDesc)
    }));
  }
}));

// Re-export symbols useful for consumers that don't want to touch the store
// directly (for example, a future tool that builds session keys outside the
// store in a pure way).
export const __internal = {
  readIndex,
  writeIndex,
  readMeta,
  writeMeta,
  deleteMeta,
  INDEX_KEY,
  CONVERSATION_PREFIX,
  MESSAGES_PREFIX
};
