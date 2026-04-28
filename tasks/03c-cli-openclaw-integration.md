# Task 03c — `@koko/cli` 接入 `@koko/openclaw-client`（echo → 真 LLM）

> 状态: pending
> 负责: codex
> 创建: 2026-04-29
> 依赖: Task 03a（`@koko/openclaw-client` 25/25 绿）、Task 03b（`@koko/cli` 11/11 绿 + 手动 smoke 过）
> 上游文档: [`../DECISIONS.md`](../DECISIONS.md)，[`./03a-openclaw-client.md`](./03a-openclaw-client.md)，[`./03b-cli-skeleton-echo.md`](./03b-cli-skeleton-echo.md)

---

## 目标

把 `@koko/cli` 的 echo bot 替换成**真正的 OpenClaw Gateway 调用**：
- CLI 启动时额外连 OpenClaw Gateway（`ws://127.0.0.1:18789`）做 challenge-response 握手
- 收到 APP 的 `chat.user` envelope → 解密 → `chat.send` 到 Gateway
- Gateway 推 `event 'chat' {state:'delta'}` → 每个 delta 转成一个加密 envelope 发给 APP
- `event 'chat' {state:'final'|'error'}` → 结束 turn

完成后 Komako 应该能在 APP 侧**真正和 Claude（通过 OpenClaw）对话**，不再是 ECHO 占位。

## 背景上下文

**必读**：
- [`../DECISIONS.md`](../DECISIONS.md) 的 "2026-04-29 新增" 段 + "环境资源" 段
- [`./03a-openclaw-client.md`](./03a-openclaw-client.md) 整份（`@koko/openclaw-client` 的 API）
- [`./03b-cli-skeleton-echo.md`](./03b-cli-skeleton-echo.md) 整份 + Outcome（`@koko/cli` 现状）
- [`/Users/lijianren/Desktop/workspace/koko-chat/packages/koko-cli/src/bot/echo.ts`](../packages/koko-cli/src/bot/echo.ts) 的现有 bot 接口——新 bot 要和这个接口兼容

**关键环境信息**（Komako 本机已验证，DECISIONS.md 记录）：

```
OpenClaw Gateway URL:  ws://127.0.0.1:18789  (hardcode)
Device identity file:  ~/.openclaw/identity/device.json
Paired devices file:   ~/.openclaw/devices/paired.json
Agent sessions cmd:    openclaw sessions --json --agent main
Main session key:      agent:main:main
```

### 关键实验已做的研究（写进任务书免得 codex 再踩坑）

#### 1. Ed25519 seed 从 OpenClaw 自己的 device.json 里读

`~/.openclaw/identity/device.json` 结构：

```json
{
  "version": 1,
  "deviceId": "27edfbe8...",
  "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...",
  "privateKeyPem": "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEII...\n-----END PRIVATE KEY-----\n",
  "createdAtMs": 1773720321374
}
```

`privateKeyPem` 是 PKCS8 格式 Ed25519 私钥。**已经实验验证**：

- base64 decode 后 **48 字节**
- 前 16 字节是固定 PKCS8 Ed25519 v1 头：`30 2e 02 01 00 30 05 06 03 2b 65 70 04 22 04 20`
- **后 32 字节就是 Ed25519 seed**（用这个 seed 喂 `@koko/openclaw-client` 的 `deviceSeed` 选项）

给 codex 的具体实现：

```ts
import { readFile } from "node:fs/promises";

async function loadOpenClawDeviceSeed(identityJsonPath: string): Promise<Uint8Array> {
  const raw = JSON.parse(await readFile(identityJsonPath, "utf8")) as { privateKeyPem?: string };
  if (typeof raw.privateKeyPem !== "string") {
    throw new Error("OpenClaw identity file missing privateKeyPem");
  }
  const base64 = raw.privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const der = Buffer.from(base64, "base64");
  if (der.length !== 48) {
    throw new Error(`unexpected PKCS8 length ${der.length}, expected 48`);
  }
  // fixed PKCS8 Ed25519 v1 header prefix (16 bytes), then 32-byte seed
  return new Uint8Array(der.subarray(16, 48));
}
```

