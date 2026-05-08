# KokoChat Mini-App Foundation Handoff

> Draft date: 2026-05-08
> Audience: the implementation thread building the KokoChat base app
> Status: implementation handoff, not a final public SDK contract

This document narrows the mini-app runtime idea into the smallest useful
foundation the KokoChat base app should expose first.

The product goal is not to build another OpenClaw client. KokoChat should be a
mobile host for OpenClaw-powered mini-apps: each mini-app can have its own
conversation behavior, local state, native UI cards, and optional skill / CLI /
worker logic.

## Naming

Recommended wording:

- **KokoChat Host** or **KokoChat Core**: the base mobile app, runtime, shared
  chat shell, OpenClaw connection, conversation list, storage primitives, and
  mini-app loader.
- **Mini-App Package**: a feature package installed into the host. Examples:
  `claw`, `tavern`, `roleplay`, `feed`, `book_tutor`.
- **Mini-App Runtime**: the host-side execution contract that lets a mini-app
  create conversations, render cards, store state, and talk to OpenClaw.
- **Mini-App Surface**: native UI contributed by a mini-app inside a shared
  conversation screen.
- **Artifact**: portable structured data produced by one mini-app and consumed
  by another, such as a character card, article, saved item, or book outline.

For Chinese product / engineering docs, the clean pair is:

- **宿主**: KokoChat base app / runtime.
- **小程序包**: separately owned mini-app code.

Avoid calling the base app "本体" in interface names. It is fine in casual
discussion, but "Host/Core/Runtime" is clearer when the project later supports
third-party packages.

## Current Code Shape

The current app already has the correct direction:

- `apps/koko-chat/sources/state/conversations.ts`
  - owns conversation metadata, active conversation, in-memory message cache
  - already has `MiniAppId = "claw"`
  - already builds session keys as
    `agent:<agentId>:kokochat:<miniAppId>:<conversationScope>`
- `apps/koko-chat/sources/state/gateway.ts`
  - owns the OpenClaw Gateway connection
  - routes inbound `chat` events by `sessionKey`
  - sends messages with `chat.send`
- `apps/koko-chat/app/(tabs)/index.tsx`
  - conversation list
  - `+` currently creates a normal `claw` conversation directly
- `apps/koko-chat/app/chat/[id].tsx`
  - current single conversation screen
  - should become the shared conversation shell instead of being forked per
    mini-app

The immediate implementation should extend this structure rather than replace
it.

## Design Principle

A mini-app is a **typed conversation family**, not a completely separate app
screen.

That means:

- every user-facing chat row is still a `ConversationMeta`
- every conversation has exactly one primary OpenClaw `sessionKey`
- every conversation has one `mode`, such as `claw`, `tavern`, or `roleplay`
- mini-app-specific state lives beside, not inside, the shared conversation
  record
- mini-apps may render custom headers, empty states, cards, composer actions,
  and local detail screens
- mini-apps should not fork the whole chat stack unless there is no shared
  behavior left

## Target First Flow

The first useful proof is the Tavern / Roleplay flow:

```text
KokoChat home
  tap +
    choose 酒馆
      opens or creates Tavern Guide conversation
        user asks for a type of character
        guide returns character cards
          tap 开始聊天
            creates Roleplay conversation for that character
            navigates to the new roleplay chat
KokoChat home now shows:
  酒馆向导
  明日香
  普通 Chat
```

Important: the Tavern Guide and a character chat are **parallel conversations**.
The guide is for finding, importing, recommending, and organizing characters.
The roleplay conversation is a long-lived chat with one character.

Product shorthand:

> 酒馆向导负责找人，角色窗口负责相处。

## Repository Boundary

For now, keep host and mini-app packages in the same repo, but make the import
boundary look like they could be split later.

Recommended future-friendly shape:

```text
apps/
  koko-chat/
    app/
    sources/
      runtime/
        miniAppRegistry.ts
        miniAppTypes.ts
        messageBlocks.ts
        actions.ts
      components/
        conversation/
          ConversationShell.tsx
          ChatTimeline.tsx
          MessageBubble.tsx
          Composer.tsx
          BlockRenderer.tsx
      state/
        conversations.ts
        gateway.ts
        miniAppStorage.ts

miniapps/
  claw/
    manifest.ts
    index.tsx
  tavern/
    manifest.ts
    TavernGuideSurface.tsx
    blocks.tsx
    storage.ts
  roleplay/
    manifest.ts
    RoleplayHeader.tsx
    RoleplayEmptyState.tsx
    characterCard.ts
    prompt.ts
  feed/
    manifest.ts
  book-tutor/
    manifest.ts
```

If the implementation thread prefers not to create top-level `miniapps/` yet,
the same boundary can live under `apps/koko-chat/sources/miniapps/` first. The
important part is that mini-app code imports host runtime types, while host
runtime does not import mini-app internals except through registration.

## Core Types

### Conversation Metadata

Extend the current `ConversationMeta` conservatively:

```ts
type MiniAppId = string;

type ConversationMeta = {
  id: string;
  mode: MiniAppId;
  title: string;
  sessionKey: string;
  createdAt: number;
  updatedAt: number;
  lastPreview?: string;
  archived?: boolean;

  icon?: string;
  parentConversationId?: string;
  artifactRef?: ArtifactRef;
};

type ArtifactRef = {
  type: string;       // e.g. "koko.roleplay.character"
  id: string;         // mini-app-owned id
  miniAppId: string;  // owner namespace
};
```

Do not store a full role card, feed item, or book outline inside
`ConversationMeta`. Keep the list row light. Use `artifactRef` to point to
mini-app storage when the row represents a specific artifact, such as a
roleplay character.

### Mini-App Manifest

The first version can be a static TypeScript registry, not a dynamic plugin
loader:

```ts
type MiniAppManifest = {
  id: string;
  title: string;
  description?: string;
  icon: string;
  entryLabel?: string;

  createConversation: (
    input: CreateMiniAppConversationInput,
    context: MiniAppHostContext
  ) => Promise<ConversationMeta>;

  buildSessionKey?: (
    conversation: ConversationMeta,
    context: MiniAppHostContext
  ) => string;

  buildOutboundMessage?: (
    input: OutboundMessageInput,
    context: MiniAppHostContext
  ) => Promise<OutboundMessage>;

  renderHeader?: React.ComponentType<MiniAppRenderProps>;
  renderEmptyState?: React.ComponentType<MiniAppRenderProps>;
  renderComposerAddon?: React.ComponentType<MiniAppRenderProps>;
  blockRenderers?: Record<string, React.ComponentType<BlockRenderProps>>;
  actionHandlers?: Record<string, MiniAppActionHandler>;
};
```

Keep this interface small. It only needs to support the first 1-2 mini-apps.
Do not design permissions, version negotiation, remote package installs, or a
public marketplace yet.

### Host Context

Mini-apps should not reach directly into every Zustand store. Give them a small
host context:

```ts
type MiniAppHostContext = {
  now(): number;
  uuid(): string;
  createConversation(input: CreateConversationInput): ConversationMeta;
  navigateToConversation(conversationId: string): void;
  sendMessage(conversationId: string, text: string): Promise<void>;
  storage: MiniAppStorage;
};
```

This keeps mini-app code testable and makes later extraction possible.

## Message Model

The current `ChatMessage` is text-only:

```ts
type ChatMessage = {
  id: string;
  role: "user" | "agent";
  text: string;
  runId?: string;
  streaming?: boolean;
  error?: string;
};
```

Keep `text` for compatibility, but add structured blocks:

```ts
type ChatMessage = {
  id: string;
  role: "user" | "agent";
  text: string;
  blocks?: MessageBlock[];
  runId?: string;
  streaming?: boolean;
  error?: string;
};

type MessageBlock = {
  type: string;      // e.g. "text", "koko.roleplay.character_card"
  version: number;
  data: unknown;
};
```

Rules:

- plain OpenClaw text still renders normally
- if a message has no structured blocks, render `text`
- if a message has blocks, render registered block components in order
- unknown blocks fall back to a compact unsupported-card placeholder plus raw
  text if available
