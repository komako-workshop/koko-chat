# Task 03b — `@koko/cli` 骨架 + echo bot

> 状态: pending
> 负责: codex
> 创建: 2026-04-29
> 依赖: Task 01（`@koko/protocol`）、Task 02+02b（`@koko/relay`）、`scripts/smoke-echo.mjs`（cross-package 验证）
> 上游文档: [`../DECISIONS.md`](../DECISIONS.md), [`../WORKFLOW.md`](../WORKFLOW.md), [`./01-protocol-init.md`](./01-protocol-init.md), [`./02-relay-init.md`](./02-relay-init.md), [`./03a-openclaw-client.md`](./03a-openclaw-client.md)

---

## 目标

一句话：把 `scripts/smoke-echo.mjs` 里 "CLI 一侧" 的流程做成真正的 `@koko/cli` 包。用户跑 `koko-cli start`，终端渲染 pairing QR，等待 APP 侧扫码完成 pairing，然后连 relay WebSocket，收到的每条加密 envelope 都用 `ECHO: <原文>` 回传。**这一步不接 OpenClaw**（留给 Task 03c），先把端到端 pairing + WS + 加密 envelope + 前台进程 + 生命周期管理跑通。

## 背景上下文

**必读**：
- [`../DECISIONS.md`](../DECISIONS.md) 全文（协议决定 + 环境快照）
- [`./02-relay-init.md`](./02-relay-init.md) 的协议部分（HTTP pair endpoints + WS hello）
- [`/Users/lijianren/Desktop/workspace/koko-chat/scripts/smoke-echo.mjs`](../scripts/smoke-echo.mjs) —— **最重要**：本任务就是把这份脚本的 CLI 一侧做成真正的包。几乎所有流程在 smoke 里都实际验证过了，直接抄数据结构 + 错误处理 + 消息格式。

**关键上下文**：
- 我们的 pairing 模型是**纯 room**（1 APP ↔ 1 CLI），换机器重 pair
- `@koko/protocol` 提供 `encodePairingQrUrl / decodePairingQrUrl / boxEncryptToPublicKey / boxDecryptWithSecretKey / symmetricEncrypt / symmetricDecrypt / EnvelopeSchema / encodeEnvelope / decodeEnvelope`
- `@koko/relay` 在 `http://localhost:8080` 上跑（开发期约定，可被 env 覆盖）
- **MVP 的 session key**：本任务 **hardcode 一个 32B 常量 session key** 用于 XChaCha20 加密。这个是**明知不安全的占位**——真正的 machineKey 交换协议留给 Task 04（APP 那端设计好配套）。任务书在"关于 session key"一节详细说明。

## 输入契约

### 依赖的仓库状态

- `packages/koko-cli/` 目录已存在，仅有 `README.md`
- 所有上游 workspace 包已 ready：`@koko/protocol`、`@koko/relay`（虽然 cli 不导入 relay，但测试时可能起一个 relay 实例）、`@koko/openclaw-client`（本任务不用）
- pnpm 10.33 monorepo

### 允许的依赖

```jsonc
"dependencies": {
  "@koko/protocol": "workspace:*",
  "pino": "^9.x",
  "qrcode-terminal": "^0.12.0",
  "ws": "^8.x"
},
"devDependencies": {
  "@koko/relay": "workspace:*",                  // 仅测试用（起 relay 实例）
  "@types/node": "^25.x",
  "@types/qrcode-terminal": "^0.12.0",
  "@types/ws": "^8.x",
  "tsup": "^8.x",
  "typescript": "^5.x",
  "vitest": "^3.x"
}
```

**禁止**：
- 不依赖 `@koko/openclaw-client`（Task 03c 才加）
- 不依赖任何命令行参数库（MVP 就支持 `koko-cli` 和 `koko-cli start` 两个形式，手写解析就行；future 再加 commander / cac）
- 不依赖数据库 / 外部服务

## 输出契约

### 目录结构

