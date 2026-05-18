/**
 * Conversation registry for KokoChat.
 *
 * A conversation is a user-facing chat thread. Each conversation maps to
 * exactly one OpenClaw session via a deterministic key:
 *
 *   agent:<agentId>:kokochat:<miniAppId>:<conversationScope>
 *
 * `<miniAppId>` selects which mini-app family owns the conversation.
 * `<conversationScope>` is usually the conversation id itself, but a
 * mini-app is allowed to widen it when the same OpenClaw session should be
 * shared across multiple conversations belonging to the same artifact.
 *
 * This store owns:
 *   - conversation metadata (id, title, sessionKey, mode, timestamps)
 *   - a small denormalized snapshot used to render list rows without
 *     waiting for any mini-app storage to hydrate
 *   - an artifact ref pointing at mini-app-owned data. The store never
 *     reads inside that ref; it only carries the pointer.
 *   - the active conversation selection
 *   - the local message history per conversation
 *
 * It explicitly does NOT own:
 *   - the OpenClaw Gateway connection (see useGatewayStore)
 *   - any mini-app private state (see mini-app storage namespaces)
 *
 * Message history is stored locally so chats feel like a normal mobile app:
 * reopen KokoChat and the recent conversation is still there. OpenClaw may
 * also have its own transcript on disk, but the app should not require a
 * Gateway round-trip just to draw a thread.
 */

import { create } from "zustand";

import {
  getDefaultConversationTitle,
  resolveMiniAppAgentId,
  warnUnknownMiniAppId
} from "@/runtime/miniApps";
import { mmkv } from "@/storage/mmkv";

export const DEFAULT_AGENT_ID = "main";

/** Conversation mode / mini-app id. Runtime validation lives in the mini-app registry. */
export type MiniAppId = string;

/**
 * Pointer from a conversation to a piece of data owned by a mini-app.
 * The host never interprets `type` or `id`; it only carries the ref so
 * the owning mini-app can resolve its own record.
 *
 * Ownership rule (MVP): the mini-app named by `miniAppId` is the sole
 * writer of this artifact. Other mini-apps may only read through
 * owner-exposed actions.
 */
export interface ArtifactRef {
  /** Namespaced artifact type, e.g. "koko.example.note". */
  type: string;
  /** Mini-app-owned stable id of the artifact. */
  id: string;
  /** Mini-app that owns writes for this artifact. */
  miniAppId: MiniAppId;
}

/**
 * Minimum data needed to draw a conversation list row before any
 * mini-app storage has hydrated. Written at conversation-create time and
 * refreshed only on a small number of owner-driven events (rename,
 * avatar change). List rendering must not block on mini-app storage.
 */
export interface ConversationListSnapshot {
  title: string;
  subtitle?: string;
  /** Name of an icon to render when no avatar is available. Host-defined. */
  icon?: string;
  /** Remote or local avatar URI (mini-app storage is the source of truth). */
  avatarUri?: string;
}

export type ConversationBootstrapStatus = "loading" | "ready" | "error";

/**
 * Lightweight per-conversation bootstrap state. Mini-apps set this when a
 * conversation needs background work to finish before the user can chat
 * (e.g. tavern-roleplay fetching a Character Tavern card + translating
 * the opening line). The chat surface reads it to show a status banner
 * and disable input while the work is in flight.
 */
export interface ConversationBootstrap {
  status: ConversationBootstrapStatus;
  /** Friendly Chinese hint shown while loading. */
  hint?: string;
  /** Human-readable error string when status === "error". */
  error?: string;
}

export interface ConversationMeta {
  id: string;
  mode: MiniAppId;
  title: string;
  sessionKey: string;
  createdAt: number;
  updatedAt: number;
  lastPreview?: string;
  archived?: boolean;
  /** Sticky-to-top flag. Pinned rows sort above all unpinned rows. */
  pinned?: boolean;
  /**
   * Timestamp the user pinned this conversation. Used to order multiple
   * pinned rows (most recently pinned shows first).
   */
  pinnedAt?: number;
  /**
   * Conversation this one was spawned from, when applicable. Parallel
   * siblings, not parent-child UI.
   */
  parentConversationId?: string;
  /** Optional pointer to the artifact this conversation is "about". */
  artifactRef?: ArtifactRef;
  /** Denormalized data for fast list rendering. */
  listSnapshot?: ConversationListSnapshot;
  /** Bootstrapping state, when a mini-app needs to finish async setup. */
  bootstrap?: ConversationBootstrap;
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  /** Structured render payloads. Plain text remains the compatibility path. */
  blocks?: MessageBlock[];
  runId?: string;
  streaming?: boolean;
  error?: string;
}

export interface MessageBlock<TData = unknown> {
  /** Globally namespaced block type, e.g. "koko.example.card". */
  type: string;
  /** Block schema version for renderer-side compatibility decisions. */
  version: number;
  /** Mini-app-defined payload. Must be validated before executing actions. */
  data: TData;
}

interface ConversationState {
  /** Stable list of known conversations, newest first. */
  list: ConversationMeta[];
  /** Currently open conversation id, or null for the thread list. */
  activeId: string | null;
  /** Per-conversation local message history, hydrated from storage. */
  messages: Record<string, ChatMessage[]>;