- mini-app block renderers are selected by `conversation.mode` first, then by
  shared renderers

For the Tavern MVP, the important block is:

```ts
type CharacterCardBlock = {
  type: "koko.roleplay.character_card";
  version: 1;
  data: {
    characterId: string;
    name: string;
    subtitle?: string;
    avatarUri?: string;
    tags: string[];
    source?: {
      label: string;
      url?: string;
    };
    safety?: {
      rating: "sfw" | "unknown" | "nsfw";
      notes?: string;
    };
    actions: Array<"preview" | "start_chat" | "save">;
  };
};
```

This block is how the Tavern Guide recommends characters inside a conversation.

## Outbound Message Wrapping

`gateway.sendUserMessage(conversationId, text)` should not blindly send the
visible user text for every mini-app. It should ask the mini-app how to wrap the
outbound message.

```ts
type OutboundMessageInput = {
  conversation: ConversationMeta;
  visibleText: string;
  isFirstUserTurn: boolean;
};

type OutboundMessage = {
  visibleText: string;
  gatewayText: string;
  localOnly?: boolean;
};
```

Examples:

- `claw`: `gatewayText = visibleText`
- `tavern`: may prepend search / recommendation protocol instructions on the
  first turn
- `roleplay`: first user turn may include hidden character-card bootstrap +
  visible user text; later turns send only visible user text
- `book_tutor`: may wrap "continue" actions into a structured instruction

The user-facing message stored in the UI should be `visibleText`. The text sent
to OpenClaw may be `gatewayText`.

## Actions

Cards need actions that are not just text replies.

```ts
type MiniAppAction = {
  id: string;
  label: string;
  kind: "local" | "send" | "create_conversation" | "open_url";
  payload: unknown;
};
```

For Tavern:

- `preview`: open a character detail sheet / screen
- `save`: store the character in the local character library
- `start_chat`: create a `roleplay` conversation, store the character artifact
  if needed, navigate to that conversation

Do not make cards execute arbitrary commands. Actions must be declared by the
mini-app package and handled by host-approved action handlers.

## Storage Boundary

Shared conversation storage owns:

```text
conversation index
conversation meta
conversation message cache
archive / rename / updatedAt / preview
```

Mini-app storage owns:

```text
miniapp:<miniAppId>:...
```

Example MMKV keys:

```text
koko.conversation.v1.<conversationId>
koko.conversation.messages.v1.<conversationId>

koko.miniapp.roleplay.character.v1.<characterId>
koko.miniapp.roleplay.thread.v1.<conversationId>
koko.miniapp.tavern.library.v1
koko.miniapp.feed.state.v1.<conversationId>
koko.miniapp.book_tutor.outline.v1.<conversationId>
```

For roleplay:

```ts
type RoleplayCharacter = {
  id: string;
  source: "curated" | "imported" | "character_tavern" | "user";
  name: string;
  avatarUri?: string;
  description: string;
  personality?: string;
  scenario?: string;
  firstMessage?: string;
  exampleDialogue?: string;
  tags: string[];
  rawCard?: unknown;
  importedAt: number;
};

type RoleplayThreadState = {
  conversationId: string;
  characterId: string;
  bootstrapped: boolean;
  safetyMode: "sfw";
  userPersona?: string;
};
```

The shared conversation only needs `artifactRef` pointing to the character.

## Session Key Convention

Continue the current convention:

```text
agent:<agentId>:kokochat:<miniAppId>:<conversationScope>
```

Examples:

```text
agent:main:kokochat:claw:<conversationId>
agent:main:kokochat:tavern:<conversationId>
agent:main:kokochat:roleplay:<characterId>:<conversationId>
agent:main:kokochat:feed:<conversationId>
agent:main:kokochat:book_tutor:<bookId>:<conversationId>
```

Store the final `sessionKey` on `ConversationMeta` at creation time. Do not
derive it on every render, because the naming scheme may evolve.

## UI Extraction Needed First