#### 2. paired.json 里找 operator token

`~/.openclaw/devices/paired.json` 是一个对象，key 是 deviceId，value 是 device 信息。`tokens.operator.token` 字段就是 operator token。

**选择策略**：按 deviceId（从上一步 device.json 读出来）精确匹配。如果 paired.json 里**没有**匹配的 device（说明用户 OpenClaw 重新 pair 过），立刻报错退出。

```ts
async function loadOpenClawOperatorToken(
  pairedJsonPath: string,
  deviceId: string
): Promise<string> {
  const paired = JSON.parse(await readFile(pairedJsonPath, "utf8")) as Record<string, unknown>;
  const entry = paired[deviceId];
  if (entry === undefined || typeof entry !== "object" || entry === null) {
    throw new Error(`paired.json has no entry for deviceId ${deviceId}`);
  }
  const tokens = (entry as { tokens?: { operator?: { token?: string } } }).tokens;
  const token = tokens?.operator?.token;
  if (typeof token !== "string") {
    throw new Error(`paired.json has no operator.token for deviceId ${deviceId}`);
  }
  return token;
}
```

#### 3. main sessionId 从 `openclaw sessions --json --agent main` 拿

spawn + parse 一次即可：

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);

interface SessionEntry { key: string; sessionId: string }

async function readMainSessionId(openclawBinaryPath = "openclaw"): Promise<string> {
  const { stdout } = await execFileAsync(
    openclawBinaryPath,
    ["sessions", "--json", "--agent", "main"],
    { timeout: 10_000 }
  );
  const parsed = JSON.parse(stdout) as { sessions?: SessionEntry[] };
  const main = parsed.sessions?.find((s) => s.key === "agent:main:main");
  if (main?.sessionId === undefined) {
    throw new Error("no agent:main:main session found; run OpenClaw once first");
  }
  return main.sessionId;
}
```

**注意**：OpenClaw CLI 会在 stderr 打 "Config warnings"——用 `execFile` 别信任 stderr，只看 stdout。

#### 4. `chat.send` 的 params

根据 [ngmaloney/clawchat useChat.ts](https://github.com/ngmaloney/clawchat/blob/main/src/hooks/useChat.ts) 调用方式：

```ts
await client.call('chat.send', {
  sessionKey: 'agent:main:main',       // ← 用 sessionKey 不是 sessionId
  message: '<user text>',
  idempotencyKey: crypto.randomUUID()
});
```

**注意**：ngmaloney 用的是 `sessionKey`（agent:main:main 这种形式），不是 `sessionId`。但我们从 `openclaw sessions` 拿到的是 **sessionId + sessionKey 两个都有**，两者都应能用。**本任务用 sessionKey** (hardcode `"agent:main:main"`)，避免每次启动都 spawn 一次 openclaw CLI 只为拿 sessionId。

**但仍然推荐在启动时 spawn 一次**验证 main session 真的存在（fail fast）。

## 输入契约

### 依赖的仓库状态

- Task 03b 已 commit（`f2c30e7`），11/11 测试绿
- Task 03a 已 commit（`02b5780`），25/25 测试绿
- `@koko/openclaw-client` 可以 `import { GatewayClient }` 使用

### 新增依赖

在 `packages/koko-cli/package.json`:

```jsonc
"dependencies": {
  "@koko/openclaw-client": "workspace:*",    // ← 新增
  // 已有的 @koko/protocol / pino / qrcode-terminal / ws 保留
}
```

**禁止**：
- 不依赖 `tweetnacl` / `libsodium-wrappers`（Ed25519 seed 提取用 Buffer 字节 slice 就够，crypto 通过 @koko/openclaw-client → @noble/ed25519）
- 不用 `execa` / `cross-spawn` 等 wrapper（`node:child_process` 的 `execFile` 够了）

## 输出契约

### 允许修改的文件

- `packages/koko-cli/package.json`（加新 dep）
- `packages/koko-cli/src/bot/echo.ts`（保留，但不再用于 `koko-cli start`）
- `packages/koko-cli/src/bot/index.ts`（re-export 增加 openclaw bot）
- `packages/koko-cli/src/start.ts`（切 bot + 连 Gateway）
- 新增：`packages/koko-cli/src/openclaw/` 目录
- 新增：`packages/koko-cli/test/openclaw.*.test.ts`

### 目录结构（增量）

```
packages/koko-cli/
├── src/
│   ├── openclaw/
│   │   ├── index.ts             # re-export
│   │   ├── identity.ts          # loadOpenClawDeviceSeed + loadOpenClawOperatorToken
│   │   ├── sessionLookup.ts     # spawn openclaw sessions --json 拿 main session
│   │   └── bot.ts               # OpenClawBot：receive chat.user → chat.send → 流式 envelope
│   └── ... (其他不变)
└── test/
    ├── openclaw.identity.test.ts      # PKCS8 PEM 解析（已知向量）+ paired.json 查 token
    ├── openclaw.sessionLookup.test.ts # 模拟 execFile 输出
    └── openclaw.bot.test.ts           # 用 mock GatewayClient，验证 chat.user → chat.send → delta → envelope 流