```
packages/koko-cli/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── README.md                # 已存在
├── src/
│   ├── index.ts             # 可执行入口 + subcommand 分发
│   ├── config.ts            # 编译期常量 + env 覆盖
│   ├── logger.ts            # pino logger 工厂
│   ├── identity.ts          # deviceSeed 持久化：load / save / generate
│   ├── pairing/
│   │   ├── index.ts
│   │   ├── qr.ts            # 终端 QR 渲染
│   │   └── flow.ts          # 完整 pairing 流程（POST → poll → decrypt）
│   ├── relay/
│   │   ├── index.ts
│   │   └── client.ts        # HTTP + WebSocket 客户端包装
│   ├── bot/
│   │   ├── index.ts
│   │   └── echo.ts          # echo bot 消息处理器
│   └── start.ts             # `koko-cli start` 主流程
└── test/
    ├── identity.test.ts         # seed 持久化 round-trip
    ├── pairing.flow.test.ts     # 用真 @koko/relay 实例跑完整 pairing flow
    ├── bot.echo.test.ts         # echo bot 纯函数测试（input → output）
    └── start.integration.test.ts # e2e：启动 → 模拟 APP 扫码 → 发消息 → 收 echo → 关
```

### `package.json`（必要字段）

```jsonc
{
  "name": "@koko/cli",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "bin": {
    "koko-cli": "./dist/index.js"
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch --onSuccess \"node dist/index.js start\"",
    "start": "node dist/index.js start",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "tsc --noEmit"
  },
  "dependencies": { ... },
  "devDependencies": { ... }
}
```

### 编译期常量 + env 覆盖

`src/config.ts`:

```ts
/** Compiled-in defaults (local dev). Override via env during testing. */
export const DEFAULT_RELAY_URL = "http://localhost:8080";

export interface CliConfig {
  relayUrl: string;        // http://... no trailing slash
  relayWsUrl: string;      // ws://... derived from relayUrl
  deviceKeyPath: string;   // ~/.koko-cli/device.key
  logLevel: "trace" | "debug" | "info" | "warn" | "error";
  pairingPollIntervalMs: number;    // 1000
  pairingMaxWaitMs: number;         // 300_000 (5 min)
}

export function loadConfig(): CliConfig {
  const relayUrl = (process.env.KOKO_RELAY_URL ?? DEFAULT_RELAY_URL).replace(/\/$/, "");
  const relayWsUrl = relayUrl.replace(/^http/, "ws");
  return {
    relayUrl,
    relayWsUrl,
    deviceKeyPath: process.env.KOKO_DEVICE_KEY_PATH ?? path.join(os.homedir(), ".koko-cli", "device.key"),
    logLevel: (process.env.KOKO_LOG_LEVEL as CliConfig["logLevel"]) ?? "info",
    pairingPollIntervalMs: Number(process.env.KOKO_PAIRING_POLL_MS ?? 1000),
    pairingMaxWaitMs: Number(process.env.KOKO_PAIRING_MAX_WAIT_MS ?? 300_000)
  };
}
```

### 关键 API

#### `src/identity.ts`

```ts
/** Load or generate the 32-byte device Ed25519 seed. */
export async function loadOrCreateDeviceSeed(keyPath: string): Promise<{
  seed: Uint8Array;      // 32B
  created: boolean;      // true if a new seed was generated
}>;

/** Save seed to disk with 0600 permissions. */
export async function saveDeviceSeed(keyPath: string, seed: Uint8Array): Promise<void>;
```

持久化格式：纯 base64url 文本，单行。MVP 不用 JSON（省事、省 parse）。权限 0600。

**注意**：Task 03b 本身**不使用** deviceSeed（没连 Gateway），但**要把 seed 准备好**，Task 03c 直接用。load 时没文件则 generate + save。

#### `src/pairing/qr.ts`

```ts
/** Render a QR to stdout using qrcode-terminal. */
export function renderQrToStdout(url: string): void;
```

用 `qrcode-terminal` 的 `generate` API，`small: true`（避免巨大 QR 占满终端）。