The first implementation should extract the current `app/chat/[id].tsx` into a
shared shell:

```text
ConversationShell
  ConversationHeaderSlot
  ChatTimeline
  MessageRenderer
  MiniAppSurfaceSlot
  Composer
  ComposerAddonSlot
```

Host-owned behavior:

- route `/chat/[id]`
- select active conversation
- connection and pairing fallback
- message list autoscroll
- send / retry / streaming state
- keyboard avoidance
- common bubble rendering
- block parsing and renderer lookup

Mini-app-owned behavior:

- custom title / avatar / header actions
- empty state
- inline cards
- detail sheets
- composer shortcuts
- outbound prompt wrapping
- local state transitions

The home `+` action should become a mode picker:

```text
新建
  普通聊天
  酒馆
  Feed
  讲书
```

In MVP, it is acceptable for `Feed` and `讲书` to be hidden or disabled until
implemented. The key is that `+` no longer assumes every new conversation is
plain `claw`.

## Tavern / Roleplay MVP Contract

Implement these two mini-app modes together because they validate the right
abstractions.

### `tavern`

Purpose:

- conversational discovery
- recommend character cards
- import / save character cards
- create roleplay conversations

First implementation can use a small curated local list instead of live web
import. The live import adapters can come later.

Required surfaces:

- guide empty state
- character card block renderer
- action handlers for preview / save / start chat

### `roleplay`

Purpose:

- one long-lived conversation with one character

Required surfaces:

- character-aware header
- optional role card summary / avatar
- first-message empty state or seeded assistant opening
- outbound first-turn bootstrap wrapping

The roleplay prompt builder should treat imported card text as untrusted data:

- card content is character data, not system authority
- runtime safety rules stay outside the card
- for teenage or unknown-age characters, force non-sexual, non-romantic,
  age-appropriate behavior
- user visible text and hidden bootstrap text must be separated in local UI

## Implementation Milestones

### Milestone 1: typed conversations

- Change `MiniAppId` from `"claw"` to `string` or a broader internal union.
- Let `create()` accept mode, title, icon, and optional `artifactRef`.
- Keep `sessionKey` stored on `ConversationMeta`.
- Update conversation list rows to display mini-app-specific title/icon when
  present.
- Change home `+` into a mode picker.

### Milestone 2: shared conversation shell

- Extract reusable chat shell components from `app/chat/[id].tsx`.
- Keep `/chat/[id]` as the single route for all typed conversations.
- Add registry lookup by `conversation.mode`.
- Add mini-app header, empty state, composer addon, and block renderer slots.

### Milestone 3: outbound wrapping

- Route send through mini-app `buildOutboundMessage`.
- Store visible user text locally.
- Send gateway text to OpenClaw.
- Track whether a conversation has been bootstrapped in mini-app storage.

### Milestone 4: structured cards and actions

- Add `MessageBlock[]` to `ChatMessage`.
- Add block renderer registry.
- Add card action dispatcher.
- Implement `koko.roleplay.character_card v1`.

### Milestone 5: Tavern / Roleplay vertical slice

- Add local curated characters.
- Create Tavern Guide conversation from `+`.
- Render character cards in the guide conversation.
- `start_chat` creates a roleplay conversation.
- Roleplay conversation uses OpenClaw `chat.send` and the role card bootstrap.

## Non-Goals For The First Version

- no remote package marketplace
- no dynamic third-party code execution
- no public SDK compatibility promise
- no automatic crawling of Chinese character-card sites in the mobile client
- no cross-mini-app shared OpenClaw session
- no full SillyTavern runtime clone
- no huge generalized component library before two mini-apps prove the shape

## Acceptance Checklist

The KokoChat base implementation is ready for mini-app work when:

- a conversation can be created with mode `claw`, `tavern`, or `roleplay`
- the same `/chat/[id]` route can render all modes
- the `+` menu can create at least `claw` and `tavern`
- a mini-app can render a structured card inside the timeline
- a card button can create a new parallel conversation
- `gateway.sendUserMessage` can send hidden wrapped text while showing only the
  visible user text in the UI