```

### 核心 API

#### `src/openclaw/identity.ts`

```ts
/** 加载 OpenClaw device 的 32B Ed25519 seed。默认路径 ~/.openclaw/identity/device.json */
export async function loadOpenClawDeviceSeed(identityJsonPath?: string): Promise<{
  seed: Uint8Array;     // 32B
  deviceId: string;     // hex
  publicKeyPem: string; // 诊断用
}>;

/** 在 paired.json 里按 deviceId 查 operator token。默认路径 ~/.openclaw/devices/paired.json */
export async function loadOpenClawOperatorToken(
  deviceId: string,
  pairedJsonPath?: string
): Promise<string>;
```

#### `src/openclaw/sessionLookup.ts`

```ts
export interface MainSessionInfo {
  sessionKey: string;   // "agent:main:main"
  sessionId: string;    // uuid
  model?: string;
}

/** 调用 `openclaw sessions --json --agent main`，找 agent:main:main session。 */
export async function readMainSession(options?: {
  openclawBinary?: string;    // default "openclaw"
  timeoutMs?: number;         // default 10000
}): Promise<MainSessionInfo>;
```

如果没找到 main session，抛明确错误（`"no agent:main:main session found; run \`openclaw\` at least once first"`）。

#### `src/openclaw/bot.ts`

```ts
import type { Envelope } from "@koko/protocol";
import type { GatewayClient } from "@koko/openclaw-client";
import type { Logger } from "pino";

export interface OpenClawBotOptions {
  roomId: string;
  sessionKey: Uint8Array;          // 加密 envelope 的 session key（暂时 PLACEHOLDER_SESSION_KEY）
  gatewayClient: GatewayClient;    // 已连接的
  openclawSessionKey: string;      // "agent:main:main"
  logger: Logger;
}

export interface OpenClawBot {
  /** 处理一条 APP 发来的 envelope，返回 unsubscribe fn 用于取消对 delta 的监听。 */
  handle(envelope: Envelope, onOutgoingEnvelope: (envelope: Envelope) => void): Promise<void>;
  /** 返回当前正在跑的 runId 或 null。 */
  getActiveRunId(): string | null;
  /** 取消当前跑着的 run（如果有），调 chat.abort。 */
  abort(): Promise<void>;
}

