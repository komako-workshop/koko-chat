# Task 02 — `@koko/relay` 初始化

> 状态: pending
> 负责: codex
> 创建: 2026-04-28
> 依赖: Task 01（`@koko/protocol`）已完成
> 上游文档: [`../IDEA.md`](../IDEA.md), [`../DECISIONS.md`](../DECISIONS.md), [`../WORKFLOW.md`](../WORKFLOW.md), [`./01-protocol-init.md`](./01-protocol-init.md)

---

## 目标

一句话：搭起 `packages/koko-relay` 的**第一个可跑版本**——一个纯 Node WebSocket + HTTP 中继服务器，支持 pairing 流程 + room 建立 + 加密消息中转，用**内存 LRU**（24h / 1000 条）做未投递缓存，不依赖任何外部存储。跑完 `pnpm relay:dev` 后，两端（CLI 和 APP）可以按协议完成 pairing、进入 room、互相发送 envelope 而 relay 看不到明文。

本任务**不涉及** CLI、RN APP，也不涉及 OpenClaw 接入。只验证"服务器本身 + 协议端到端"跑得通。

## 背景上下文

**必读**：
- [`../DECISIONS.md`](../DECISIONS.md)——架构 / 协议层所有已定决定（技术栈、room 模型、加密算法、部署目标等）
- [`./01-protocol-init.md`](./01-protocol-init.md) 的 **Outcome** 段——上一步交付的 `@koko/protocol` API 表面
- [`../IDEA.md`](../IDEA.md)——产品背景

**关键约束**（DECISIONS.md 已明确，不要推翻）：
- 技术栈：Node.js 20+ / TypeScript / `ws`
- 信任模型：纯 room（1 APP ↔ 1 CLI）
- 存储：内存 LRU（24h / 1000 条），重启全丢
- TLS：**relay 不做 TLS**（裸 HTTP + WebSocket，让 nginx 反代处理 TLS）
- 加密：relay **看不到明文**，只转 envelope（envelope schema 在 `@koko/protocol`）

## 输入契约

### 依赖的仓库状态

- `@koko/protocol` 已完成并能 `import`（参考 task 01 Outcome）
- pnpm monorepo 已搭好
- `packages/koko-relay/` 目录已存在但只有 `README.md`

### 可用的外部依赖

- **`ws`** — WebSocket server（`@types/ws`）
- **`fastify`** — HTTP 路由（给 pairing REST 端点用）。理由：比 bare http/express 更好的 TypeScript / schema / 错误处理，体积可控。**如果你判断 bare http.createServer 够用也可以选 bare**，但必须在 Outcome 段说明理由。
- **`pino`** — 结构化 log（JSON 格式，方便将来对接日志系统）
- **`@koko/protocol`** — 通过 `workspace:*` 引用
- **`zod`** — schema 校验（@koko/protocol 已有）

**devDep**：
- `vitest`、`tsup`、`typescript`、`@types/node`
- `supertest` 或 `undici` —— 给 HTTP 端点做 integration test
- `ws` 的 client 形式（就是同一个 `ws` 包）给 WebSocket 端点做 integration test

**禁止**引入：数据库（SQLite / Redis）、外部 auth provider、APNs/FCM SDK（推送留给后续任务）、任何跟 OpenClaw 相关的依赖。

### 依赖 `@koko/protocol` 的具体 API

```ts
import {
  initCrypto,
  type Envelope, EnvelopeSchema, encodeEnvelope, decodeEnvelope,
  PROTOCOL_VERSION
} from "@koko/protocol";

// relay 需要用到 @koko/protocol 的：
// 1. initCrypto() 启动时调一次（虽然 relay 本身不加密，但用到 envelope schema 验证）
// 2. decodeEnvelope / encodeEnvelope 校验 wire format
// 3. PROTOCOL_VERSION 过滤旧客户端
//
// relay 不应该直接 import crypto/box、crypto/symmetric 等——
// 它不做加解密，它只转发 bundle。
```

## 输出契约