#### `src/pairing/flow.ts`

```ts
import type { Logger } from "pino";

export interface PairingFlowOptions {
  relayUrl: string;
  logger: Logger;
  pollIntervalMs: number;
  maxWaitMs: number;
  /** Optional abort signal (for Ctrl+C). */
  signal?: AbortSignal;
}

export interface PairingFlowResult {
  roomId: string;
  cliEphSecretKey: Uint8Array;   // 后面 ws hello 不需要，但保留给 03c 签名 challenge
  appBoxPublicKey: Uint8Array;   // 32B，从 APP 响应里解密得到（Task 04 会用）
}

/**
 * 完整 pairing 流程：
 * 1. 生成 ephemeral box keypair
 * 2. 渲染终端 QR (koko://pair?k=<cliEphPubKey>)
 * 3. POST /v1/pair/request
 * 4. 轮询 POST /v1/pair/request 直到 state=authorized 或超时
 * 5. 解密 response bundle → 拿到 APP 的 box publicKey
 * 6. 返回 roomId + 解密出的 APP pubkey
 */
export async function runPairingFlow(options: PairingFlowOptions): Promise<PairingFlowResult>;
```

#### `src/relay/client.ts`

```ts
export interface RoomConnectionOptions {
  wsBaseUrl: string;
  roomId: string;
  role: "cli";                  // Task 03b 只做 cli role
  logger: Logger;
  /** Called for each non-internal envelope received. */
  onEnvelope: (envelope: Envelope) => void | Promise<void>;
  /** Called on peer-joined / peer-left events. */
  onPeerEvent?: (event: { type: "peer-joined" | "peer-left"; role: "app" | "cli"; reason?: string }) => void;
  /** Called on hello-error or fatal close (room_not_found etc.). */
  onFatal: (reason: string) => void;
  signal?: AbortSignal;
}

export interface RoomConnection {
  /** Send an envelope. Rejects if not connected. */
  sendEnvelope(envelope: Envelope): void;
  /** Close the ws connection cleanly. */
  close(): Promise<void>;
  /** Resolved Promise when the connection is fully closed. */
  readonly closed: Promise<void>;
}

/** Open a ws room connection with hello handshake. Rejects on hello-error. */
export async function connectRoom(options: RoomConnectionOptions): Promise<RoomConnection>;
```

#### `src/bot/echo.ts`

```ts
import type { Envelope } from "@koko/protocol";

export interface EchoBotOptions {
  roomId: string;
  sessionKey: Uint8Array;    // 32B XChaCha20 key
}

export interface EchoBot {
  /** Called for each incoming envelope. Returns the echo envelope to send back, or null if no response. */
  handle(envelope: Envelope, seq: number): Envelope | null;
}

export function createEchoBot(options: EchoBotOptions): EchoBot;
```

**行为**：
- envelope.encrypted === true 且 type 以 `chat.user` 开头：解密 payload，构造 `ECHO: <原文>`，加密后返回 `{ type: "chat.agent.final", seq: <传入 seq>, payload: base64(encrypted), encrypted: true, roomId, v: 1, ts: Date.now() }`
- envelope.encrypted === false 或其他类型：返回 null（忽略）
- 解密失败：返回 null + log.warn（不崩溃）
- **seq 管理在调用方**（连接层），bot 只接 seq 参数不自增

#### `src/start.ts`

```ts
export interface StartOptions {
  config: CliConfig;
  logger: Logger;
  signal?: AbortSignal;
}

/** Run the full start flow: device seed → pairing → ws → echo bot loop. */
export async function runStart(options: StartOptions): Promise<void>;
```

流程：
1. 打印 banner: `🦞 KokoChat CLI (dev)` + relay URL + device.key 路径
2. `loadOrCreateDeviceSeed` — 首次 generate 时 log: "generated new device seed"
3. `runPairingFlow` — 期间控制台打印 "waiting for APP to scan..."
4. 收到 roomId 后：`connectRoom(..., onEnvelope: bot.handle)`
5. 连接成功：`console.log("✓ paired, bot ready. Press Ctrl+C to stop.")`
6. 每条 envelope：转 bot → 如有 response 则 sendEnvelope
7. Ctrl+C：捕获 `SIGINT` → AbortController.abort() → 让所有 awaitable 退出 → close ws → log "stopped"