export function createOpenClawBot(options: OpenClawBotOptions): OpenClawBot;
```

**行为规范**：

1. `handle(envelope, onOut)`：
   - envelope.encrypted !== true 或 type 不是 `chat.user*`：warn log + return（不抛）
   - 解密 payload 失败：warn log + return
   - 解密出的 payload 应该是 JSON，formats：
     - 如果是 `{ text: string }` 或 `{ message: string }`：取 text
     - 如果是 string：直接当 text
     - 否则 warn + return
   - 如果有 `activeRunId`：先调 `chat.abort`（`await this.abort()`）
   - 调 `gatewayClient.call('chat.send', { sessionKey: openclawSessionKey, message: text, idempotencyKey: randomUUID() })`
   - 收到 ack：记 `activeRunId = ack.runId`
   - 订阅 `'chat'` 事件（如果还没订阅；一次订阅长期复用）：
     - 过滤 `sessionKey === openclawSessionKey && runId === activeRunId`
     - `state: 'delta'` → 构造 envelope `type: "chat.agent.delta"`，payload = base64(symmetricEncrypt(JSON.stringify(openclawMessage), sessionKey))，seq 单调递增，onOut(envelope)
     - `state: 'final'` → 同上但 type = "chat.agent.final"；清空 activeRunId
     - `state: 'error'` → 同上但 type = "chat.agent.error"；payload 包含 errorMessage 字段
2. `abort()`：
   - 如果有 activeRunId：`gatewayClient.call('chat.abort', { sessionKey: openclawSessionKey }).catch(() => warn)`
   - 清空 activeRunId
3. seq 生成：bot 内部维护一个 counter，对每个 outgoing envelope +1。调用方不传 seq 进来。
4. unsubscribe：bot 构造时 subscribe 一次，不暴露 unsubscribe（bot 的生命周期 = cli 进程）；但提供一个 `close()` 方法给测试用。

#### `src/start.ts` 修改

把 `createEchoBot` 换成 `createOpenClawBot`：

```ts
import { GatewayClient } from "@koko/openclaw-client";
import { createOpenClawBot } from "./bot/openclaw";  // 新文件或 re-export
import { loadOpenClawDeviceSeed, loadOpenClawOperatorToken, readMainSession } from "./openclaw";