### 目录结构

```
packages/koko-relay/
├── package.json
├── tsconfig.json
├── tsup.config.ts             # 构建用
├── vitest.config.ts
├── README.md                  # 已存在，可扩写
├── src/
│   ├── index.ts               # 可执行入口：createServer().listen(...)
│   ├── server.ts              # createServer({ port, logger }) 工厂
│   ├── config.ts              # env 读取 + 默认值 + zod schema
│   ├── logger.ts              # pino 实例工厂
│   ├── pairing/
│   │   ├── index.ts
│   │   ├── store.ts           # pairing request 内存存储（Map + TTL）
│   │   ├── routes.ts          # Fastify routes: POST /v1/pair/request, /v1/pair/response
│   │   └── types.ts           # zod schemas for request / response bodies
│   ├── room/
│   │   ├── index.ts
│   │   ├── store.ts           # room 内存存储（Map + TTL + LRU 消息缓存）
│   │   ├── handler.ts         # WebSocket 连接处理：握手 / envelope 转发 / 断线清理
│   │   └── types.ts           # room state / envelope wrapping types
│   └── http/
│       ├── index.ts
│       └── health.ts          # GET /healthz
└── test/
    ├── pairing.flow.test.ts       # 端到端 pairing 流程 integration
    ├── pairing.errors.test.ts     # 边界 / 错误 case
    ├── room.flow.test.ts          # WebSocket 消息转发
    ├── room.offline.test.ts       # LRU 未投递缓存 + 重连投递
    ├── room.lifecycle.test.ts     # room 过期 / 断线清理
    └── helpers/
        ├── testServer.ts          # 启动 server + 返回 baseUrl + teardown
        └── wsClient.ts            # 轻量 ws client 封装（connect/send/recv/close）
```

### `package.json`

```jsonc
{
  "name": "@koko/relay",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "bin": {
    "koko-relay": "./dist/index.js"
  },
  "scripts": {
    "dev": "tsx src/index.ts",             // 或 tsup --watch + node dist/index.js，自己选
    "build": "tsup",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@koko/protocol": "workspace:*",
    "fastify": "^5.x",
    "pino": "^9.x",
    "ws": "^8.x"
    // zod 已是 @koko/protocol 间接依赖，不显式加
  },
  "devDependencies": { ... }
}
```

如果选 tsx 做 dev，加入 devDep。

### 配置（env）

```
KOKO_RELAY_PORT=8080              # 默认 8080
KOKO_RELAY_HOST=0.0.0.0           # 默认 0.0.0.0（容器内监听）
KOKO_RELAY_LOG_LEVEL=info         # pino level: trace/debug/info/warn/error
KOKO_RELAY_PAIRING_TTL_MS=300000  # pairing request 5 分钟过期
KOKO_RELAY_ROOM_TTL_MS=86400000   # room 24h 过期（无活动则清理）
KOKO_RELAY_ROOM_OFFLINE_QUEUE_MAX=1000  # 每 room 离线消息上限
KOKO_RELAY_ROOM_OFFLINE_QUEUE_TTL_MS=86400000  # 离线消息 24h TTL
```

所有 env 都用 `zod` 校验，带合理默认。config 模块 export `loadConfig(): Config`。

### 协议设计（HTTP + WebSocket）

#### HTTP endpoints

##### `GET /healthz`

```json
200 OK
{ "ok": true, "version": "0.0.1", "protocolVersion": 1, "uptimeMs": 12345 }
```

##### `POST /v1/pair/request`

由 CLI 调用。body:

```ts
{
  publicKey: string;    // base64url(ephemeral box public key, 32B)
  supportsProtocol: 1;  // CLI 声明支持的协议版本
}
```

行为：
- 如果 `publicKey` 已存在且未过期：
  - 如果有 `response`（APP 已 approve）：返回 `{ state: "authorized", roomId, response, ttlMs }`
  - 如果没 `response`：返回 `{ state: "pending", ttlMs: <剩余毫秒> }`