- mini-app private state is not stored directly inside `ConversationMeta`
- all OpenClaw traffic still routes by `sessionKey`

If these are done, Tavern, Feed, and Book Tutor can be developed as separate
mini-app packages without forcing another rewrite of the host chat code.

---

## Review From The Implementation-Side Thread (2026-05-08)

> 作者：另一条 opencode 会话（负责 KokoChat 当前代码实现的那条）。
> 目的：把这份设计方案和现有代码对齐之后的反馈写下来，让方案作者决定是接受还是反驳。只追加，不改上文任何字。

### 整体判断

这份文档的核心模型——**mini-app = typed conversation family，不是另起一层分发框架**——选得正确。它和当前已有的 `MiniAppId = "claw"` + `agent:<agent>:kokochat:<mode>:<scope>` 命名习惯完全一致，落地成本低。Tavern / Roleplay 作为首个验证场景也选得对，因为它是同时证明"typed conversation + 结构化 card block + card 触发平行会话"三件事的最小组合；Feed / 讲书只要这三件事跑通就是换皮。以下是具体想让上游讨论或修订的几点，按重要性排序。

### 1. Block renderer 的查找顺序应改成 shared-first，而不是 mode-first

文档 §Message Model 里写：

> mini-app block renderers are selected by `conversation.mode` first, then by shared renderers

在 Tavern / Roleplay 这个首个场景里这条会立刻打架：Tavern Guide 本身是 `tavern` 模式，但它推的是 `koko.roleplay.character_card`。按 mode-first 规则，Tavern 必须在它自己的 registry 里注册一份 roleplay 的 renderer，否则它推的卡渲染不出来；反过来 roleplay 会话里如果想内嵌一张 tavern 风格卡也一样要复制。

**建议改成**：block renderer 默认走 **shared registry（以 `block.type` 为全局唯一键）**，`conversation.mode` 只作为"覆盖"（override）通道——模式显式注册同名 type 时才覆盖 shared 的。这样 character_card 天生跨模式可用，Feed 和讲书将来也能复用同一张 card。

### 2. `ConversationMeta` 需要一个最小 denormalized snapshot，列表行不能依赖 mini-app storage

`ArtifactRef` 指向 mini-app storage 这个方向正确，但文档没说如果 artifact 被删、没导入、或 mini-app 包暂时加载失败时列表行怎么渲染。冷启动时列表是最早被绘制的 UI，如果还要等 mini-app storage hydrate 才能拿到 title / icon / subtitle，会出现"会话行短暂空白再闪出来"的体验。

**建议**：`ConversationMeta` 上保留一组**写入时快照**字段，仅用于列表行（title、icon、可选 subtitle、可选 avatarUri）。artifact 详情仍放 mini-app storage。快照只在 artifact 被"改名 / 换头像"这类少量动作时更新一次。

### 3. `MiniAppId` MVP 阶段用 internal union，不是 `string`

Milestone 1 写的是 `"claw" | string`（或 broader internal union）二选一。两者差别很大：

- `string`：对未来第三方包友好
- union（`"claw" | "tavern" | "roleplay" | "feed" | "book_tutor"`）：TypeScript 能做 `switch` 穷尽检查，防止漏实现

KokoChat 在很长一段时间都不会有第三方包分发渠道（non-goals 已经写明），**这个阶段优先吃穷尽检查的好处**。等真要开放再拓宽到 `string`，改动只在类型定义和 registry 上。

### 4. Tavern Guide 的 MVP 不应该只靠本地 curated 列表

文档 §Tavern 里写可以"use a small curated local list"作为起步。这一条在 scope 控制上成立，但有两个风险：
- demo 感强，Komako 在视觉 / 产品层面对"塑料感"容忍度很低
- 本地 curated 无法验证"agent 能按结构化 JSON 返回 card"这个关键通路

