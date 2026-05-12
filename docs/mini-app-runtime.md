# KokoChat Mini-App Runtime — Developer Quickstart

> Date: 2026-05-11
> Status: v0 internal contract for built-in mini-apps. Not a public SDK.

This is the practical guide for someone building a mini-app inside the KokoChat
mobile app. It explains what the host gives you, what you should write, and the
common traps to avoid.

If you have not read it yet, the architectural background lives in
`docs/mini-app-runtime-direction.md`. That note explains why we made these
choices. This file is for actually shipping a mini-app.

## Mental Model

KokoChat is a mobile conversation host backed by OpenClaw.

For v1 every mini-app is built into the KokoChat app package. You write its UI
and logic in the same codebase. The host gives you four things:

- **Conversations.** A standard list row + chat screen pair. Every visible
  conversation is a `ConversationMeta` with a `mode` that names your mini-app.
- **OpenClaw runtime primitives.** Two helpers: `inferOnce` for short calls and
  agent-session helpers for long-lived chats. They live in
  `sources/runtime/openclaw.ts`.
- **Outbound message hook.** A way to rewrite or skip what the user sends from
  inside your mode's chat screen.
- **Message blocks.** A way to render structured cards inside any conversation.

You write:

- a `mode` value
- conversation entry points (creating conversations, navigating to them)
- whatever UI you want inside that conversation
- prompt construction for OpenClaw
- namespaced storage via `getMiniAppStorage(miniAppId)` if you need it

You do not write:

- the conversation list, the chat screen frame, the input bar
- the Gateway connection or device pairing
- direct OpenClaw RPC calls (use the runtime helpers)

## Runtime API

All helpers live in `@/runtime/openclaw`.

### inferOnce

```ts
import { inferOnce } from "@/runtime/openclaw";

const result = await inferOnce({
  miniAppId: "example",
  prompt:
    "请用一句话总结下面这段内容，输出 JSON: {\"summary\":\"\"}"
});

console.log(result.text);
```

Behavior:

- Creates a temporary OpenClaw session, sends one user message, waits for the
  agent to finish, reads the last assistant message, and deletes the temporary
  session.
- Returns `{ text, runId, sessionKey, status, message, cleanupError? }`.
- Does **not** route through any KokoChat conversation.

Important: this is **not** a stateless LLM API. It runs through an OpenClaw
agent. The agent may call tools, read or write its own memory, or trigger
plugins. Deleting the session does not roll those side effects back. Treat
`inferOnce` as a short OpenClaw agent call, not as a pure model completion.

When to use:

- one-off recommendations
- classification, tagging, summarization
- post-processing some text the user produced
- background helpers that should not appear in the chat history

When **not** to use:

- the user is having a real ongoing chat with an agent
- you need shared memory across multiple turns
- you need streaming UI

### Agent Sessions

```ts
import {
  createAgentSession,
  sendAgentMessage,
  waitForAgentRun,
  readAgentHistory,
  abortAgentRun,
  deleteAgentSession,
  buildKokoChatSessionKey
} from "@/runtime/openclaw";

const session = await createAgentSession({
  miniAppId: "example",
  scope: "main",
  label: "Example chat"
});

const send = await sendAgentMessage({
  sessionKey: session.key,
  message: "你好"
});

const status = await waitForAgentRun({ runId: send.runId });
const history = await readAgentHistory({ sessionKey: session.key, limit: 10 });
```

Behavior:

- Each session is a long-lived OpenClaw transcript. Re-sending uses the same
  history.
- The host hands the same `sessionKey` to the existing chat plumbing if you
  bind it to a `ConversationMeta`.
- `agent.wait` resolves when the run reaches `ok` / `timeout` / `error`. A
  successful run does not guarantee a useful assistant message; always read
  history if you need the result.

When to use:

- a real chat surface where the user types and reads streaming agent replies
- workflows that benefit from agent memory across turns

### Session Keys

Use `buildKokoChatSessionKey` to derive keys. Do not invent your own format.

```ts
const key = buildKokoChatSessionKey({
  miniAppId: "example",
  scope: "main"
});
// agent:main:kokochat:example:main
```

Convention:

- `miniAppId` is your mode.
- `scope` should be unique per logical session. For conversation-bound sessions
  use the conversation id.
- `agentId` follows the mini-app descriptor rules below. Only pass it directly
  for explicit overrides.

A `ConversationMeta` already carries a `sessionKey`, built when `create()` is
called. Prefer using that for chat-bound sessions instead of generating a new
key.