- 如果 `publicKey` 不存在：新建一条 pairing request，state=pending，5 分钟 TTL
- `supportsProtocol !== PROTOCOL_VERSION`：返回 400

returns:

```ts
// 200 OK
{ state: "pending" | "authorized", ttlMs: number, roomId?: string, response?: string }
// 400 Bad Request
{ error: "invalid_public_key" | "unsupported_protocol" | ... , message: string }
```

##### `POST /v1/pair/response`

由 APP 调用。body:

```ts
{
  publicKey: string;    // base64url(CLI 的 ephemeral box public key)
  response: string;     // base64(加密 bundle)，relay 不解析
}
```

行为：
- 找不到对应 publicKey 或已过期：返回 404 `{ error: "request_not_found" }`
- 已 authorized（已被 approve 过）：返回 409 `{ error: "already_authorized" }`
- 正常流程：
  1. 生成 `roomId = uuidv4()`
  2. 把 response 和 roomId 写回 pairing request
  3. 创建对应的 room entry（空，等 WS 连接）
  4. 返回 200 `{ roomId }`

##### `DELETE /v1/pair/request`

body:
```ts
{ publicKey: string }
```

行为：CLI 关闭 QR 页面时主动清理 pairing request（可选调用）。总是返回 200 `{ ok: true }`。

#### WebSocket endpoint

##### `ws(s)://<relay>/v1/room/:roomId`

**握手阶段**（连接建立后的首个消息）：

客户端（CLI 或 APP）发送 `hello`：

```jsonc
{
  "type": "hello",
  "role": "cli" | "app",
  "roomId": "<uuid>",
  "protocolVersion": 1
  // MVP 不做签名认证，room 身份靠 roomId + role 自声明
  // 未来（task 03+）可以补上 ed25519 challenge-response
}
```

Relay 响应：

```jsonc
// 成功
{ "type": "hello-ok", "roomId": "<uuid>" }

// 失败（room 不存在 / 协议版本不对 / 已经有同 role 在线 等）
{ "type": "hello-error", "error": "room_not_found" | "room_expired" | "role_conflict" | "protocol_mismatch", "message": "..." }
// 发送 error 后 relay 立即关闭连接，close code 4400
```

**消息转发阶段**：

握手成功后，任一方发送 envelope，relay 转给另一方：

```jsonc
{
  "type": "envelope",
  "envelope": { /* @koko/protocol Envelope */ }
}
```

Relay 行为：
- 解析 JSON，用 `@koko/protocol` 的 `EnvelopeSchema` 验证（只看结构，不看 payload 内容）
- envelope.roomId 必须匹配 URL 里的 roomId，否则丢弃 + 给发送方回一个 `{ type: "envelope-error", reason: "room_mismatch" }`（不关闭连接）
- 如果对端在线：直接转发原始 envelope 包装的消息
- 如果对端离线：入队到 offline queue（LRU，按 DECISIONS 限制 1000 条 / 24h）
- 不做任何 ACK（MVP best-effort）

**对端上线事件**：

当第二方（例如 APP）握手完成后：
1. relay 发送 `{ "type": "peer-joined", "role": "app" }` 给另一方
2. relay flush offline queue 给刚上线的一方（按 seq 升序）

**对端离线事件**：

当任一方断开：
1. relay 发送 `{ "type": "peer-left", "role": "cli" | "app", "reason": "closed" | "error" | "timeout" }` 给另一方（如果还在线）
2. relay 不立即删除 room。room 生命周期由 TTL 管。

**心跳**：

relay 每 30 秒发 ws ping，客户端不响应 pong 则在 90 秒后断开（用 `ws` 的 `ping/pong` 机制，不在应用层做）。

**连接关闭**：

客户端正常关闭：relay log info，清理连接槽位。
客户端异常关闭：relay log warn，清理连接槽位。
relay 主动关：只在 room 过期时做，close code 4410（gone）。

### API 表面（要 export 的）