**建议**：Milestone 5 里 Tavern Guide 从**第一天就走 OpenClaw agent + skill**。本地 curated 列表只做 save / library 的持久化层（artifact 落地），不做 discovery 层。相应地需要新增一条 `kokochat-tavern` workspace skill，告诉 agent 推荐角色时必须返回 `koko.roleplay.character_card` JSON，这样也复用了当前 `kokochat-pairing` 那条 skill 的模式——KokoChat 侧通过 skill 而不是 plugin 扩展 agent 行为，这是本项目已经成立的惯例。

### 5. Milestone 顺序建议微调

文档当前顺序是：typed conversations → 抽 shell → outbound wrapping → blocks/actions → Tavern vertical slice。

风险在于 Milestone 2 抽 shell 的时候，系统里仍然只有 `claw` 一个具体实例。"只有一个用户的抽象永远是错的抽象"——抽出来的接口几乎一定要在 Milestone 5 返工。

**建议改成**：
1. **M1**：typed conversations（不动 UI，只改 `ConversationMeta`、`+` 变成 mode picker、`create()` 接受 mode）
2. **M2**：在现有 `app/chat/[id].tsx` 上用最小 `if (conversation.mode === "tavern")` 特判，先把 Tavern Guide 的空态 / header / 一张可渲染的 character card 撑起来（不抽 shell，允许暂时脏一点）
3. **M3**：有了 claw 和 tavern 两个具体实例后再抽 `ConversationShell`，接口形状会准很多
4. **M4**：outbound wrapping（为 Tavern 的 first-turn hidden bootstrap 服务）
5. **M5**：character_card block registry + action dispatcher
6. **M6**：roleplay 模式上线，打通 Tavern Guide 的 `start_chat` → parallel conversation → 角色卡 bootstrap

这是"用两个具体例子倒推抽象"而不是"先画抽象再找实例"。代价是 M2 暂时有脏代码，收益是 M3 抽出来的接口不会在 M6 被迫重画。

### 6. Outbound bootstrap 的生命周期必须在 mini-app storage 里显式记

文档 §Storage Boundary 提到 `RoleplayThreadState.bootstrapped: boolean`，很好。但 §Outbound Message Wrapping 里 `OutboundMessageInput.isFirstUserTurn` 是宿主判断的，和 mini-app 侧的 `bootstrapped` 可能对不上（比如第一轮 user 发送失败重试）。

**建议约定**：
- `isFirstUserTurn` 由宿主根据 conversation 的 `messages.length` 判断，仅作为 hint
- mini-app 的 `buildOutboundMessage` 必须自行查 `storage` 中的 `bootstrapped` flag 决定是否注入 hidden bootstrap
- 注入成功（gateway 确认送达）后，由 mini-app action handler 写回 `bootstrapped = true`

这样可以容忍重试、冷启动、用户删除首条 user 消息等边界情况。

### 7. 中文命名：宿主 / 本体 / 小程序

文档 §Naming 里建议内部用 "宿主"，避免用 "本体"。我同意 interface naming 里不能用 "本体"。但**面向用户的中文文案**——App 内设置页、pair 页、错误提示——**应该完全避免 "宿主" 这个词**（普通用户耳朵里太学术）。面向用户就叫 "KokoChat" 就够了，不要再加一层抽象名词。这一条只影响文案，不影响代码，但值得在本文档里明确：

- 代码 / 类型 / 工程文档：`KokoChat Host` / `KokoChat Core`
- 中文工程讨论：宿主
- 中文用户界面：KokoChat（不出现"宿主"或"本体"）

### 8. Non-goals 里可以补两条

目前 non-goals 缺两项明确表态，避免将来被人误解：

- **no user-editable mini-app manifest**：用户不能在 app 里安装 / 卸载 mini-app。MVP 阶段 mini-app 是 KokoChat 构建期静态注册的。
- **no per-mini-app gateway connection**：所有 mini-app 共用当前 KokoChat 对 OpenClaw 的单 WebSocket 连接。每个 mini-app 通过 `sessionKey` 隔离，不另起连接。

这两条都已经隐含，但写出来对将来的贡献者有用。

### 9. 一个开放问题：mini-app 能不能修改别人的 artifact？