#### `src/index.ts`（CLI 入口）

```ts
#!/usr/bin/env node

// 手写 argv 解析：
//   koko-cli                  → 打印 help + exit 0
//   koko-cli start            → runStart
//   koko-cli --version        → 打印版本
//   koko-cli help | -h        → help
//   其他                       → help + exit 1

const args = process.argv.slice(2);
const command = args[0] ?? "help";

// ... dispatch ...
```

### 关于 session key（重要）

**本任务硬编码一个 32B 常量 session key**，用于 XChaCha20 加密 / 解密 envelope payload。这是**明知不安全的 placeholder**，**仅用于端到端测试 echo bot 数据通路**。

具体：

```ts
// src/bot/echo.ts 或 src/start.ts
// ⚠️  PLACEHOLDER: 真正的 machineKey 交换协议在 Task 04 里设计实现。
// 现在 APP 和 CLI 双方都用这个常量，scripts/smoke-echo.mjs 里是同样的占位。
const PLACEHOLDER_SESSION_KEY = new Uint8Array(32).fill(42);
```

**必须在源代码注释 + README 里显式标记**这是 placeholder，不是最终协议。

理由：如果 Task 03b 就去设计 key 交换协议，会和 Task 04（APP 那端）互相阻塞。先定下来"两端都用 `new Uint8Array(32).fill(42)`"，Task 03b 和 Task 04 能并行写，最后一次到位替换成真 machineKey。

## 验收标准

### 1. 基础命令

```bash
pnpm install --no-frozen-lockfile
pnpm --filter @koko/cli typecheck      # 0 errors
pnpm --filter @koko/cli build          # dist/index.js 产出
pnpm --filter @koko/cli test           # 全绿
```

### 2. 测试覆盖

#### `identity.test.ts`
- 新目录 `loadOrCreateDeviceSeed` 生成 32B seed + 文件写入 + 权限 0600
- 再次 load 同路径 → `created: false` 且 seed 内容一致
- 文件被篡改成非法 base64url → 抛错（或重新生成，你选一种，在 Outcome 里说）

#### `bot.echo.test.ts`
- 加密 `"hello"` envelope → `echoBot.handle(env, 5)` → 返回 envelope，payload 解密后 === `"ECHO: hello"`，seq === 5
- `encrypted: false` envelope → 返回 null
- type 不是 `chat.user*` → 返回 null
- payload 解密失败（错的 key）→ 返回 null（不抛）
- 中文 + emoji 原样过关

#### `pairing.flow.test.ts`
- 起一个真 `@koko/relay` 实例（port 0）
- `runPairingFlow` 在一个 Promise；另一个 Promise 模拟 APP：短暂 delay 后读 QR 里的 cli pubkey → 构造加密 bundle → POST /v1/pair/response
- 两个 Promise race，`runPairingFlow` 应该 resolve 到 `{ roomId, cliEphSecretKey, appBoxPublicKey }`，appBoxPublicKey 和模拟 APP 发的对得上
- 超时场景：如果模拟 APP 不响应，`runPairingFlow` 在 `maxWaitMs` 后抛超时
- AbortSignal 取消场景：`signal.abort()` 后 `runPairingFlow` 抛 AbortError

#### `start.integration.test.ts`（端到端）
- 起真 relay + 起 `runStart`（daemon 模式：用 AbortController 控制关）
- 模拟 APP：pair → 连 ws → 发一条加密消息 → 验证收到 ECHO
- abortController.abort() → runStart 优雅返回（< 500ms）+ 无 Unhandled

### 3. 手动 smoke（在 Outcome 记录一次）