```ts
// @koko/relay/src/index.ts
// 是 CLI 入口，读 env → 启动 server。非 import 消费。

// @koko/relay/src/server.ts
export interface RelayServerOptions {
  port: number;
  host: string;
  logger: pino.Logger;
  pairingTtlMs: number;
  roomTtlMs: number;
  roomOfflineQueueMax: number;
  roomOfflineQueueTtlMs: number;
}
export interface RelayServer {
  listen(): Promise<{ address: string; port: number }>;
  close(): Promise<void>;
  /** 可观测指标（测试和运维用） */
  stats(): {
    pairingRequests: number;
    rooms: number;
    activeConnections: number;
  };
}
export function createRelayServer(options: RelayServerOptions): RelayServer;
```

测试通过 `createRelayServer({ port: 0, ... })` 启动在随机端口，不要在 test 里 hardcode 端口。

## 验收标准

### 1. 安装 + 基础命令能过

```bash
pnpm install
pnpm --filter @koko/relay typecheck     # 0 errors
pnpm --filter @koko/relay build         # dist/index.js 产出
pnpm --filter @koko/relay test          # 全绿
```

### 2. 手动端到端 smoke

（在 Outcome 段记录跑通情况，不必进 CI）

```bash
# 终端 1：启动 relay
pnpm --filter @koko/relay dev

# 终端 2：发 pairing request
curl -X POST http://localhost:8080/v1/pair/request \
  -H "Content-Type: application/json" \
  -d '{"publicKey":"<随机 32B 的 base64url>","supportsProtocol":1}'
# 期待: { "state": "pending", "ttlMs": <接近 300000> }
```

### 3. 自动化测试覆盖（分类）

必须覆盖，按分类组织：

#### `pairing.flow.test.ts`
- CLI 首次 POST /v1/pair/request → state=pending
- 同 publicKey 再次 POST → 仍 pending（幂等）
- APP POST /v1/pair/response → 返回 roomId
- CLI 再 POST /v1/pair/request → state=authorized，返回 roomId + response
- DELETE /v1/pair/request 清理

#### `pairing.errors.test.ts`
- 非法 publicKey（非 base64url / 解码后非 32B）→ 400
- supportsProtocol 不是 1 → 400
- /v1/pair/response 找不到 publicKey → 404
- /v1/pair/response 已 authorized → 409
- pairing request TTL 过期后再 POST /v1/pair/request 当成新建（返回 pending，新 TTL）

#### `room.flow.test.ts`
- 完整 e2e：
  1. 完成 pairing 拿到 roomId
  2. CLI 连 `ws://.../v1/room/:roomId`，发 hello cli → hello-ok
  3. APP 同样连接并 hello app → hello-ok
  4. CLI 发 envelope → APP 收到一模一样的 envelope（`JSON.stringify` 比较）
  5. APP 发 envelope → CLI 收到
- 非法 JSON 消息 → relay 忽略 + log warn（可以选也回 envelope-error，给你定）
- envelope.roomId 和 URL roomId 不匹配 → envelope-error，连接不关

#### `room.offline.test.ts`
- APP 不在线时 CLI 发 3 条 envelope → APP 后来连接后按 seq 顺序收到 3 条
- 入队超过 1000 条时，旧的被丢弃（LRU 测试用小 max 值，例如 3）
- queue 条目过 TTL 后清理（用极短 TTL 做测试，例如 50ms）

#### `room.lifecycle.test.ts`
- hello 里 roomId 不存在 → hello-error room_not_found，连接关
- CLI 连后再来一个 CLI 连 → 第二个收到 role_conflict，连接关（APP 同理）
- room TTL 过期后尝试连接 → hello-error room_expired
- 两端都断开一段时间 → room 保持直到 TTL
- 每个测试 case 结束正确清理（不要 leak 连接 / 定时器）

#### 测试工具质量
- `helpers/testServer.ts` 启动在端口 0（随机），返回实际端口
- teardown 一定要 close server 和所有 ws 连接
- 用 `AbortController` / timeouts 避免测试卡死
- 断言异步事件时使用"带超时的 waitFor"（如 `await waitForEvent(ws, "message", 500)`）
- 不要 sleep（除了 TTL 测试必须 sleep 的极短时间）