export async function runStart(options: StartOptions): Promise<void> {
  await initCrypto();
  const logger = options.logger.child({ module: "start" });

  console.log("🦞 KokoChat CLI (dev)");
  // banner...

  // ── NEW: 连 OpenClaw Gateway（启动时连，失败就退出）──
  const openClawIdentity = await loadOpenClawDeviceSeed(options.config.openclawIdentityPath);
  const openClawToken = await loadOpenClawOperatorToken(openClawIdentity.deviceId, options.config.openclawPairedPath);
  const mainSession = await readMainSession();
  logger.info({ deviceId: openClawIdentity.deviceId, sessionKey: mainSession.sessionKey }, "OpenClaw identity resolved");

  const gatewayClient = new GatewayClient({
    url: options.config.openclawGatewayUrl,     // ws://127.0.0.1:18789
    token: openClawToken,
    deviceSeed: openClawIdentity.seed,
    client: { id: "koko-cli", version: "0.0.1", platform: process.platform, mode: "cli" },
    logger: logger.child({ module: "openclaw" }),
    maxRetries: 3,
    requestTimeoutMs: 30_000,
    onStatusChange(status) {
      logger.info({ status }, "openclaw gateway status");
    }
  });
  await gatewayClient.connect();
  console.log(`✓ OpenClaw Gateway connected (session: ${mainSession.sessionKey})`);

  // ── pairing 同前 ──
  // ...

  // ── bot 换成 OpenClawBot ──
  const bot = createOpenClawBot({
    roomId: pairing.roomId,
    sessionKey: PLACEHOLDER_SESSION_KEY,
    gatewayClient,
    openclawSessionKey: mainSession.sessionKey,
    logger
  });

  // connectRoom(...)  // 同前

  // onEnvelope 变成：
  //   (envelope) => bot.handle(envelope, (out) => connection?.sendEnvelope(out))
}
```

**cleanup**：Ctrl+C → bot.abort() → gatewayClient.disconnect() → connection.close() → return。顺序重要（先 abort OpenClaw 免得泄漏 turn）。

#### `src/config.ts` 扩充

```ts
export interface CliConfig {
  // 已有：
  relayUrl: string;
  relayWsUrl: string;
  deviceKeyPath: string;
  logLevel: "trace" | "debug" | "info" | "warn" | "error";
  pairingPollIntervalMs: number;
  pairingMaxWaitMs: number;
  // 新增：
  openclawGatewayUrl: string;            // ws://127.0.0.1:18789
  openclawIdentityPath: string;          // ~/.openclaw/identity/device.json
  openclawPairedPath: string;            // ~/.openclaw/devices/paired.json
  openclawBinary: string;                // "openclaw"
}
```

env 覆盖：`KOKO_OPENCLAW_GATEWAY_URL` / `KOKO_OPENCLAW_IDENTITY_PATH` / `KOKO_OPENCLAW_PAIRED_PATH` / `KOKO_OPENCLAW_BINARY`。

### OpenClaw message 转 envelope payload 的契约

```ts
// 传给 APP 的加密 payload（解密后是 JSON）：
interface OpenClawEnvelopePayload {
  /** OpenClaw raw message object (ChatMessage) —— APP 侧拼 delta 或直接展示 */
  openclawMessage?: unknown;
  /** OpenClaw 的 runId（APP 侧用于去重 / 拼装 turn） */
  runId?: string;
  /** error state 时填 */
  errorMessage?: string;
}
```

**不要自己提 text**——完整 `openclawMessage` 对象原样带走，APP 侧 `extractText` 之类的事自己做（Task 04 的事）。

## 验收标准

### 1. 基础命令

```bash
pnpm install --no-frozen-lockfile
pnpm --filter @koko/cli typecheck   # 0 errors
pnpm --filter @koko/cli build       # dist/ 产出
pnpm --filter @koko/cli test        # 全绿（含已有 11 个 + 新增）
```

### 2. 新增测试

#### `openclaw.identity.test.ts`
- 真实 PEM 向量（来自 DECISIONS.md 记录的 Komako 机器）：
  - `privateKeyPem: "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIILVF0/EzaS6zzMhz0Z85amQFrjBrlSe+8EcVAs9b4sf\n-----END PRIVATE KEY-----\n"`
  - 期望 seed (hex): `82d5174fc4cda4bacf3321cf467ce5a99016b8c1ae549efbc11c540b3d6f8b1f`
  - 期望 deviceId: `27edfbe83a819252501d93c7de5a9f4818c9b0a0b4d3e6e43dc7c290ce9faf56`
  - 期望 publicKey (base64url): `m5DaiOBU8Wk_iW7Tz2BTW1ne1YeD0p0j_SnHwD2Uc-c`
- 文件不存在 → 抛错明确 "OpenClaw identity file not found"
- 文件 JSON 非法 → 抛错
- privateKeyPem 字段缺失 → 抛错
- DER 长度不是 48 → 抛错
- paired.json 中 deviceId 不存在 → 抛错
- paired.json 中该 deviceId 缺 operator token → 抛错

#### `openclaw.sessionLookup.test.ts`
- 注入一个假 `openclawBinary`（用 `node -e "console.log(JSON.stringify({...}))"` 或写个临时 shell 脚本）
- 模拟 stdout `{"sessions":[{"key":"agent:main:main","sessionId":"bdb0f457-..."},...]}` → 返回对应信息
- 模拟 stdout 没 `agent:main:main` → 抛错
- 模拟 timeout → 抛错
- 模拟 stdout 非法 JSON → 抛错

#### `openclaw.bot.test.ts`
- 用一个**手写的 fake GatewayClient**（实现 `call` 和 `on`）：
  - chat.user envelope → bot 调 `gatewayClient.call('chat.send', ...)` with expected params
  - 触发 fake `chat` event with `state:'delta'` → onOutgoingEnvelope 被调，envelope.type=`chat.agent.delta`，解密后 payload 包含 `openclawMessage` 和 `runId`
  - 触发 `state:'final'` → envelope.type=`chat.agent.final`，bot.activeRunId 清空
  - 触发 `state:'error'` → envelope.type=`chat.agent.error`，payload 包含 errorMessage
  - 发第二条 chat.user 而 activeRunId 还在 → 先调 `chat.abort` 再 `chat.send`
  - seq 单调递增（1, 2, 3...）
  - encrypted=false 或 type 非 chat.user* → 不调 gateway

### 3. 手动 smoke（在 Outcome 记录一次真跑）

```bash
# 终端 A: relay
pnpm --filter @koko/relay start