  rehydrate(): void;
  create(input?: CreateConversationInput): ConversationMeta;
  select(conversationId: string): void;
  clearActive(): void;
  rename(conversationId: string, title: string): void;
  archive(conversationId: string): void;
  togglePin(conversationId: string, pinned?: boolean): void;
  getMessages(conversationId: string): ChatMessage[];
  setMessages(
    conversationId: string,
    updater: (prev: ChatMessage[]) => ChatMessage[]
  ): void;
  touch(conversationId: string, preview?: string): void;
  /**
   * Set or clear the bootstrap state for a conversation. Pass `null` to
   * remove the field entirely (treats the conversation as "no bootstrap
   * needed"). Updates persist to MMKV so a reload can see the state.
   */
  setBootstrap(
    conversationId: string,
    bootstrap: ConversationBootstrap | null
  ): void;
}

/**
 * Inputs accepted by `create()`. All fields are optional; the host will
 * fill sensible defaults (mode defaults to `koko`, scope to the new
 * conversation id, title to a timestamp-based placeholder).
 *
 * `sessionScope` widens the OpenClaw session namespace beyond a single
 * conversation id. For the common case (one conversation = one session)
 * callers leave this undefined. Mini-apps that need several conversations
 * to share a session pass something stable like
 * `<artifactType>:<artifactId>:<conversationId>`.
 */
export interface CreateConversationInput {
  mode?: MiniAppId;
  title?: string;
  sessionScope?: string;
  parentConversationId?: string;
  artifactRef?: ArtifactRef;
  listSnapshot?: ConversationListSnapshot;
  bootstrap?: ConversationBootstrap;
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
 * Build the OpenClaw sessionKey for a conversation. The `scope` is the
 * mini-app's chosen namespace inside the mode bucket; passing the
 * conversation id is the safe default. See `CreateConversationInput`
 * for when widening the scope makes sense.
 */
export function buildSessionKey(
  mode: MiniAppId,
  scope: string,
  agentId?: string
): string {
  return `agent:${resolveMiniAppAgentId(mode, agentId)}:kokochat:${mode}:${scope}`.toLowerCase();
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
    const parsed = JSON.parse(raw) as Partial<ConversationMeta> & Record<string, unknown>;
    if (typeof parsed !== "object" || parsed === null) return null;
    if (typeof parsed.id !== "string" || typeof parsed.sessionKey !== "string") {
      return null;
    }
    if (parsed.mode === "claw") return null;
    const mode: MiniAppId = typeof parsed.mode === "string" && parsed.mode.length > 0 ? parsed.mode : "koko";
    warnUnknownMiniAppId(mode);
    return { ...(parsed as ConversationMeta), mode };
  } catch {
    return null;
  }
}

function writeMeta(meta: ConversationMeta): void {
  mmkv.set(`${CONVERSATION_PREFIX}${meta.id}`, JSON.stringify(meta));
}

function readMessages(conversationId: string): ChatMessage[] {
  const raw = mmkv.getString(`${MESSAGES_PREFIX}${conversationId}`);
  if (raw === undefined || raw.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const message = normalizeMessage(item);
      return message === null ? [] : [message];
    });
  } catch {
    return [];
  }
}

function writeMessages(conversationId: string, messages: ChatMessage[]): void {
  mmkv.set(`${MESSAGES_PREFIX}${conversationId}`, JSON.stringify(messages));
}

function deleteMeta(conversationId: string): void {
  mmkv.delete(`${CONVERSATION_PREFIX}${conversationId}`);
  mmkv.delete(`${MESSAGES_PREFIX}${conversationId}`);
}

/**
 * Sort order for the chat list:
 *   1. Pinned conversations first (most recently pinned on top).
 *   2. Then unpinned conversations by most recent activity.
 */
function compareConversationsForList(a: ConversationMeta, b: ConversationMeta): number {
  const aPinned = a.pinned === true;
  const bPinned = b.pinned === true;
  if (aPinned !== bPinned) return aPinned ? -1 : 1;
  if (aPinned && bPinned) {
    const aPinnedAt = a.pinnedAt ?? 0;
    const bPinnedAt = b.pinnedAt ?? 0;
    if (aPinnedAt !== bPinnedAt) return bPinnedAt - aPinnedAt;
  }
  return b.updatedAt - a.updatedAt;
}

function normalizeMessage(value: unknown): ChatMessage | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string") return null;
  if (value.role !== "user" && value.role !== "agent") return null;
  if (typeof value.text !== "string") return null;

  const out: ChatMessage = {
    id: value.id,
    role: value.role,
    text: value.text
  };

  const blocks = normalizeMessageBlocks(value.blocks);
  if (blocks !== undefined) out.blocks = blocks;
  if (typeof value.runId === "string") out.runId = value.runId;
  if (typeof value.error === "string") out.error = value.error;

  // A persisted "streaming" state means the app was killed mid-run. Render it
  // as a settled partial message on next launch instead of showing a cursor
  // forever.
  if (value.streaming === true && value.error !== undefined) {
    out.streaming = false;
  }

  return out;
}