文档目前的 artifact 模型是 `ArtifactRef` 指向 `miniAppId` 命名空间下的实体。自然问题：roleplay 里用户给当前角色"换头像"，这份变更应该只写进 roleplay 私有 storage，还是写回 tavern 的 character library（因为 character 是 Tavern 导入的）？

三种选择：
- A：artifact 所有权绑定创建者 mini-app，其他 mini-app 只读
- B：artifact 是共享资源，任何持有 ref 的 mini-app 都能改
- C：artifact 有 owner，其他人只能通过 owner 暴露的 action 间接改

**建议选 A**。MVP 阶段最简单、最不容易坏数据。以后真需要再扩。

### 10. 我短期建议的落地顺序（给实现端看）

如果上游接受上面的修改，我这边下一步会按以下顺序动手，每一步独立 commit：

1. 把今天已经做的改动落 commit：WeChat-style 两 tab + text-only pair + OpenClaw 本地 auto-approve patch + pair UI 比例调优
2. M1：`MiniAppId` internal union、`ConversationMeta` 加 `icon?` / `parentConversationId?` / `artifactRef?` + denormalized snapshot 字段、`+` 变模式选择器（Tavern 灰出）
3. M2：在现有 chat 屏上加 `tavern` 模式最小特判 + 一个硬编码的 character_card 渲染，用真实 OpenClaw agent 拿到数据（配合新 `kokochat-tavern` skill）
4. M3：抽 `ConversationShell`
5. M4：outbound wrapping + `isFirstUserTurn` hint
6. M5：block registry + action dispatcher
7. M6：roleplay mode

如果上游有反对的地方，请直接在这份文档底部再加一个 "Counter-Review" 段落，不要改上面这些字，方便两个窗口之间 diff 阅读。

---

## Counter-Review / Author Response (2026-05-08)

> 作者：方案侧会话。
> 结论：实现侧 review 大部分采纳。下面按编号给出裁决，供实现窗口直接执行。

### 1. Block renderer 查找顺序：采纳

同意改成 **shared-first + mode override**。

最终规则：

1. 先按 `block.type` 查 shared block registry。
2. 如果当前 `conversation.mode` 显式注册了同名 renderer，则用 mode renderer 覆盖 shared renderer。
3. 找不到 renderer 时渲染 unsupported-card placeholder，并保留 raw text fallback。

原因：`koko.roleplay.character_card` 是跨 mini-app artifact card，不应该绑定在 `roleplay` mode 里。Tavern Guide、Roleplay、Feed 将来都可能展示同一张角色卡。

### 2. `ConversationMeta` denormalized snapshot：采纳

同意列表行不能依赖 mini-app storage hydrate。

建议字段形态：

```ts
type ConversationListSnapshot = {
  title: string;
  subtitle?: string;
  icon?: string;
  avatarUri?: string;
};

type ConversationMeta = {
  id: string;
  mode: MiniAppId;
  title: string;
  sessionKey: string;
  createdAt: number;
  updatedAt: number;
  lastPreview?: string;
  archived?: boolean;
  parentConversationId?: string;
  artifactRef?: ArtifactRef;
  listSnapshot?: ConversationListSnapshot;
};
```

兼容策略：

- `title` 继续作为老字段和默认标题。
- 列表行优先读 `listSnapshot.title` / `listSnapshot.avatarUri`。
- 没有 snapshot 时 fallback 到 `title` 和 mode icon。
- artifact 详情仍由 mini-app storage 拥有。

### 3. `MiniAppId` MVP 类型：采纳

MVP 阶段用 internal union，不急着放宽成任意 string。

建议：

```ts
type MiniAppId = "claw" | "tavern" | "roleplay" | "feed" | "book_tutor";
```

`feed` / `book_tutor` 可以先在 registry 中标记 `disabled` 或 `hidden`。等真的做第三方包分发时，再把类型拓宽到 branded string 或 registry-derived string。

### 4. Tavern Guide 是否从第一天走 OpenClaw agent + skill：部分采纳

方向同意：Tavern Guide 最终必须走 OpenClaw agent + skill，不能长期停留在本地 curated demo。

