# KokoChat Mini-App Runtime Design

> Draft date: 2026-05-07
> Status: design draft, not an implementation contract yet

KokoChat should not compete in the "better OpenClaw client" category.
The product direction is a mobile-first mini-app runtime where each mini-app is
composed of:

- OpenClaw agent capability
- skill behavior
- native GUI surfaces
- local context and storage
- optional CLI / worker logic

OpenClaw is the agent and capability provider. KokoChat is the host app and
runtime for skill + GUI mini-apps.

## Product Model

The basic KokoChat app supports:

- connecting to the user's local OpenClaw Gateway
- creating multiple conversations
- sending and receiving streamed messages
- persisting conversation history locally

After this base is stable, the "new conversation" action becomes the entry to
typed conversations.

When the user taps the plus button, KokoChat opens a creation menu:

```text
 New
  - Claw
  - Feed
  - Book Tutor
```

These are not separate apps in the first version. They are different
conversation modes inside the same app.

```ts
// Modeled as a string at the type level, validated against a runtime registry.
// String + registry is preferred over a string union because adding mini-apps,
// versions, or experimental modes should not require changing the type.
type ConversationMode = string; // validated against MiniAppRegistry at runtime
```

The important design decision:

> A mini-app is a typed conversation with its own skill, GUI extensions, local
> context, and optional worker logic.

Claw, Feed, and Book Tutor are all first-class mini-apps. They sit at the same
level in the new-conversation menu. Claw is the baseline conversation mode for
users who want a plain chat. Feed and Book Tutor are stateful workflows that
extend the shared shell with their own surfaces, cards, and storage. Claw is
not a developer-only mode.

## First Modes

### Claw

Plain OpenClaw chat. This is the baseline conversation mode exposed to users,
not a debug-only fallback.

Responsibilities:

- create or attach to an OpenClaw session
- render the shared message stream with the shared chat shell
- expose the baseline KokoChat chat UX without mini-app specific surfaces

Claw is a first-class mini-app. It happens to need no `MiniAppSurface` beyond
the shared shell, but it still owns its own `sessionKey` namespace and storage
namespace (see Session Key Convention and Storage Boundaries). Keeping Claw at
the same level as Feed and Book Tutor avoids mode-selection ambiguity and
guarantees plain chat never collides with stateful mini-apps.

### Feed

A recommendation mini-app that learns from a local interest context and keeps
suggesting articles, videos, and other material the user may like.

Core behavior:

- maintain an independent local interest context
- recommend content in the conversation as native cards
- allow save, hide, open, and mark-not-interested actions
- keep a fixed entry for saved items and recommendation history
- use OpenClaw capabilities for search, fetch, summarization, and ranking

This validates the full mini-app shape:

- skill: recommendation behavior and output protocol
- GUI: recommendation cards and saved-items views
- store: interests, saved items, dismissed items, recommendation history
- worker: refresh recommendations, fetch metadata, summarize links

#### Interest context

Feed keeps a durable, human-readable interest context per conversation. It is
the core product asset of this mini-app and should not be treated as opaque
agent memory. The agent reads and writes to it through declared tools or skill
instructions, but its schema is owned by KokoChat.

Draft shape (illustrative, not final):

```ts
type FeedInterestContext = {
  topics: Array<{
    name: string;
    weight: number;
    lastReinforcedAt: number;
  }>;
  sources: Array<{
    url: string;
    kind: "rss" | "site" | "youtube" | "newsletter";
    enabled: boolean;
  }>;
  dismissed: Array<{
    itemId: string;
    reason?: string;
    at: number;
  }>;
  saved: Array<{
    itemId: string;
    at: number;
  }>;
  lastRefreshAt: number;
};
```

Rules:

- Topic weights are bounded and decay over time so stale interests fade.
- Dismissed and saved entries are feedback signals surfaced back to the agent
  on the next recommendation turn.
- The interest context is portable. Swapping the underlying skill or agent
  must not require rewriting this schema.

### Book Tutor

A teaching mini-app that explains any book in multiple rounds.

Core behavior:

- create one local context per book
- generate an N-round learning plan
- teach one round at a time
- let the user interrupt with questions and then return to the main path
- persist progress, notes, and outline
- render progress and lesson blocks as native UI

This validates long-running stateful agent flows:

- skill: teaching protocol and round structure
- GUI: progress, lesson cards, notes, continue controls
- store: book metadata, outline, current step, notes, completed steps
- worker: optional source ingestion and outline preparation

#### Outline vs rounds

Book Tutor is an outline-first mini-app, not a free-form multi-turn chatbot:

1. When a book is added, the agent generates a structured outline of rounds.
2. The user can reorder, skip, insert, or regenerate rounds.
3. Each round advances through explicit states: `planned | in_progress |
   completed | skipped`.
4. User questions inside a round do not consume or mutate the outline by
   default; the mini-app tracks the detour and returns to the current round
   when the user chooses to continue.
5. Completed rounds are immutable historical records, not chat turns. They can
   be revisited or regenerated as new rounds, but the original record stays.

This separates the teaching plan (outline) from the conversation stream
(questions, explanations, detours), and lets the UI render progress as a
first-class surface instead of inferring it from chat history.

## UI Architecture

All modes share a base conversation shell.

```text
ConversationScreen
  - ConversationHeader
  - ChatTimeline
  - MiniAppSurface(mode)
  - Composer
```

The shell owns common behavior:

- connection status
- message history
- streaming response updates
- send / retry / stop generation
- block parsing
- keyboard and scroll behavior

The mini-app surface owns mode-specific UI:

```text
MiniAppSurface
  - ClawSurface
  - FeedSurface
  - BookTutorSurface
```

Examples:

- Feed can add tabs like Recommendations, Saved, Interests.
- Book Tutor can add Progress, Current Round, Notes.
- Claw can render no extra surface beyond the baseline chat.

The first implementation should not fork the whole chat screen per mini-app.
It should share the base conversation code and let each mini-app inject
mode-specific components.

## Mini-App Definition

The long-term shape can look like this:

```ts
type MiniAppDefinition = {
  id: "claw" | "feed" | "book_tutor";
  title: string;
  icon: string;

  createSession: (input: CreateMiniAppInput) => Promise<Conversation>;

  skill?: {
    id: string;
    systemContext?: string;
  };

  renderHeader?: React.ComponentType<MiniAppProps>;
  renderSurface?: React.ComponentType<MiniAppProps>;
  renderComposerAddon?: React.ComponentType<MiniAppProps>;

  blockRenderers: BlockRenderer[];
  actionHandlers: ActionHandler[];
};
```

But the first version should not build a full plugin SDK. Hardcode the first
two mini-apps and extract only after the shared pattern is visible.

Recommended implementation path:

1. Implement `ConversationMode`.
2. Add the new-conversation mode picker.
3. Store conversation metadata and messages under common conversation storage.
4. Add mini-app-specific storage namespaces.
5. Implement Feed as a hardcoded mini-app.
6. Implement Book Tutor as a hardcoded mini-app.
7. Extract a mini-app definition registry after both are working.

## Session Key Convention

Every KokoChat conversation maps to exactly one OpenClaw session via a
deterministic naming convention. This prevents KokoChat traffic from colliding
with `agent:main:main` or with other OpenClaw channels (wechat, telegram, cli),
and keeps `openclaw sessions --json` output naturally grouped by mini-app.

Canonical form:

```text
agent:<agentId>:kokochat:<miniAppId>:<conversationScope>
```

Concrete examples:

```text
agent:main:kokochat:claw:<conversationId>
agent:main:kokochat:feed:<conversationId>
agent:main:kokochat:book:<bookId>
```

Rules:

- `<agentId>` defaults to `main` unless a mini-app explicitly opts into a
  different OpenClaw agent.
- `<miniAppId>` is the stable mini-app identifier (`claw`, `feed`, `book`).
- `<conversationScope>` is usually `<conversationId>`, but stateful mini-apps
  may use a more meaningful scope (Book Tutor uses the `bookId` so the same
  book continues across UI sessions).
- KokoChat never uses `agent:main:main` for user-facing conversations. That
  key belongs to the shared OpenClaw main session and is owned by the CLI,
  the Control UI, and any other OpenClaw surface.
- Session keys are lowercase (`normalizeSessionKey` lowercases input).
- The concrete `openclawSessionKey` is stored on the `Conversation` record and
  is treated as stable metadata; it must not be regenerated on reconnect.

This convention is a product contract, not an implementation detail. UI, skill
prompts, and tooling may rely on the prefix structure.

Every conversation has common metadata and messages.