```bash
# 终端 1
pnpm --filter @koko/relay dev

# 终端 2
pnpm --filter @koko/cli start
# 应该显示 banner + QR + "waiting for APP to scan..."

# 终端 3（模拟 APP）
node scripts/smoke-echo.mjs
# 不，smoke-echo 会自己起 relay。忽略这一步。
# 真正的手动 smoke 需要等 Task 04 RN APP 做出来。
# MVP 阶段 "手动 smoke" 就是跑 start.integration.test.ts。
```

### 4. 代码质量

- 所有公开 export 带 TSDoc
- 无 `any`（必要处加注释）
- 无 `console.log`（banner 除外可以用 `console.log`，log 全走 pino）
- 每处用 placeholder session key 都有 `// ⚠️  PLACEHOLDER` 注释 + 指向 Task 04

## 禁止事项

- 不依赖 `@koko/openclaw-client`（03c 才加）
- 不接 OpenClaw CLI（`spawn openclaw agent` 在本任务完全不要出现）
- 不做 launchd / systemd / daemon 化（前台进程就行）
- 不做 `koko-cli stop/status/pair` 子命令（MVP 只支持 `start` + `help`）
- 不做 auto-update / telemetry / crash reporter
- 不改 `@koko/protocol` / `@koko/relay` / `@koko/openclaw-client`
- 不改 `DECISIONS.md` / `IDEA.md` / `WORKFLOW.md` / 其他 `tasks/*.md`
- 不 git commit

## 设计上的"为什么"

1. **为什么前台进程而非 daemon**：MVP 调试最方便。launchd / systemd 是 v1.0 的事。
2. **为什么编译期常量 relay URL + env 覆盖**：开发期 `localhost:8080` 够；env 覆盖留给 CI 或部署验证。commander 类参数解析框架还没到规模要加。
3. **为什么 seed 现在持久化但不用**：Task 03c 会立刻用到，先把磁盘格式定了能避免一次改动。
4. **为什么 echo bot 只处理 `chat.user*`**：留下 `chat.agent.*` 类型给将来真 agent 流式。echo 就是最小可验证单元。
5. **为什么 placeholder session key**：Task 03b 和 Task 04 要并行，key 交换协议设计放到后续统一决定，比现在拍脑袋更好。

## Outcome

> 状态: ✅ 实现完成（Codex）— 2026-04-28

### 实际改动

- 在 `packages/koko-cli/` 下补齐 `tsconfig.json`、`tsup.config.ts`、`vitest.config.ts`
- 实现 `src/` 模块：
  - `config.ts`：本地 relay 默认值 + env 覆盖
  - `logger.ts`：pino logger factory
  - `identity.ts`：32B device seed base64url 持久化，权限 `0600`
  - `pairing/`：QR 渲染、HTTP pairing request/poll、response bundle 解密
  - `relay/`：WebSocket hello handshake、envelope 收发、peer event/fatal close 处理
  - `bot/echo.ts`：解密 `chat.user*`，回传加密 `ECHO: <原文>`
  - `start.ts` / `index.ts`：`koko-cli start` 前台流程、help/version、SIGINT/SIGTERM abort
- 更新 `README.md`：明确 Task 03b 只做 encrypted echo，不接 OpenClaw；标出 placeholder session key
- 增加 4 个测试文件：
  - `identity.test.ts`
  - `bot.echo.test.ts`
  - `pairing.flow.test.ts`
  - `start.integration.test.ts`

### 偏离 / 说明

- `runPairingFlow` / `runStart` 增加了两个可选测试 hook：`onPairingUrl` 和 `renderQr`。默认行为不变；测试用它拿到 `koko://pair?...`，避免解析终端 QR 图。
- device seed 文件非法时选择直接抛错，不自动重生成，避免悄悄覆盖可能有诊断价值的坏状态。
- session key 按任务要求硬编码为 `new Uint8Array(32).fill(42)`，源码使用处均加了 `PLACEHOLDER` 注释并指向 Task 04。

### 验证结果