## Conversations

Mini-apps share `ConversationMeta`. Create one with the conversation store:

```ts
import { useConversationStore } from "@/state/conversations";
import { router } from "expo-router";

const meta = useConversationStore.getState().create({
  mode: "example",
  title: "Example chat",
  listSnapshot: {
    title: "Example chat",
    subtitle: "Hello OpenClaw"
  }
});
router.push({ pathname: "/chat/[id]", params: { id: meta.id } });
```

Rules:

- Keep `ConversationMeta` small. Use `artifactRef` and `listSnapshot` only as
  pointers / cached values. Real data lives in your own store.
- Do not mutate other mini-apps' conversations.
- The mode is your namespace. Declare it in your mini-app descriptor and own it.

## Mini-App Storage

Use the host-provided namespaced storage instead of writing raw MMKV keys:

```ts
import { getMiniAppStorage } from "@/runtime/miniAppStorage";

const storage = getMiniAppStorage("example");
storage.setJson("draft", { text: "hello" });
const draft = storage.getJson<{ text: string }>("draft");
```

Behavior:

- Keys are stored under this mini-app only.
- `keys()` and `clear()` only see this mini-app's namespace.
- Values are synchronous and backed by the existing KokoChat storage layer.
- No schema, migration, encryption, or quota API is provided yet.

## Outbound Message Hook

By default the chat screen sends the user's text straight to OpenClaw.
If your mode wants to rewrite, prepend, or skip that send, register an outbound
builder once:

```ts
import { registerOutboundMessageBuilder } from "@/runtime/outboundMessages";

registerOutboundMessageBuilder("example", async ({ visibleText, conversation }) => {
  return {
    visibleText,
    gatewayText: visibleText,
    // Set localOnly: true to skip the Gateway send entirely. Useful for
    // mini-apps that produce their own replies. The user's bubble is still
    // appended.
    localOnly: false
  };
});
```

Notes:

- `visibleText` is what the user sees in their own bubble. `gatewayText` is
  what OpenClaw sees. They can differ.
- Hidden character bootstrap, system context, etc. should go into
  `gatewayText`, never into `visibleText`.
- `localOnly: true` skips the Gateway call. The user's message is still
  appended. Pair it with your own logic to inject an agent reply if needed.
- Keep prompt construction inside your mini-app for now. The host does not yet
  provide a context bridge.

## Message Blocks

For structured cards inside a conversation, register a block renderer. Prefer
the guarded overload so the host validates `block.data` before calling your
renderer:

```ts
import {
  extractFencedBlock,
  registerSharedBlockRenderer
} from "@/runtime/messageBlocks";

interface ExampleCardData {
  title: string;
}

function isExampleCardData(data: unknown): data is ExampleCardData {
  return typeof data === "object" && data !== null && "title" in data;
}

registerSharedBlockRenderer(
  "koko.example.card",
  isExampleCardData,
  ExampleCardRenderer
);
```

Then put a block on a `ChatMessage`:

```ts
{
  id: "...",
  role: "agent",
  text: "Here is a card",
  blocks: [
    {
      type: "koko.example.card",
      version: 1,
      data: { /* your data */ }
    }
  ]
}
```

The renderer receives `{ block, conversation }`. There is no central action
dispatcher; if a button needs to navigate or call OpenClaw, do it inside the
renderer file using `router` and `runtime/openclaw` helpers.

Block types are global. Pick a clear namespace like
`koko.<miniAppId>.<thing>` and avoid collisions.

For structured agent output, use fenced blocks and the shared extractor:

```ts
const found = extractFencedBlock(agentText, "koko.example.card");
if (found !== null) {
  const parsed = JSON.parse(found.body);
  // validate parsed, then turn it into MessageBlock[]
}
```

`extractFencedBlock` and `extractAllFencedBlocks` only find fenced content; they
do not parse JSON or validate data. Keep schema validation in your mini-app.

## Mini-App Registration

A mini-app is a folder under `sources/miniapps/<id>/` with an `index.ts` that
exports a single registration function:

```ts
// sources/miniapps/example/index.ts
import { registerMiniApp } from "@/runtime/miniApps";

let registered = false;
export function registerExampleMiniApp(): void {
  if (registered) return;
  registered = true;

  registerMiniApp({
    id: "example",
    displayName: "Example",
    showInLauncher: true,
    listGlyph: "Ex",
    defaultTitle: (createdAt) => `Example ${formatTime(createdAt)}`,
    openclaw: {
      // Optional. If omitted, mini-apps default to agentId === id.
      // Example overrides to main so it works on a stock OpenClaw install.
      defaultAgentId: "main",
      requiredSkills: [],
      requiredCoreTools: [],
      localSkillDirs: []
    }
  });

  // Register block renderers, outbound builders, etc. here.
}
```