```ts
type Conversation = {
  id: string;
  mode: ConversationMode;
  title: string;
  openclawSessionKey: string;
  localContextId?: string;
  createdAt: number;
  updatedAt: number;
};

type MessageRecord = {
  id: string;
  conversationId: string;
  role: "user" | "agent" | "system";
  text: string;
  blocks?: ParsedBlock[];
  runId?: string;
  createdAt: number;
};
```

Conversation storage should not know Feed or Book Tutor internals. It should
only know the mode and common message data.

## Block Protocol

Agent responses can include structured fenced blocks that KokoChat parses and
renders as native UI.

### Envelope

Every structured block carries an envelope so the client can route, version,
and degrade gracefully. The fenced language tag identifies the block type for
humans and unsupported clients; the `type` field inside the JSON is the
authoritative identifier used by renderers and action handlers.

```ts
type KokoBlockEnvelope<T = unknown> = {
  type: string;       // e.g. "koko.feed.card", matches the fenced language tag
  version: number;    // starts at 1, bumped on breaking payload changes
  id: string;         // stable id for dedup, update, and action routing
  createdAt: number;  // epoch ms, used for sort/merge
  source?: "skill" | "tool" | "system" | "user";
  payload: T;
};
```

### Examples

Feed recommendation card:

````md
```koko.feed.card
{
  "type": "koko.feed.card",
  "version": 1,
  "id": "item_123",
  "createdAt": 1778060000000,
  "payload": {
    "title": "Article title",
    "url": "https://example.com/article",
    "source": "example.com",
    "reason": "This matches your recent interest in local-first software.",
    "actions": ["save", "hide", "not_interested", "open"]
  }
}
```
````

Book Tutor lesson block:

````md
```koko.book.lesson
{
  "type": "koko.book.lesson",
  "version": 1,
  "id": "lesson_2",
  "createdAt": 1778060000000,
  "payload": {
    "bookId": "book_123",
    "round": 2,
    "title": "Core argument",
    "summary": "...",
    "questions": ["What does the author assume?", "Where do you disagree?"],
    "nextAction": "continue"
  }
}
```
````

### Actions

`actions` inside a block payload are references to declarative action
definitions owned by the mini-app, not arbitrary commands:

```ts
type ActionDefinition = {
  id: string;
  label: string;
  kind: "local" | "agent_feedback" | "link_open" | "system";
};
```

- `local`: KokoChat mutates local mini-app state, no message sent to agent.
- `agent_feedback`: KokoChat synthesizes a structured feedback turn to the
  agent (for example `not_interested`), which influences subsequent output.
- `link_open`: open external URL or deep link.
- `system`: host-level action (share, save attachment, etc.).

For example, Feed's `not_interested` is `agent_feedback`: tapping it records a
dismissal locally and injects a structured feedback message so later
recommendations reflect the signal.

### Client behavior

The client should:

- preserve the raw message text
- parse known blocks into structured data
- render known block types with native components
- gracefully render unknown or future-version blocks as plain text or collapsed
  JSON instead of crashing

### Versioning and client capability

Mini-app block types evolve; old KokoChat builds must not be broken by new
blocks. On conversation start, KokoChat declares the block types and versions
it understands to the agent, for example via a hidden system instruction:

```text
KokoChat client supports:
  koko.feed.card v1
  koko.book.lesson v1
  koko.common.markdown v1
```

Skill prompts must honor this: when a newer version exists but the client only
supports v1, the agent falls back to the highest common version and optionally
notes upgrade availability in plain text. Unknown or future-version blocks
must not break rendering.

## Storage Boundaries

Local storage must be separated by responsibility.

Conceptual filesystem layout:

```text
koko/
  app/
    settings.json
    identity.json
    connections.json

  conversations/
    index.json
    <conversationId>/
      meta.json
      messages.jsonl

  miniapps/
    claw/
      sessions/
        <conversationId>/
          state.json

    feed/
      sessions/
        <conversationId>/
          state.json
          items.jsonl
          saved.jsonl
          preferences.json

    book_tutor/
      sessions/
        <conversationId>/
          state.json
          outline.json
          notes.jsonl
          progress.json
```

For the current React Native app, this can start as namespaced KV storage:

```text
app:settings
app:identity
app:connections

conversation:index
conversation:<id>:meta
conversation:<id>:messages

miniapp:claw:<id>:state

miniapp:feed:<id>:state
miniapp:feed:<id>:items
miniapp:feed:<id>:saved
miniapp:feed:<id>:preferences

miniapp:book_tutor:<id>:state
miniapp:book_tutor:<id>:outline
miniapp:book_tutor:<id>:notes
miniapp:book_tutor:<id>:progress
```

Rules:

- app-level storage owns identity, connection, and global settings
- conversation storage owns common chat metadata and messages
- `conversations/index.json` (or `conversation:index` KV) stores a lightweight
  summary list for the conversation list UI; it is derived data and can be
  rebuilt from per-conversation `meta.json`
- mini-app storage owns mini-app private state
- Claw has its own storage namespace even though it carries minimal state,
  so later additions (pinned system prompt, per-conversation model, etc.) do
  not require restructuring
- conversation records should not contain mini-app-specific fields beyond
  `mode` and optional `localContextId`
- each mini-app is responsible for migrations of its own namespace

### Source of truth

OpenClaw already writes a transcript for every session at:

```text
~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl
```

That transcript is the agent-facing source of truth. It drives context,
compaction, and anything the agent actually sees on the next turn. KokoChat's
`conversations/<id>/messages.jsonl` is a UI cache: it enables fast rendering,
offline browsing, and smooth streaming, but it must not diverge from the
OpenClaw transcript for agent reasoning. When the two disagree (for example
after compaction, manual edits, or cross-device use), the OpenClaw transcript
wins and KokoChat rehydrates from it.

Mini-app state (Feed interests, Book Tutor outlines, etc.) is owned by
KokoChat and is independent of the transcript. It is not subject to
compaction and must survive even if the OpenClaw session is reset.

SQLite can replace JSON/KV later when message volume, recommendation history,
or search requirements grow. The boundary should be designed now even if the
storage backend remains simple.

## Runtime Lifecycle

Every mini-app conversation passes through a small set of well-defined
lifecycle stages. These stages are explicit to avoid ad-hoc flags scattered
across components.

```text
create -> bootstrap -> active -> suspended -> archived
                                      ^          |
                                      |__________|
```

- `create`: conversation metadata and OpenClaw session key are allocated.
- `bootstrap`: mini-app initializes local context (Feed interests, Book Tutor
  outline, etc.), injects client capabilities into the system prompt, and
  performs any required tool registration.
- `active`: conversation is the currently open thread or is otherwise live
  (streaming, foregrounded, recently interacted with).
- `suspended`: conversation is backgrounded; no live stream, but its local
  state is fully restorable.
- `archived`: user-initiated end state. The conversation is hidden from the
  main list but its data is not deleted. Archived conversations can be
  restored, or eventually pruned by user action.

Notes:

- Reconnection after network loss is not a new stage. It is handled inside
  `active` as transparent resume.
- OpenClaw-side session expiry (daily reset, idle reset, compaction,
  `/reset`) does not destroy the KokoChat conversation. The conversation
  simply rebinds to the latest OpenClaw session under the same session key.
- `archived` is a UI concept. It does not delete the OpenClaw transcript or
  KokoChat local data. Physical deletion is a separate explicit action.

## Cross-MiniApp Interactions

Mini-apps are otherwise isolated. Interactions between them must be explicit
and minimal to avoid coupling.

Allowed patterns (v1):

- "Continue in Claw": any mini-app surface can offer a shortcut that opens a
  plain Claw conversation seeded with the current selection or message. The
  new conversation has its own `sessionKey` and storage; no state is shared.
- "Save to Feed interests": a card or lesson may offer an action that writes
  a topic/source hint into Feed's local `FeedInterestContext`. This is a
  declarative data push, not a runtime coupling.
- "Add to Book Tutor": a recommended article/book from Feed may create a new
  Book Tutor conversation bootstrapped with the selected source.

Not allowed (v1):

- Direct cross-reading of another mini-app's private storage.
- Sharing the same OpenClaw `sessionKey` across mini-apps.
- Invoking another mini-app's UI surface from inside a conversation.

Any future cross-mini-app feature must be expressible as: "mini-app A
produces a portable artifact; mini-app B consumes it via a defined import
path." If it cannot be expressed that way, it belongs in a single mini-app.

## CLI / Worker Role

Not every mini-app needs a custom CLI on day one.