# 终端 B: 确认 OpenClaw Gateway 在跑
openclaw gateway status        # 期望: Runtime: running

# 终端 C: 起 koko-cli
node packages/koko-cli/dist/index.js start

# 期望终端 C 的输出包含：
# 🦞 KokoChat CLI (dev)
# relay: http://localhost:8080
# device key: ...
# (log) "OpenClaw identity resolved"
# ✓ OpenClaw Gateway connected (session: agent:main:main)
# <QR>
# <koko://pair?k=...>
# waiting for APP to scan...

# 终端 D: 模拟 APP（用 smoke-attach-as-app.mjs 的改版）
node scripts/smoke-attach-as-app.mjs \
  --qr-url "<从 C 的 log 抓>" \
  --message "你好，请用一句话介绍你自己"

# 期望终端 D 收到至少一个 envelope，type=chat.agent.final 或多个 delta 最后 final
# 解密后 openclawMessage.content 里有 text，不是 "ECHO: ..."
```

实际上 smoke-attach-as-app.mjs 只等一个 envelope 就 exit，不能处理流式——**但本任务不要求改它**（Task 04 的 RN APP 会正确处理 delta）。手动 smoke 里能看到**至少一个** envelope 送到 APP 侧就算过。

### 4. 代码质量

- 所有新 export 带 TSDoc
- 无 `any`（必要时加注释）
- 所有 OpenClaw 相关 log 在 `module: "openclaw"` 子 logger 下
- seed 不能出现在任何 log（敏感）

## 禁止事项

- 不改 `@koko/protocol` / `@koko/relay` / `@koko/openclaw-client`
- 不改 `DECISIONS.md` / `IDEA.md` / `WORKFLOW.md` / 上游 tasks/*.md
- 不 spawn `openclaw agent`（用 GatewayClient.call）
- 不做 auto-update OpenClaw device pairing（用户 OpenClaw 没 pair 就报错退出）
- 不 git commit
- 不改 placeholder session key（仍是 `new Uint8Array(32).fill(42)`，Task 04 才换）

## 设计上的"为什么"

1. **为什么启动时连 Gateway 而不懒连**：fail fast。Gateway 没跑 / paired.json 没 token / main session 不存在，启动就报错，用户立刻知道要 `openclaw gateway start` 或重新 pair。否则用户发了第一条消息才报错，体验差。
2. **为什么读 OpenClaw 自己的 device.json 而不让 koko-cli 自己 pair Gateway**：OpenClaw Gateway 的 pairing 流程复杂（operator approval 工作流），MVP 阶段复用已有的是最稳的。未来 `koko-cli pair` 可以做独立 pairing，现在不做。
3. **为什么加密完整 message 对象**：OpenClaw message 是富结构（content blocks + attachments + timestamp），现在丢掉未来不好补。加密整包、APP 侧自己选展示方式，扩展性最好。
4. **为什么 seq 由 bot 维护而非调用方**：bot 代表一次完整的 openclaw 对话会话，sequence 就是它自己的业务语义。调用方不需要关心。
5. **为什么 sessionKey 不是 sessionId**：OpenClaw `chat.send` 接受 sessionKey（形如 `agent:main:main`）来复用 session，sessionId 是具体一次 turn 的。我们要长期复用 main session → 用 sessionKey。

## Outcome

完成时间：2026-04-28

实际改动：
- `packages/koko-cli/src/openclaw/` 新增 `identity.ts` / `sessionLookup.ts` / `bot.ts` / `index.ts`。
- `identity.ts` 按已验证的 PKCS8 Ed25519 16+32 字节偏移提取 seed，并按 deviceId 从 `paired.json` 查 operator token。
- `sessionLookup.ts` 调 `openclaw sessions --json --agent main`，验证 `agent:main:main` 存在并返回 session metadata。
- `bot.ts` 新增 `OpenClawBot`：解密 `chat.user*` JSON payload，调用 `chat.send`，监听 Gateway `chat` delta/final/error event，转成加密 `chat.agent.*` envelope；第二条消息会先 `chat.abort`。
- `config.ts` 新增 OpenClaw Gateway/identity/paired/binary 配置与 env override。
- `start.ts` 从 echo bot 切到 OpenClaw Gateway：启动时解析 OpenClaw identity/token/session，连接 `GatewayClient`，pair APP 后使用 `OpenClawBot`；cleanup 顺序为 bot abort → Gateway disconnect → relay close。
- `start.integration.test.ts` 保留真实 relay/pairing 路径，但用手写 fake GatewayClient，避免测试连接真实 OpenClaw Gateway。
- 新增 `openclaw.identity.test.ts`、`openclaw.sessionLookup.test.ts`、`openclaw.bot.test.ts`。

偏离：
- `OpenClawBotOptions.gatewayClient` 使用 `Pick<GatewayClient, "call" | "on">` 的窄接口，生产仍传真实 `GatewayClient`，测试可传手写 fake。
- `loadOpenClawDeviceSeed` 额外返回 `publicKey` base64url，便于用任务书真实向量断言；不影响既定 `seed/deviceId/publicKeyPem` 契约。
- 未连接真实 OpenClaw Gateway 做手动 smoke，按本任务约束和当前沙箱限制不做真 Gateway 测试。

验证：
- `pnpm --filter @koko/cli typecheck` 通过。
- `pnpm --filter @koko/cli build` 通过。
- `pnpm --filter @koko/cli exec vitest run test/identity.test.ts test/bot.echo.test.ts test/openclaw.identity.test.ts test/openclaw.sessionLookup.test.ts test/openclaw.bot.test.ts` 通过：5 files / 24 tests。
- `pnpm --filter @koko/cli test` 未能在当前沙箱完整通过：既有 `pairing.flow.test.ts` 和 `start.integration.test.ts` 启动本地 relay 时失败 `listen EPERM: operation not permitted 127.0.0.1`。新增 OpenClaw 测试和 echo bot 5 个测试均已在同次输出中通过。

遗留疑点：
- 需要在允许本地监听的环境重跑完整 `pnpm --filter @koko/cli test`。
- 需要在本机 OpenClaw Gateway 运行时做一次真实 APP smoke，确认 OpenClaw 事件 payload 的实际字段名与当前 `message/errorMessage` 兼容。

---

### Claude 本地复跑 + 真实 Gateway smoke — 2026-04-28 / 29

**1. 本地完整验收**

```bash
pnpm --filter @koko/cli typecheck   # 0 errors ✓
pnpm --filter @koko/cli test        # 28/28 passed ✓
pnpm --filter @koko/cli build       # dist/index.js 33.89 KB ✓
```

**2. 真实 Gateway smoke 发现的协议约束**（codex 不可能在沙箱里碰到）

第一次启动 `koko-cli start` 连真 Gateway 时，Gateway 拒绝握手：

```
HandshakeFailedError: invalid connect params: at /client/id: must be equal to one of the allowed values
```

**根因**：OpenClaw Gateway 对 `connect` 请求的 `client.id` / `client.mode` 做了 **allow-list 校验**，不是任意字符串。codex 的实现写死 `client: { id: "koko-cli", ..., mode: "cli" }`，被拒。

**解决**：paired.json 里每个已 pair 的 device 都有 `clientId` 和 `clientMode` 字段（是**它 pair 时 Gateway 批准的值**）。Komako 机器上 paired.json：

| deviceId | clientId | clientMode |
|---|---|---|
| 27edfbe8... (koko-cli 复用这一个) | `cli` | `probe` |
| aabd19c7... (Gateway 自己的 UI) | `gateway-client` | `ui` |

修复：
- `packages/koko-cli/src/openclaw/identity.ts` 新增 `loadOpenClawPairedDevice()` 返回 `{ token, clientId, clientMode }`，不止 token
- `packages/koko-cli/src/start.ts` 用 `openClawPaired.clientId` / `.clientMode` 作为 GatewayClient 的 `client.id` / `client.mode`
- 保留 `loadOpenClawOperatorToken` 和 `StartOpenClawRuntime.loadOperatorToken` 作为 backwards-compatible alias（测试 fake 无需全改）
- `tests/start.integration.test.ts` 的 fake runtime 同时提供 `loadPairedDevice`

**3. 第二个真实 smoke 发现的问题**（Bot 解析 payload 太严）

APP 侧 smoke 脚本发送明文 `"用一句话介绍你自己"` 的 utf8 加密字节，但 bot 原实现只接受**合法 JSON**（期望 string literal 或 `{text}` / `{message}` 对象）。非 JSON 被当成"不支持 payload"直接丢弃。

修复：`packages/koko-cli/src/openclaw/bot.ts` 的 `parseIncomingText` 在 JSON parse 失败时 fallback 到"当作 UTF-8 纯文本"。更宽容，未来 APP 也不必 JSON.stringify 包一层才能发简单消息。

**4. 第三个 smoke helper 改动**

`scripts/smoke-attach-as-app.mjs` 原来只等一个 envelope（echo 时代够用），现在扩成**循环收 delta**，拼接 `openclawMessage.content[].text`，直到遇到 `chat.agent.final` 或 `.error`。兼容 legacy ECHO 模式。

**5. 真实端到端 smoke 结果**

```
[app] relay=http://localhost:8080 qr k=JdlEEVVLHA... message="用一句话介绍你自己"
[app] paired, roomId=ba13216d-...
[app] hello-ok, waiting for CLI to join...
[app] CLI joined
[app] -> envelope "用一句话介绍你自己"
[app] ∆ 我是[app] ∆ 小白，一只随意但认真、会读文章也会陪你拆问题的全能陪伴型 AI。
[app] ✓ final: "我是小白，一只随意但认真、会读文章也会陪你拆问题的全能陪伴型 AI。"

