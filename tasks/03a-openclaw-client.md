# Task 03a — `@koko/openclaw-client` Gateway Protocol v3 TypeScript 客户端

> 状态: pending
> 负责: codex
> 创建: 2026-04-29
> 依赖: Task 01（`@koko/protocol`）已完成
> 上游文档: [`../IDEA.md`](../IDEA.md), [`../DECISIONS.md`](../DECISIONS.md), [`../WORKFLOW.md`](../WORKFLOW.md), [`./01-protocol-init.md`](./01-protocol-init.md)

---

## 目标

一句话：实现 `packages/koko-openclaw-client`——一个纯 TypeScript 的 OpenClaw Gateway Protocol v3 客户端。它是下一步 `@koko/cli` 的核心依赖，负责连 `ws://127.0.0.1:18789`、完成 challenge-response 握手、管理 request/response 相关性、订阅 event 流，把 OpenClaw 的流式 agent 响应透传给调用方。

本任务**不涉及** `@koko/cli`、不涉及 `@koko/relay`、不涉及 RN。

## 背景上下文

**必读**：
- [`../DECISIONS.md`](../DECISIONS.md) 的 "2026-04-29 新增" 段（决定全背景）
- [`../DECISIONS.md`](../DECISIONS.md) 的 "环境资源（本机，2026-04-29 确认）" 段（真实环境信息）
- [`./01-protocol-init.md`](./01-protocol-init.md) 的 `## Outcome` 段（`@koko/protocol` 能用的 API）