function normalizeMessageBlocks(value: unknown): MessageBlock[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const blocks: MessageBlock[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    if (typeof item.type !== "string") continue;
    if (typeof item.version !== "number") continue;
    blocks.push({
      type: item.type,
      version: item.version,
      data: item.data
    });
  }
  return blocks.length > 0 ? blocks : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  list: [],
  activeId: null,
  messages: {},

  rehydrate() {
    const ids = readIndex();
    const metas: ConversationMeta[] = [];
    const messages: Record<string, ChatMessage[]> = {};
    for (const id of ids) {
      const meta = readMeta(id);
      if (meta !== null && meta.archived !== true) {
        // Any conversation that was mid-bootstrap when the app died last
        // session can't finish on its own — flip it to "error" so the chat
        // UI shows a recoverable banner instead of an infinite spinner.
        if (meta.bootstrap?.status === "loading") {
          const swept: ConversationMeta = {
            ...meta,
            bootstrap: {
              status: "error",
              error: "加载未完成，请重新打开角色卡。"
            },
            updatedAt: now()
          };
          writeMeta(swept);
          metas.push(swept);
        } else {
          metas.push(meta);
        }
        messages[id] = readMessages(id);
      }
    }
    metas.sort(compareConversationsForList);
    set({ list: metas, messages });
  },

  create(input) {
    const mode: MiniAppId = input?.mode ?? "koko";
    const id = uuid();
    const createdAt = now();
    const title =
      input?.title !== undefined && input.title.length > 0
        ? input.title
        : getDefaultConversationTitle(mode, createdAt);
    const scope = input?.sessionScope ?? id;
    const meta: ConversationMeta = {
      id,
      mode,
      title,
      sessionKey: buildSessionKey(mode, scope),
      createdAt,
      updatedAt: createdAt,
      ...(input?.parentConversationId !== undefined
        ? { parentConversationId: input.parentConversationId }
        : {}),
      ...(input?.artifactRef !== undefined ? { artifactRef: input.artifactRef } : {}),
      ...(input?.listSnapshot !== undefined ? { listSnapshot: input.listSnapshot } : {}),
      ...(input?.bootstrap !== undefined ? { bootstrap: input.bootstrap } : {})
    };
    writeMeta(meta);
    writeMessages(id, []);
    const ids = [id, ...readIndex().filter((existing) => existing !== id)];
    writeIndex(ids);
    set((state) => ({
      list: [meta, ...state.list.filter((m) => m.id !== id)].sort(compareConversationsForList),
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
    const updated: ConversationMeta = {
      ...existing,
      title: next,
      updatedAt: now(),
      // Keep the list snapshot in sync when present, otherwise the list
      // row would keep showing the stale artifact-provided title.
      ...(existing.listSnapshot !== undefined
        ? { listSnapshot: { ...existing.listSnapshot, title: next } }
        : {})
    };
    writeMeta(updated);
    set((state) => ({
      list: [updated, ...state.list.filter((m) => m.id !== conversationId)].sort(compareConversationsForList)
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

  togglePin(conversationId, pinned) {
    const existing = get().list.find((m) => m.id === conversationId);
    if (existing === undefined) return;
    const nextPinned = pinned ?? existing.pinned !== true;
    if (nextPinned === (existing.pinned === true)) return;
    const updated: ConversationMeta = nextPinned
      ? { ...existing, pinned: true, pinnedAt: now() }
      : (() => {
          // Drop the timestamp when unpinning so re-pinning later starts a
          // fresh "recently pinned" entry.
          const { pinned: _pinned, pinnedAt: _pinnedAt, ...rest } = existing;
          void _pinned;
          void _pinnedAt;
          return { ...rest };
        })();
    writeMeta(updated);
    set((state) => ({
      list: state.list
        .map((m) => (m.id === conversationId ? updated : m))
        .sort(compareConversationsForList)
    }));
  },

  getMessages(conversationId) {
    const cached = get().messages[conversationId];
    if (cached !== undefined) return cached;
    return readMessages(conversationId);
  },

  setMessages(conversationId, updater) {
    const prev = get().messages[conversationId] ?? [];
    const next = updater(prev);
    if (next === prev) return;
    writeMessages(conversationId, next);
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
      list: [updated, ...state.list.filter((m) => m.id !== conversationId)].sort(compareConversationsForList)
    }));
  },

  setBootstrap(conversationId, bootstrap) {
    const existing = get().list.find((m) => m.id === conversationId);
    if (existing === undefined) return;
    // Strip the existing bootstrap field; either add the new one or drop it.
    const { bootstrap: _omit, ...rest } = existing;
    const updated: ConversationMeta =
      bootstrap === null
        ? { ...rest, updatedAt: now() }
        : { ...rest, bootstrap, updatedAt: now() };
    writeMeta(updated);
    set((state) => ({
      list: state.list.map((m) => (m.id === conversationId ? updated : m))
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
  readMessages,
  writeMessages,
  deleteMeta,
  INDEX_KEY,
  CONVERSATION_PREFIX,
  MESSAGES_PREFIX
};