### 4. 代码质量

- 所有 public export 带 TSDoc
- 无 `any`（除非标注理由）
- 无 `console.log`；log 全走 pino
- 无死代码、注释掉的代码
- 无 TODO（有的话移到 Outcome 里）

### 5. 启动时间 + 资源

- `createRelayServer` → `listen` 在本地 < 200ms
- `close` 必须等所有 WS 连接关闭 + HTTP server 停监听
- 内存里 Map / Set 都必须有明确的清理路径（TTL 定时器 / 主动 delete）

## 禁止事项

- **不要**碰 `@koko/protocol`、其他 `packages/*` 和 `apps/*`。只在 `packages/koko-relay/` 里工作。
- **不要**引入数据库、缓存中间件（Redis / memcached）、任何外部服务
- **不要**做 TLS（nginx 反代做）
- **不要**做 APNs / FCM 推送
- **不要**做消息 ACK / 重传 / 幂等 seq 去重（best-effort，上层感知）
- **不要**做任何形式的 auth middleware / token / session cookie（pairing 之外的）
- **不要**做速率限制 / DDoS 防护（部署层面的事，不在 relay 里）
- **不要**自己重新实现 QR 编解码 / 加密（@koko/protocol 已提供，但 relay 不需要，**只用 envelope schema**）
- **不要**改 `packages/koko-protocol/`
- **不要**改 `DECISIONS.md` / `IDEA.md` / `WORKFLOW.md`（有重大发现只在 Outcome 段写明，由 Claude 审阅后决定）
- **不要** git commit
- **不要**凭空"优化"——遇到不确定时优先用最直白的实现

## 设计上的几个"为什么"

1. **为什么 pairing 走 HTTP 而不是 WebSocket**：短轮询 HTTP 最简单、最稳、穿透任何代理。pairing 是一次性流程，延迟 1 秒无感。WebSocket 适合长连接消息转发，不适合状态轮询。
2. **为什么 room 用 uuidv4 不用 ephPubKey hex**：pairing 成功后 ephPubKey 就废弃了，继续用它当 roomId 会让"一次性身份"变成"长期身份"，语义混乱。uuidv4 是全新的、语义纯的 room 标识。
3. **为什么 relay 不做 hello 的签名认证**：MVP 的信任锚是"APP 只可能拿到一个 roomId（通过 pairing 流程）"——只要 roomId 是 uuidv4 不可枚举，就足够防未授权访问。签名认证留给 Task 03+，不阻塞 relay 上线。
4. **为什么离线消息只做 per-room 1000/24h LRU**：relay 不是"消息仓库"，它是转发器。用户真正的消息历史在 APP 和 CLI 本地 store 里。relay 的离线 queue 只是"另一端短暂离线时的缓冲"，数据量有限。
5. **为什么 hello-error 用 4400 close code**：WebSocket close code 4000-4999 预留给应用定义。4400 对应 "application-level bad request"，清晰。
6. **为什么 `role: "cli" | "app"` 限定二选一**：room 模型就是 1:1。如果将来要多端（第二台手机？），那是完全不同的架构，不要现在留口子。

## Outcome

> 状态: ✅ **第一轮完成**（codex 起草 + Claude 验收）— 2026-04-28
> 下一步：Task 02b（替换为真实 fastify / ws / pino 依赖）

### 验收结果

所有验收标准通过，但**偏离了任务书的依赖选择**（见下）：

1. **`pnpm install`** — 通过（`pnpm install --no-frozen-lockfile`）
2. **`pnpm --filter @koko/relay typecheck`** — 0 errors
3. **`pnpm --filter @koko/relay build`** — 产出 `dist/index.js` (33.36 KB) + `dist/server.js` (29.74 KB) + .d.ts
4. **`pnpm --filter @koko/relay test`** — **16/16 passed** （pairing.flow × 1 / pairing.errors × 5 / room.flow × 3 / room.lifecycle × 4 / room.offline × 3）
5. **手动 smoke 启动** — 验证 `GET /healthz`、`POST /v1/pair/request`（合法 + 非法两种输入）、SIGTERM 优雅退出、pino 风格 JSON log 输出全部正常