**权威协议参考**：[`ngmaloney/clawchat/src/lib/gateway-client.ts`](https://github.com/ngmaloney/clawchat/blob/main/src/lib/gateway-client.ts)。这份 420 行 TS 实现是**直接目标**——你要把它基本等价地搬到 Node 端，调整 RN 兼容性 + 加强类型 + 加单元测试。

**相关辅助参考**：
- ngmaloney 的 `src/hooks/useChat.ts` 展示了 `call('chat.send', ...)`、`chat.history`、`chat.abort` 和 `event 'chat'` 的具体用法
- `src/lib/device-crypto-ed25519.ts` 的 Ed25519 签名逻辑——但**我们不复制他的实现**，改用 `@koko/protocol` 的 `signingKeypairFromSeed` / `signChallenge` helper，保证两端（cli 和未来的 RN app）加密栈统一

## 输入契约

### 依赖的仓库状态

- `@koko/protocol` 已完成（Task 01 Outcome 已列 API）
- pnpm monorepo 已存在
- `packages/koko-openclaw-client/` 目录已创建、仅有 `README.md`
- 根 `package.json` 定义了 `build/dev/test/typecheck` 脚本约定（参考 `packages/koko-protocol` 和 `packages/koko-relay` 的写法）

### 依赖（可装）

```jsonc
"dependencies": {
  "@koko/protocol": "workspace:*",
  "@noble/ed25519": "^2.x",
  "@noble/hashes": "^1.x",
  "ws": "^8.x"
},
"devDependencies": {
  "@types/node": "^25.x",
  "@types/ws": "^8.x",
  "tsup": "^8.x",
  "typescript": "^5.x",
  "vitest": "^3.x"
}
```

**禁止**：
- 不依赖 `libsodium-wrappers`（改用 `@noble/ed25519`，详见"依赖 `@koko/protocol` 的具体 API"段下的说明）
- 不依赖 `pino` / `fastify`（协议库不该带重依赖；log 用一个可注入的 `Logger` 接口，由调用方提供）
- 不依赖 `tweetnacl`、`sodium-native`、`node:crypto.subtle`（选单一 `@noble/ed25519`）
- 不依赖任何特定的事件库（`EventEmitter` 直接用 `node:events`）

### 依赖 `@koko/protocol` 的具体 API

```ts
import {
  initCrypto,
  signingKeypairFromSeed,    // 从 32B seed 派生 Ed25519 keypair（会用）
  // 其他 API 不直接用
} from "@koko/protocol";
```

**注意**：`@koko/protocol` 的 `signChallenge(challenge, kp)` 限制 challenge 必须 32 字节（设计时是给 koko-relay 自己的 pairing 用）。**OpenClaw Gateway 的签名 message 是可变长字符串**，不能直接复用 `signChallenge`。

**解决**：本包在 `src/device.ts` 里**自己**用 libsodium 调 `crypto_sign_detached(message, secretKey)` 签任意长度 message。为此需要从 `@koko/protocol` export 的 `signingKeypairFromSeed` 拿到 keypair（secretKey 64B），然后直接 import 底层 libsodium。

**但 `@koko/protocol` 没 export libsodium 实例**——所以本任务允许**额外** `import sodium from "libsodium-wrappers"`（沿用 @koko/protocol 里同样的 CJS-via-createRequire 加载方式绕过 packaging bug，见 `packages/koko-protocol/src/crypto/sodium.ts`）。

也可以用 `@noble/ed25519` 代替 libsodium 来做签名（ngmaloney 就是这么做的）——加密学上等价，而且 `@noble/ed25519` 纯 JS、无需初始化、纯 ESM、零 bundler 兼容性顾虑。**推荐用 @noble/ed25519**。这样本包依赖里要加：

```jsonc
"dependencies": {
  "@koko/protocol": "workspace:*",
  "@noble/ed25519": "^2.x",
  "@noble/hashes": "^1.x",    // for sha256
  "ws": "^8.x"
}
```

这样 `src/device.ts` 用 `@noble/ed25519` + `@noble/hashes/sha256` 完全独立实现 device identity，不走 @koko/protocol。但 **@koko/protocol 仍然要列为 dep** 以保持 workspace 一致性和未来可能共享其他工具。

实际上，**本任务的最简方案**是：`src/device.ts` 完全用 `@noble/ed25519` + `@noble/hashes/sha256`，`@koko/protocol` 本轮**不真实 import**（但仍列为 dep，方便未来）。

### 运行环境

- Node.js 20+（可用 `node:events`、`ws`、`globalThis.crypto` 等）
- **不** 设计 browser / RN 兼容版（未来 RN 要用时再加适配层）。本任务专注 Node 端。

## 输出契约

### 目录结构

```
packages/koko-openclaw-client/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── README.md             # 已存在
├── src/
│   ├── index.ts          # re-export
│   ├── client.ts         # GatewayClient 主类
│   ├── frames.ts         # 协议 frame 类型定义 + zod schema（可选 runtime 校验）
│   ├── device.ts         # Ed25519 identity 管理：生成/加载 seed + signChallenge wrapper
│   ├── handshake.ts      # connect.challenge → connect req → hello-ok 流程
│   ├── errors.ts         # 自定义 error 类
│   └── types.ts          # 公开类型（ConnectionStatus、ChatEvent、ChatHistoryResponse 等）
└── test/
    ├── client.handshake.test.ts      # 握手流程（用 mock WS）
    ├── client.call.test.ts           # req/res 相关性、超时、error
    ├── client.events.test.ts         # event 订阅 / 取消 / 多订阅者
    ├── client.reconnect.test.ts      # 断线重连 + 指数退避
    ├── device.test.ts                # Ed25519 sign 向量
    ├── frames.test.ts                # frame zod / type 正确性
    └── helpers/
        └── mockWsServer.ts           # 用 ws 真起一个本地 server 做端到端 mock
```

### `package.json`（必要字段）

```jsonc
{
  "name": "@koko/openclaw-client",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "tsc --noEmit"
  },
  "dependencies": { ... },
  "devDependencies": { ... }
}
```

### 协议 frame 格式（抄自 ngmaloney）

所有 wire 格式都是 JSON text。三种 frame：

```ts
// 客户端 → 服务器（请求）
interface RequestFrame {
  type: "req";
  id: string;            // 客户端自增生成，服务器 res 会带同 id
  method: string;        // "connect", "chat.send", "chat.history", "chat.abort", ...
  params?: Record<string, unknown>;
}

// 服务器 → 客户端（响应）
interface ResponseFrame {
  type: "res";
  id: string;
  ok: boolean;
  payload?: Record<string, unknown>;   // ok=true 时
  error?: { code: string; message: string };  // ok=false 时
}

// 服务器 → 客户端（事件，主动推送）
interface EventFrame {
  type: "event";
  event: string;         // "connect.challenge", "connect.welcome", "chat", "agent", "tick", ...
  payload: Record<string, unknown>;
}

type Frame = RequestFrame | ResponseFrame | EventFrame;
```

**OpenClaw 侧的 event 名字和 payload 结构**——我们**不要**对每个 event 的 payload 做 zod 硬绑定，因为 OpenClaw 协议可能变动。只在 `connect.challenge` 和 handshake 的 `hello-ok` 做硬绑定，其他 event payload 用 `Record<string, unknown>` 透传给 consumer。

### 公开 API（以下 export 必须存在）

```ts
// src/index.ts re-export 下面所有东西

// ── 类型 ──

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "handshaking"
  | "connected"
  | "error";

export type BackendType = "openclaw" | "channel";

// OpenClaw Protocol v3 的身份字段
export interface DeviceIdentity {
  id: string;           // hex(sha256(publicKey))
  publicKey: string;    // base64url
  signature: string;    // base64url(Ed25519 signature over canonical payload)
  signedAt: number;     // epoch ms
  nonce: string;        // 从 connect.challenge 收到的 nonce 原样带回
}

// 构造选项
export interface GatewayClientOptions {
  /** ws:// 或 wss:// URL。不含 query，token 由 client 自动 append */
  url: string;
  /** operator token（从 ~/.openclaw/devices/paired.json 读到，或其他渠道） */
  token: string;
  /** 可选：hello-ok 返回过 deviceToken 的话，重连时带上可以免再次 challenge */
  deviceToken?: string;
  /** 可选：长期持有的设备 Ed25519 seed（32B）。不给就 ephemeral keypair（每次连接新 keypair）*/
  deviceSeed?: Uint8Array;
  /** 可选：client 元数据，发给 server 的 client 字段 */
  client?: {
    id: string;        // 默认 "koko-cli"
    version: string;   // 默认 "dev"
    platform: string;  // 默认 process.platform
    mode: string;      // 默认 "cli"
  };
  /** 可选：backend 类型，默认 "openclaw" */
  backend?: BackendType;
  /** 可选：最大重连次数，默认 10 */
  maxRetries?: number;
  /** 可选：单个 request 超时，默认 30_000 ms */
  requestTimeoutMs?: number;
  /** 可选：注入 log。默认 noop */
  logger?: Logger;
  /** 状态变化回调 */
  onStatusChange?: (status: ConnectionStatus) => void;
  /** hello-ok 发回来 deviceToken 时触发（调用方可持久化它） */
  onDeviceToken?: (token: string) => void;
}

// 极简 logger 接口（可注入 pino / console / noop）
export interface Logger {
  trace: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

// ── 主类 ──

export declare class GatewayClient {
  constructor(options: GatewayClientOptions);

  /** 当前连接状态 */
  getStatus(): ConnectionStatus;

  /** 最近一次 hello-ok 中 server 声明的最大 payload 字节数 */
  getMaxPayload(): number;

  /** 连接。异步返回，status 稳定 'connected' 时 resolve；失败 reject */
  connect(): Promise<void>;

  /** 主动断开，不会重连 */
  disconnect(): Promise<void>;

  /**
   * 发 req，等 res。
   * status !== 'connected' 时（除非 method === 'connect'）会 reject。
   */
  call(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;

  /** 订阅 event，返回 unsubscribe fn */
  on(event: string, callback: (payload: Record<string, unknown>) => void): () => void;

  /** 取消特定订阅（等价于 on 返回的 fn） */
  off(event: string, callback: (payload: Record<string, unknown>) => void): void;
}

// ── 错误 ──

export class GatewayError extends Error {
  code: string;
  constructor(code: string, message: string);
}

export class HandshakeTimeoutError extends GatewayError {}
export class HandshakeFailedError extends GatewayError {}
export class RequestTimeoutError extends GatewayError {}
export class NotConnectedError extends GatewayError {}
export class FatalCloseError extends GatewayError {
  closeCode: number;
  constructor(closeCode: number, reason: string);
}

// ── src/device.ts 导出（内部用，但也作为顶层 re-export 给 consumer 调试用） ──

/**
 * v2 签名 payload 拼装规则（OpenClaw Gateway Protocol v3 硬编码）：
 *   "v2|<deviceId>|<clientId>|<clientMode>|<role>|<scopes_csv>|<signedAtMs>|<token_or_empty>|<nonce>"
 */
export function buildSignaturePayload(args: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string | null;
  nonce: string;
}): string;

/** 给定 seed 派生 publicKey（base64url）和 deviceId（hex sha256 of 32B publicKey） */
export function deriveDeviceIdentity(seed: Uint8Array): Promise<{
  publicKey: string;   // base64url, no padding
  deviceId: string;    // hex(sha256(publicKey bytes))
}>;

/** 给定 seed + payload 字符串，返回 Ed25519 签名（base64url, no padding） */
export function signDevicePayload(seed: Uint8Array, payload: string): Promise<string>;
```

### 行为规范

#### 1. 握手流程（完整）

```
ws.open
  ↓
setStatus('handshaking')
  ↓
等待 event: 'connect.challenge' { nonce }
  ↓ 收到后：
用 deviceSeed（或临时生成一个）派生 Ed25519 signing keypair
deviceId = hex(sha256(publicKey 的 raw 32B))
构造 canonical v2 signature payload（注意：**不是 JSON**，是管道分隔字符串）：
  "v2|<deviceId>|<clientId>|<clientMode>|<role>|<scopes_csv>|<signedAtMs>|<token_or_empty>|<nonce>"
  其中：
    - scopes_csv: scopes 数组用 "," join（不加空格）
    - signedAtMs: Date.now() 字符串化
    - token_or_empty: opts.token（永远非空，我们始终传 token）
    - nonce: 原样从 challenge 事件带出
用 Ed25519 签这个字符串（UTF-8 bytes），得 signature（base64url）
publicKey 也编码为 base64url
  ↓
发 req connect {
  role, scopes, auth: { token, deviceToken? },
  device: { id: deviceId, publicKey, signature, signedAt: signedAtMs, nonce },
  client, minProtocol: 3, maxProtocol: 3
}
  ↓
等 res（带同 id）：
  - ok && payload.type === 'hello-ok' →
      更新 maxPayload（from payload.snapshot.policy.maxPayload）
      保存 deviceToken（from payload.auth.deviceToken）通知 onDeviceToken
      setStatus('connected')
      resolve connect() promise
  - ok === false 或 payload.type !== 'hello-ok' →
      throw HandshakeFailedError
  ↓
超时（requestTimeoutMs）：throw HandshakeTimeoutError
```

**签名格式参考**：[ngmaloney/clawchat src/lib/device-crypto-ed25519.ts](https://github.com/ngmaloney/clawchat/blob/main/src/lib/device-crypto-ed25519.ts) 的 `buildSignaturePayload`。**这个 "v2|...|..." 格式是 OpenClaw Gateway 硬编码要求的**，不要改。

**URL 加 token**：`${url}?token=<encodeURIComponent(token)>`（若 url 已带 `?` 则用 `&`）。WS upgrade 阶段 Gateway 根据 token 决定是否给 challenge。

#### 2. ephemeral vs persistent device

- 如果 opts 传了 `deviceSeed`：长期持有，每次重连用同一个 publicKey，Gateway 能识别
- 如果没传：`generateMasterSecret()` 每次新 seed，临时身份。但注意：**这样做的话 Gateway 可能不 trust（未 paired）**，推荐调用方提供 seed

本包**不**做 seed 持久化（存磁盘是 @koko/cli 的职责），只接受传入。

#### 3. 重连策略

- `ws.close` 时：
  - 4xxx close code（4000-4999）：视为 fatal，不重连，setStatus('error')
  - 1008 (Policy Violation)：视为 fatal
  - 其他：指数退避重连（1s → 2s → 4s → ... cap 30s），最多 `maxRetries` 次
  - `intentionalClose=true`（disconnect() 调用）：不重连
- 重连时**重走**完整握手
- 重连期间 pending 的 `call(...)` 全部 reject（reason: "WebSocket closed"）

#### 4. request/response 相关性

- 生成 id：`pd-${counter}`（counter 递增，per-instance）
- `call()` 发 req 后把 `{ resolve, reject, timer }` 存 `pending` map，key = id
- 收 res 时按 id 路由
- 超时（requestTimeoutMs）：reject + delete from map
- `ws.close` 时：全部 pending 统统 reject

#### 5. event 订阅

- 内部 `Map<event, Set<callback>>`
- 特殊处理：
  - `connect.challenge`：**不**分发给 consumer，内部握手专用
  - `connect.welcome`（channel backend）：同上，直接 setStatus('connected')
  - 其他 event：分发给 consumer + 触发 `onEvent`（如果有，MVP 先不加这个选项）
- consumer 回调抛错：logger.error 吞掉，不影响其他订阅者

#### 6. logger 契约

- logger 是**可选**的。默认 noop
- 握手、连接状态变化、重连、request 异常都要 log
- **不**打印 token / device private key（安全敏感）
- Level 用约定的 trace/debug/info/warn/error

## 验收标准

### 1. 基础命令

```bash
pnpm install --no-frozen-lockfile
pnpm --filter @koko/openclaw-client typecheck   # 0 errors
pnpm --filter @koko/openclaw-client build       # dist/index.js 产出
pnpm --filter @koko/openclaw-client test        # 全绿
```

### 2. 测试覆盖（按分类）

#### `device.test.ts`
- 给定固定 seed（32B），派生的 publicKey 稳定（Ed25519 determinism，@noble/ed25519 `getPublicKey(seed)` 的行为）
- `deviceId = hex(sha256(publicKey raw 32B))`，长度 64 字符，小写 hex
- `signDevicePayload(seed, payload_string)` 对同一 seed + 同一 payload 产出稳定 signature
- `buildSignaturePayload({deviceId, clientId, clientMode, role, scopes, signedAtMs, token, nonce})` 返回字符串 `"v2|<deviceId>|<clientId>|<clientMode>|<role>|<scope1,scope2,...>|<signedAtMs>|<token>|<nonce>"`
- scopes 空数组 → csv 部分是空字符串（两个竖线中间没内容）
- token 是 null → csv 部分为空字符串

#### `frames.test.ts`
- RequestFrame/ResponseFrame/EventFrame 的 TS 类型能正确 narrow
- 如果你实现了 runtime zod 校验：校验 reject 非法 frame（不是必须，根据你实现判断）

#### `client.handshake.test.ts`（用 `test/helpers/mockWsServer.ts`）
- server 发 `connect.challenge { nonce }` → client 发 `req connect {..., device}` → server 回 `res ok { type: 'hello-ok', ... }` → `connect()` promise resolve，status === 'connected'
- server 回 `res ok { type: 'not-hello-ok' }` → throw HandshakeFailedError
- server 不回 res → 超时后 throw HandshakeTimeoutError
- server 直接 close（1008）→ setStatus('error')，不重连
- server 发的 `res` payload 里有 `snapshot.policy.maxPayload` → `getMaxPayload()` 返回该值
- server 发的 `res` payload 里有 `auth.deviceToken` → `onDeviceToken` 回调被触发

#### `client.call.test.ts`
- 连接后 `call('foo', { x: 1 })` → server 收 req id=pd-1 method='foo' params={x:1} → server 回 res ok {y: 2} → resolve {y: 2}
- 同时发两个 call → server 两个不同 id → 相互不干扰
- server 回 res ok=false { error: { code, message } } → reject with GatewayError
- client 没连接（status='disconnected'）时 `call(...)` → reject with NotConnectedError
- 超时：server 不回 → RequestTimeoutError 后 pending 清理

#### `client.events.test.ts`
- server 发 `event chat { delta }` → 订阅者收到 payload
- 两个订阅者 → 都收到
- unsubscribe 后不再收到
- 订阅者抛错 → 不影响其他订阅者（logger.error 能被测到，可选）
- `connect.challenge` 事件**不**分发给 consumer（订阅它也不会触发，这是内部专用）

#### `client.reconnect.test.ts`
- server 意外关（close code 1006）→ client 1s 后重连（用假时钟或加速重连测）
- 重连时重新握手
- 连续 2 次失败后延迟 2s（指数退避）
- 超过 maxRetries 后 setStatus('error')，不再尝试
- `disconnect()` 后不重连
- close code 4xxx → 不重连（fatal）

### 3. mockWsServer 工具质量

- 用 `ws.WebSocketServer` 在 loopback 随机端口起
- 支持注入"收到 req 时发什么"和"主动推 event"
- teardown 一定关掉 ws + server，不留 dangling connection

### 4. 代码质量

- 所有公开 export 带 TSDoc
- 无 `any`（mockWsServer 里内部可宽松，但公开 API 不行）
- 无 `console.log`；log 全走 injected logger
- 无死代码 / TODO（有就迁 Outcome）

### 5. 不跑"真的 OpenClaw"

**本任务完全用 mock WS server 测试，不去连真的 `ws://127.0.0.1:18789`**。真实连接留给 Task 03c。
如果 codex 想 smoke 一下真 gateway，可以在 Outcome 里写"附加手动测试"一节记录观察，但**不是验收标准的一部分**。

## 禁止事项

- **不要**改 `@koko/protocol`、`@koko/relay`、`apps/`
- **不要**引入非本任务书列出的依赖
- **不要**做：
  - session 持久化（seed 落地）
  - OpenClaw CLI spawn
  - APP 协议集成
  - relay 协议集成
  - RN browser 兼容层
  - pino 日志（用注入式 Logger）
- **不要**改 `DECISIONS.md` / `IDEA.md` / `WORKFLOW.md` / 其他 `tasks/` 文件
- **不要** git commit
- **不要**凭空猜测 OpenClaw 某些 event 的 payload 结构（我们不硬绑定）

## 设计上的"为什么"

1. **为什么独立包而非 koko-cli 私有**：未来 RN APP 可能直连 Gateway（走 Tailscale 之类），包独立 = 复用自然。
2. **为什么 logger 注入**：@koko/cli 会用 pino，但测试想用 console/noop。注入最简。
3. **为什么不做 browser/RN 兼容**：每个平台 ws global 对象不同（`ws` npm 包 vs `globalThis.WebSocket`），Node 端先跑通，移植放后面。
4. **为什么 deviceSeed 可选**：让 koko-cli 掌控持久化，Task 03b 决定用 `~/.koko-cli/device.key` 之类。本包只做协议层。
5. **为什么不硬绑定 event payload**：OpenClaw 协议细节可能变，绑死就脆。consumer（koko-cli）自己解释 payload。
6. **为什么 mock WS 而不 mock WebSocket 对象**：真起个 ws server 测试端到端 I/O 流更真实，少踩假 mock 的坑。

## Outcome

> 状态: ⚠️ **实现完成，WS 端到端测试受沙箱 listen 限制未能本机跑完** — 2026-04-28
>
> 由 codex 完成。未 git commit。

### 实际改动清单

新建/实现 `packages/koko-openclaw-client`：

- 构建配置：`tsconfig.json`、`tsup.config.ts`、`vitest.config.ts`
- 源码模块：
  - `src/types.ts`：公开类型、`Logger`、`GatewayClientOptions`、`ChatEvent`、`ChatHistoryResponse`
  - `src/errors.ts`：`GatewayError`、`HandshakeTimeoutError`、`HandshakeFailedError`、`RequestTimeoutError`、`NotConnectedError`、`FatalCloseError`
  - `src/frames.ts`：`req/res/event` frame 类型、手写 runtime 校验、JSON parse/serialize
  - `src/device.ts`：`@noble/ed25519` + `@noble/hashes/sha2` 派生 public key/deviceId，签 v2 payload，base64url 编码
  - `src/handshake.ts`：默认 role/scopes/client metadata、`connect.challenge` 判定、`connect` params 构造、`hello-ok` 提取
  - `src/client.ts`：WebSocket 连接、challenge-response 握手、req/res 相关性、event 订阅、超时、fatal close、指数退避重连
  - `src/index.ts`：顶层 re-export
- 测试：
  - `test/helpers/mockWsServer.ts`：真实 `ws.WebSocketServer` 随机 loopback 端口 mock
  - 6 个契约测试文件：`device`、`frames`、`client.handshake`、`client.call`、`client.events`、`client.reconnect`

### 偏离 / 说明

- `GatewayClientOptions` 额外支持 `role`、`scopes`、`reconnectBaseDelayMs`、`reconnectMaxDelayMs`。默认值仍按任务书执行；额外选项用于调用方覆盖和测试加速，不改变要求的公开 API。
- 按任务书推荐，`device.ts` 完全使用 `@noble/ed25519` / `@noble/hashes`，没有 import `@koko/protocol`。
- 当前沙箱无法访问 `raw.githubusercontent.com`：`curl` 报 `Could not resolve host: raw.githubusercontent.com`，web raw 打开也无内容返回。因此实现以本任务书摘出的握手流程、v2 payload 格式和公开 API 为硬约束。
- 按用户第 10 步要求更新了本任务文件 Outcome；这是唯一位于 `packages/koko-openclaw-client/` 之外的改动。

### 跑通 / 尝试过的命令

```bash
pnpm --filter @koko/openclaw-client typecheck
pnpm --filter @koko/openclaw-client build
node -e "import('./packages/koko-openclaw-client/dist/index.js').then((m)=>console.log(m.buildSignaturePayload({deviceId:'d',clientId:'c',clientMode:'cli',role:'operator',scopes:[],signedAtMs:1,token:null,nonce:'n'})))"
```

结果：typecheck 0 errors；build 产出 `dist/index.js` / `dist/index.d.ts`；dist ESM 可被 Node 动态 import。

```bash
pnpm --filter @koko/openclaw-client test
```

结果：`device.test.ts` 和 `frames.test.ts` 通过，`client.*` 真实 WS 测试在当前沙箱全部因 `listen EPERM: operation not permitted 127.0.0.1` 失败。失败点发生在 mock server bind loopback 随机端口前，符合本任务提示的沙箱限制；需要 Claude/本机无沙箱环境复跑完整 test。

### 遗留疑点

- 未能在当前沙箱验证真实 WebSocket 握手/call/event/reconnect 测试；需要在允许 `127.0.0.1` listen 的本机环境运行 `pnpm --filter @koko/openclaw-client test`。
- 未连真实 `ws://127.0.0.1:18789`，符合任务书“不跑真的 OpenClaw”的要求。