Then add it to `sources/miniapps/index.ts`:

```ts
import { registerExampleMiniApp } from "./example";

export function registerMiniApps(): void {
  registerExampleMiniApp();
}
```

Rules:

- Registration must be idempotent.
- Do not import any UI from this `index.ts` file. Keep registration cheap.
- Conversation `mode` is a runtime string. Normal mini-apps should not need to
  edit `sources/state/conversations.ts`.
- `showInLauncher: true` makes the mini-app appear in the conversation-list `+`
  menu. No app-menu edit is needed.

## Agent IDs And Skills

Each mini-app should normally use its own OpenClaw agent id. This prevents
product-specific prompts, tool use, and transcripts from polluting unrelated
agents. KokoChat's home assistant is `koko`, separate from the user's OpenClaw
`main` assistant.

Default agent rule:

- every mini-app uses `agentId === miniAppId` by default.
- KokoChat home mode is `koko`, so it uses OpenClaw agent `koko`.
- `descriptor.openclaw.defaultAgentId` overrides the default.
- an explicit `agentId` passed to `inferOnce` / `createAgentSession` wins over
  everything else.

Example:

```ts
registerMiniApp({
  id: "tavern",
  displayName: "Tavern",
  openclaw: {
    defaultAgentId: "tavern",
    requiredSkills: ["kokochat-tavern-search"],
    requiredCoreTools: ["web_search", "web_fetch"],
    localSkillDirs: ["miniapps/tavern/openclaw/skills/kokochat-tavern-search"]
  }
});
```

Then this call uses `agent:tavern:...` automatically:

```ts
await inferOnce({ miniAppId: "tavern", prompt });
```

The OpenClaw agent and required skills still need to exist on the OpenClaw side.
`requiredCoreTools` records which built-in OpenClaw tools the agent is expected
to use; `localSkillDirs` records skill folders shipped with the mini-app repo.
See `docs/mini-app-skills.md` and
`docs/openclaw-core-tools-for-mini-apps.md` for the current convention.

## Errors and Edge Cases

- **Gateway not connected.** Every runtime helper throws synchronously if the
  Gateway client is null. Catch this and tell the user to pair / reconnect.
- **`inferOnce` cleanup.** If `sessions.delete` fails, the inference still
  returns a result. Inspect `cleanupError` if you care.
- **Empty assistant text.** OpenClaw can complete a run without producing a
  text reply (tool-only turns). Always handle `result.text === ""`.
- **Idempotency keys.** Helpers generate one per call. If you need a stable
  one (retry, dedupe), pass it explicitly.
- **Timeouts.** Default timeout is 60s. Long workflows should pass a higher
  `timeoutMs`.

## Don'ts

- Don't call `useGatewayStore.getState().client.call(...)` directly. Use the
  runtime helpers so we can swap the transport, log, and add policies.
- Don't store full mini-app data inside `ConversationMeta`. Use your own store
  and link by `artifactRef`.
- Don't let model output execute UI actions. Validate first, then dispatch
  trusted actions yourself.
- Don't share a `sessionKey` across logically distinct conversations.
- Don't add per-mini-app Gateway connections. There is exactly one.

## Where to Look in the Code

| Need                        | Read                                   |
| --------------------------- | -------------------------------------- |
| OpenClaw runtime primitives | `sources/runtime/openclaw.ts`          |
| Outbound message builders   | `sources/runtime/outboundMessages.ts`  |
| Block renderer registry     | `sources/runtime/messageBlocks.tsx`    |
| Conversation store          | `sources/state/conversations.ts`       |
| Gateway client + chat IO    | `sources/state/gateway.ts`             |
| Live RPC smoke test         | `scripts/spike-openclaw-runtime.mjs`   |
| Example mini-app            | `sources/miniapps/example/`            |

## Self-Test

To confirm KokoChat is talking to OpenClaw correctly, open Settings → "OpenClaw
Runtime Self-Test" in a dev build. It runs a real `inferOnce` and a real agent
session round-trip against the connected Gateway and shows the result inline.

If self-test fails, your mini-app code will fail too. Fix the connection first.