✅ Final text received from OpenClaw.
```

**端到端 chain 全部打通**：APP → XChaCha20 加密 envelope → relay HTTP/WS pairing → @koko/relay 转发 → koko-cli 解密 → @koko/openclaw-client Protocol v3 握手（clientId/mode 从 paired.json 拿）→ OpenClaw Gateway chat.send → Claude 流式生成 → delta/final event → koko-cli 包装加密 envelope → relay 转发 → APP 解密 + 拼 delta → 展示。

Ctrl+C 依次清理：`peer-left` → `OpenClaw status: disconnected` → `stopped`。

### 最终改动文件清单（03c 全程）

codex 新建：
- `packages/koko-cli/src/openclaw/{index,identity,sessionLookup,bot}.ts`
- `packages/koko-cli/test/openclaw.{identity,sessionLookup,bot}.test.ts`

codex 修改：
- `packages/koko-cli/src/config.ts`（加 openclaw 相关字段）
- `packages/koko-cli/src/start.ts`（接 GatewayClient + OpenClawBot）
- `packages/koko-cli/test/start.integration.test.ts`（fake runtime）
- `packages/koko-cli/package.json`（加 @koko/openclaw-client dep）

Claude 补丁：
- `packages/koko-cli/src/openclaw/identity.ts`（加 `loadOpenClawPairedDevice` + `OpenClawPairedDeviceInfo`）
- `packages/koko-cli/src/openclaw/bot.ts`（`parseIncomingText` 接受纯文本 fallback）
- `packages/koko-cli/src/openclaw/index.ts`（re-export 新增的）
- `packages/koko-cli/src/start.ts`（用 paired device 的 clientId/clientMode）
- `packages/koko-cli/test/start.integration.test.ts`（fake runtime 加 `loadPairedDevice`）
- `scripts/smoke-attach-as-app.mjs`（delta 循环收取 + OpenClaw payload 解码）

### 工作流反思

- codex 在没法真正连真 Gateway 的沙箱里，不可能发现 "allow-list clientId" 约束——这属于**只能通过真机 smoke 才暴露的协议约束**。Claude 本地 smoke 抓到、诊断、修复。
- 但 codex 的代码**结构**（dependency injection 的 `StartOpenClawRuntime`）让 Claude 补丁非常顺——加一个 `loadPairedDevice` helper + 改 `start.ts` 两处就行，测试 fake 加一行。好架构的价值在这种时候体现。