### 对任务书的偏离（需要 Task 02b 纠正）

codex 在受限沙箱（`full-auto` 不能联网装新依赖）里做了一个**自保决定**：
- **没引入 `fastify`、`ws`、`pino`**
- 改为用 Node 内建 `node:http` + 手撸 WebSocket 协议（500+ 行）+ 自己的 JSON logger 模仿 pino 接口（`src/logger.ts` 里用 `namespace pino` export `pino.Logger` 接口）

**代码功能上是对的**（16/16 测试绿、手动 smoke 过），但结构上不理想：
- **维护成本高**：手撸 WebSocket 帧解析的代码未来要自己保持对（TCP 粘包、ping/pong、掩码、close code……）
- **生态丢失**：fastify 的 schema 校验 / 路由插件 / 错误处理、pino 的 transport / pino-pretty / 性能（pino 是 Node 生态 JSON log 事实标准）、`ws` 的成熟实现都用不到
- **扩展性差**：未来加 auth middleware / 速率限制 / APNs 推送 / 健康检查插件时，fastify 的扩展更自然
- **命名冒用**：`namespace pino` 导出，和真正的 pino 库同名容易误导

**Task 02b 将**：装真实 fastify/ws/pino → 替换相关模块 → 保证现有 16 个测试全绿（无 regression）。

### 实际改动文件清单（Task 02 第一轮）

新建：
- `packages/koko-relay/package.json`
- `packages/koko-relay/tsconfig.json`
- `packages/koko-relay/tsup.config.ts`
- `packages/koko-relay/vitest.config.ts`
- `packages/koko-relay/src/index.ts`（可执行入口）
- `packages/koko-relay/src/server.ts`（`createRelayServer` 工厂）
- `packages/koko-relay/src/config.ts`（env 读取 + zod 校验）
- `packages/koko-relay/src/logger.ts`（JSON logger，伪 pino）
- `packages/koko-relay/src/version.ts`
- `packages/koko-relay/src/http/{index,health}.ts`
- `packages/koko-relay/src/pairing/{index,store,routes,types}.ts`
- `packages/koko-relay/src/room/{index,store,handler,types}.ts`
- `packages/koko-relay/test/helpers/{testServer,wsClient}.ts`（wsClient 是手撸 WS client）
- `packages/koko-relay/test/{pairing.flow,pairing.errors,room.flow,room.lifecycle,room.offline}.test.ts`

修改：
- `packages/koko-relay/README.md`
- `pnpm-lock.yaml`（`pnpm install --no-frozen-lockfile` 后同步）

### 跑通的命令列表（第一轮）

```bash
CI=true pnpm install --no-frozen-lockfile
pnpm --filter @koko/relay typecheck
pnpm --filter @koko/relay test        # 16/16 passed
pnpm --filter @koko/relay build
node packages/koko-relay/dist/index.js  # 手动 smoke: healthz + pair/request
```

### 遗留疑点（进 Task 02b 修复）

1. **依赖选择偏离** — 上文已述
2. **pnpm install --no-frozen-lockfile** — codex 撤掉了 lockfile 改动，本地首次装时需要 `--no-frozen-lockfile`。02b 装真实依赖时会更新 lockfile。
3. **handshake 无签名认证** — 任务书明确 MVP 不做（靠 roomId uuidv4 不可枚举）。Task 03/04 补。
4. **没有 CLI 侧的 pairing client SDK** — 将来 koko-cli 写时会需要，但不是 relay 的职责。
5. **room.lifecycle.test 有一个 waitFor(300ms)** — 依赖定时器精度，在极慢 CI 可能抖。可接受。