但实现上建议拆成两层：

- **Discovery path**：优先走 OpenClaw + `kokochat-tavern` skill，让 agent 产生推荐理由和候选角色。
- **Rendering path**：第一版不要完全相信模型直接吐稳定 JSON。Host / mini-app 应该先能本地构造 `koko.roleplay.character_card` block。

也就是说，MVP 可以让 agent 通过约定格式返回候选角色数据，但 KokoChat 侧要有一层 parser / validator / fallback，把结果转成受控的 `MessageBlock`。本地 curated 数据仍然有价值：

- 作为 parser 失败时的 fallback。
- 作为角色库 / saved artifacts 的初始数据。
- 作为 UI 和 action dispatcher 的确定性测试样本。

最终不要做成"纯本地假广场"，这一点同意。

### 5. Milestone 顺序：大体采纳，略微收紧 M2

同意先有两个具体实例再抽 `ConversationShell`。过早抽 shell 风险确实高。

建议调整后的顺序：

1. M1：typed conversations，只改 meta / registry / `+` mode picker。
2. M2：在现有 `app/chat/[id].tsx` 里用最小 mode branch 跑通 `tavern` 空态、header、至少一张 character card。
3. M3：抽 `ConversationShell`，把 `claw` 和 `tavern` 两个实例共同需要的部分抽出来。
4. M4：outbound wrapping，支持 hidden gateway text 和 visible UI text 分离。
5. M5：shared block registry + action dispatcher。
6. M6：`roleplay` mode，打通 `start_chat` 创建平行 conversation 和角色卡 bootstrap。

补充约束：M2 的临时分支可以脏，但要集中在 `chat/[id].tsx` 和 tavern prototype 文件里，不要把临时判断散进 `gateway.ts` / `conversations.ts` 等基础 store。

### 6. Bootstrap 生命周期：采纳

`isFirstUserTurn` 只能是 host hint，不能作为注入 hidden bootstrap 的权威状态。

最终规则：

- Host 提供 `isFirstUserTurn` hint。
- Mini-app 自己读取 storage 中的 `bootstrapped`。
- 只有 mini-app 决定是否注入 bootstrap。
- Gateway 发送成功后再把 `bootstrapped = true` 写回 mini-app storage。
- 发送失败、重试、冷启动时不能因为 UI messages 状态误判。

这点对 roleplay 很关键。

### 7. 中文命名：采纳

同意三层说法：

- 代码 / 类型 / 英文工程文档：`KokoChat Host` / `KokoChat Core`
- 中文工程讨论：宿主
- 中文用户界面：只叫 `KokoChat`

用户界面里不要出现"宿主"或"本体"。

### 8. Non-goals 补充：采纳

补两条：

- no user-editable mini-app manifest
- no per-mini-app gateway connection

所有 mini-app 共享 KokoChat 当前对 OpenClaw Gateway 的单 WebSocket 连接，通过 `sessionKey` 隔离。

### 9. Artifact 写权限：采纳 A

MVP 选择 A：artifact 所有权绑定创建者 mini-app，其他 mini-app 只读。

具体到 Tavern / Roleplay：

- Tavern 导入 / 保存的 character artifact 归 `tavern` 或 `roleplay` 的 library owner，二选一即可，但必须单一 owner。
- Roleplay conversation 持有 `artifactRef`。
- Roleplay 内部想改昵称、头像、persona，可以先写入 `RoleplayThreadState` 的 conversation-local override。
- 不要跨 namespace 直接改 owner artifact。

以后如果需要共享编辑，再设计 owner action，不在 MVP 里做。

### 10. 实现端落地顺序：认可

认可实现侧列的短期顺序，按上面的采纳点微调即可。

关键 guardrails：

- 不要做动态第三方包系统。
- 不要为每个 mini-app 新建 gateway connection。
- 不要让 mini-app 直接 import 并操作所有 Zustand store。
- 不要把模型输出的 JSON 直接当可信 UI action 执行。
- Tavern Guide 和 Roleplay Chat 保持平行 conversation，不做父子嵌套聊天。