The first version can use the existing app-to-OpenClaw Gateway connection for:

- chat
- skill invocation
- search and fetch through OpenClaw capabilities
- summarization and recommendation generation

Add CLI / worker logic only when a mini-app needs:

- local filesystem access
- scheduled background refresh
- long-running ingestion
- local index maintenance
- native desktop capabilities unavailable to the phone

Feed is the first likely candidate for worker logic because recommendation
refresh, source fetching, and metadata extraction can run in the background.

Book Tutor can initially run without a separate worker if the book source and
outline are small enough to fit in app-managed local context.

## Design Principles

1. Do not compete as a third-party OpenClaw client.
   KokoChat should compete as a skill + GUI mini-app runtime.

2. Treat mini-apps as typed conversations.
   This keeps the current app shape and avoids building a separate app shell.

3. Share the chat foundation.
   Do not fork the entire chat screen for each mini-app.

4. Separate storage early.
   App, conversation, and mini-app state should have explicit boundaries.

5. Hardcode before generalizing.
   Build Feed and Book Tutor directly first, then extract a registry / SDK.

6. GUI is part of the product contract.
   A KokoChat mini-app is not only a prompt or skill. It needs native views,
   actions, persisted state, and a clear interaction loop.

## Open Questions

- Should each typed conversation always map to a separate OpenClaw session,
  or should some mini-apps (for example Feed background refresh) be allowed
  to spawn sibling sessions under the same mini-app namespace?
- Should the `<conversationScope>` segment of the session key be opaque
  (always `<conversationId>`) or mini-app specific (for example `bookId` for
  Book Tutor), and what tooling relies on that choice?
- What is the canonical block type registry? Is it compiled into the app, or
  can an OpenClaw skill declare supported types dynamically at connect time?
- How does the capability declaration (`client supports koko.feed.card v1`)
  get enforced on the agent side? Skill prompt, Gateway validation, both?
- When KokoChat and the OpenClaw transcript disagree (post-compaction,
  cross-device), what is the UI for rehydration and what is the user-visible
  behavior?
- Which Feed actions are purely local state mutations, and which are lifted
  into `agent_feedback` turns that enter the next recommendation context?
- Should Feed's `FeedInterestContext` live in KokoChat local storage, or be
  mirrored into `~/.openclaw/workspace/koko/feed/` so OpenClaw tools can read
  it directly without a bridge?
- Should mini-app background workers live inside OpenClaw skills, a Koko
  CLI, a Koko daemon, or some combination?
- Should conversations support archive, pin, and folder at the shared shell
  level, or only per-mini-app?
- What is the first persistence backend after KV: SQLite, files, or a
  hybrid? What is the migration trigger?

## Suggested First Milestone

### Milestone 0.5: multi-conversation foundation

Before any mini-app typing, KokoChat needs a stable multi-conversation base.
This milestone intentionally ignores Feed and Book Tutor and focuses only on
shared infrastructure, because any mistake here propagates into every mini-app
built on top.

Scope:

- conversation list UI (create, select, rename, archive)
- per-conversation OpenClaw `sessionKey` that follows the Session Key
  Convention and is never the shared `agent:main:main`
- local conversation metadata (`meta.json`) and message cache
  (`messages.jsonl`) under the storage boundaries described above
- streamed chat with reconnect after network loss and app foreground
- capability declaration on connect (client declares supported block types
  and versions, even if only `koko.common.markdown v1` for now)

Explicitly out of scope in 0.5:

- `ConversationMode` routing (everything behaves like Claw until 1.0)
- mini-app surfaces, cards, or actions
- background workers, index rebuild, search

### Milestone 1: typed conversations

Build on top of 0.5:

```text
New conversation menu
  - Claw
  - Feed
  - Book Tutor

Conversation list
  - shows mixed modes with icons

Conversation screen
  - shared chat shell
  - mode-specific surface
  - local per-mode storage namespace
```

Then pick one mini-app to make real. Feed is likely the better first choice
because it can create daily usage and demonstrates cards, saved items,
preferences, and background refresh.

### Milestone 2: second mini-app and extraction

Implement Book Tutor as the second concrete mini-app. Only after both Feed
and Book Tutor are running should a `MiniAppDefinition` registry / SDK be
extracted from their shared shape. Premature extraction before two working
mini-apps will lock in the wrong abstractions.
