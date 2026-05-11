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
 *   - the in-memory messages cache per conversation
 *
 * It explicitly does NOT own:
 *   - the OpenClaw Gateway connection (see useGatewayStore)
 *   - the canonical transcript (OpenClaw Gateway owns that on disk)
 *   - any mini-app private state (see mini-app storage namespaces)
 *
 * The messages cache here is a UI cache, not the source of truth. On
 * reconnect or rehydrate we can start empty and still show new traffic;
 * later we can backfill from OpenClaw's transcript.
 */

import { create } from "zustand";

import { mmkv } from "@/storage/mmkv";

export const DEFAULT_AGENT_ID = "main";

/**
 * Internal union of mini-app ids recognized by the host. Using a finite
 * union (rather than plain `string`) lets TypeScript catch missing cases
 * in registries and switch statements while KokoChat does not yet support
 * third-party packages. When third-party distribution is introduced this
 * should widen to a registry-derived string.
 */
export type MiniAppId = "claw" | "example";

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

export interface ConversationMeta {
  id: string;
  mode: MiniAppId;
  title: string;
  sessionKey: string;
  createdAt: number;
  updatedAt: number;
  lastPreview?: string;
  archived?: boolean;
  /**
   * Conversation this one was spawned from, when applicable. Parallel
   * siblings, not parent-child UI.
   */
  parentConversationId?: string;
  /** Optional pointer to the artifact this conversation is "about". */
  artifactRef?: ArtifactRef;
  /** Denormalized data for fast list rendering. */
  listSnapshot?: ConversationListSnapshot;
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
  /** Per-conversation in-memory message cache. */
  messages: Record<string, ChatMessage[]>;

  rehydrate(): void;
  create(input?: CreateConversationInput): ConversationMeta;
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

/**
 * Inputs accepted by `create()`. All fields are optional; the host will
 * fill sensible defaults (mode defaults to `claw`, scope to the new
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
  agentId: string = DEFAULT_AGENT_ID
): string {
  return `agent:${agentId}:kokochat:${mode}:${scope}`.toLowerCase();
}

function defaultTitleFor(mode: MiniAppId, createdAt: number): string {
  const d = new Date(createdAt);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  // Mini-apps are free to rename their conversations immediately after
  // create() returns; this default is only meant to avoid blank rows.
  switch (mode) {
    case "example":
      return `Example ${hh}:${mm}`;
    case "claw":
    default:
      return `Chat ${hh}:${mm}`;
  }
}

/** Known mini-app ids, used when validating data loaded from disk. */
const KNOWN_MINI_APP_IDS: readonly MiniAppId[] = ["claw", "example"];

function isMiniAppId(value: unknown): value is MiniAppId {
  return typeof value === "string" && (KNOWN_MINI_APP_IDS as readonly string[]).includes(value);
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
    // Legacy records created before the MiniAppId union widened may have
    // stored modes that no longer exist; fall back to `claw` so the row
    // is still usable rather than dropping it on the floor.
    const mode: MiniAppId = isMiniAppId(parsed.mode) ? parsed.mode : "claw";
    return { ...(parsed as ConversationMeta), mode };
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
    const title =
      input?.title !== undefined && input.title.length > 0
        ? input.title
        : defaultTitleFor(mode, createdAt);
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
      ...(input?.listSnapshot !== undefined ? { listSnapshot: input.listSnapshot } : {})
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