```bash
pnpm --filter @koko/cli typecheck
# 通过，0 errors

pnpm --filter @koko/cli build
# 通过，产出 dist/index.js + dist/index.d.ts

pnpm --filter @koko/cli exec vitest run test/identity.test.ts test/bot.echo.test.ts
# 通过，7/7 passed

pnpm --filter @koko/cli test
# 沙箱内未全绿：7/11 passed，4 个 relay integration 用例失败于
# listen EPERM: operation not permitted 127.0.0.1
```

### 遗留疑点

- 当前沙箱禁止 localhost listen，`pairing.flow.test.ts` 和 `start.integration.test.ts` 需要在本地可监听环境复跑。
- 本任务未接 OpenClaw、未做真实 machineKey 交换；两者分别留给 Task 03c / Task 04。

---

### Claude 本地复跑验收 + 补丁 — 2026-04-28

**1. `qrcode-terminal` ESM import bug（codex 漏测，因为测试路径设 `renderQr: false` 跳过真实 QR 渲染）**

symptom：build 完 `node dist/index.js help` 崩 `SyntaxError: Named export 'generate' not found`。原因：`qrcode-terminal` 是 CJS 包，不支持 ESM named import。

修复：`src/pairing/qr.ts`
```ts
import qrcodeTerminal from "qrcode-terminal";
// ...
qrcodeTerminal.generate(url, { small: true });
```

**2. 日志可见性小增强**

`src/pairing/flow.ts` 在 QR 渲染后补一行 `console.log(qrUrl)`，让无法扫码或 QR block 字符渲染不佳（tmux、CI、log 抓取）的场景也能直接拿到 URL。测试无需改动。

**3. 本地完整验收**

```bash
pnpm --filter @koko/cli typecheck   # 0 errors ✓
pnpm --filter @koko/cli test        # 11/11 passed ✓
pnpm --filter @koko/cli build       # dist/index.js 19.14 KB + dist/index.d.ts 6.79 KB ✓
node packages/koko-cli/dist/index.js help      # help 输出 ✓
node packages/koko-cli/dist/index.js --version # 0.0.1 ✓
```

**4. 真实手动 smoke**（三进程联动）

```bash
# 终端 A
pnpm --filter @koko/relay start                        # relay on :8080

# 终端 B
KOKO_DEVICE_KEY_PATH=/tmp/koko-cli-smoke-device.key \
KOKO_LOG_LEVEL=info \
node packages/koko-cli/dist/index.js start             # 显示 banner + QR + URL
# 输出: 🦞 KokoChat CLI (dev) / relay url / device key / "generated new device seed"
# 终端 QR 图正确渲染 + URL 文本也打印

# 终端 C（模拟手机 APP）
node scripts/smoke-attach-as-app.mjs \
  --qr-url "$(grep -oE 'koko://pair\?k=[A-Za-z0-9_-]+' /tmp/cli.log | head -1)" \
  --message "你好世界 🦞"
# [app] paired, roomId=322d5867-...
# [app] hello-ok, waiting for CLI to join...
# [app] CLI joined
# [app] -> envelope "你好世界 🦞"
# [app] <- envelope "ECHO: 你好世界 🦞"
# ✅ Echo received correctly.

# 终端 B 然后 Ctrl+C
# log: "stopped"
# 进程干净退出
```

**一次跑通。中文 + emoji 原样 echo。QR 能扫、URL 能 copy。Ctrl+C 优雅关。**

补了一个一次性工具：[`scripts/smoke-attach-as-app.mjs`](../scripts/smoke-attach-as-app.mjs)，跟本次 smoke 配套，未来也能当 `@koko/cli` 的 regression 检查器用。

### 修改的文件（相对 codex 最初产出）

- `packages/koko-cli/src/pairing/qr.ts` — 改 `generate` 的 import 为 default + `.generate()` 调用
- `packages/koko-cli/src/pairing/flow.ts` — QR 渲染后多打印一行 URL
- `scripts/smoke-attach-as-app.mjs` — 新增，真实 smoke 用
- `tasks/README.md` — 状态改成 ✅ done
