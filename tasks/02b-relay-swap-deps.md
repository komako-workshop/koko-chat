# Task 02b — `@koko/relay` 替换为真实 fastify / ws / pino 依赖

> 状态: pending
> 负责: codex
> 创建: 2026-04-28
> 依赖: Task 02 第一轮已 commit（git hash `58edbaf`）
> 上游文档: [`./02-relay-init.md`](./02-relay-init.md)（含第一轮 Outcome）

---

## 目标

一句话：在**不改变可观察行为**的前提下，把 `packages/koko-relay/` 里三个"手撸 / 伪装"的模块替换为真实的工业级依赖：

| 当前（第一轮） | 替换后 |
|---|---|
| `node:http` (bare) | **`fastify`** |
| 自撸 WebSocket 帧解析（`src/room/handler.ts` + `test/helpers/wsClient.ts`） | **`ws`**（server 端 + test client 端） |
| `src/logger.ts` 里 `namespace pino` + 自写 JSON logger | **`pino`** |

**硬约束**：
- 现有 16 个测试一个都不能回归失败（functionality must stay identical）
- 手动 smoke（`GET /healthz`、`POST /v1/pair/request`、SIGTERM 优雅退出）行为必须一致
- `createRelayServer` 的 API 签名必须完全不变（`RelayServerOptions`、`RelayServer`、`stats()` 结构都不变）
- HTTP 端点的 URL、方法、请求体 schema、响应 body、状态码、错误码 **全都不变**
- WebSocket 协议（hello / hello-ok / hello-error / envelope / envelope-error / peer-joined / peer-left）**全都不变**

## 背景上下文

第一轮 codex 因沙箱没网络装不了新依赖，选择手写。代码正确（16/16 测试过），但未来维护和扩展成本高。本任务是**把依赖补回来**。

参考当前代码：[`../packages/koko-relay/`](../packages/koko-relay/)，git hash `58edbaf`。

**必读**：
- [`./02-relay-init.md`](./02-relay-init.md) 整份任务书（协议定义、输出契约、禁止事项）
- [`./02-relay-init.md`](./02-relay-init.md) 的 `## Outcome` 段（知道第一轮做了什么、为什么偏离）
- [`../DECISIONS.md`](../DECISIONS.md) 的 "koko-relay 协议层决定"
- [`../WORKFLOW.md`](../WORKFLOW.md)

## 输入契约

### 依赖的仓库状态

- Task 02 第一轮已 commit（git hash `58edbaf`）
- 本地 `pnpm install --no-frozen-lockfile` 已跑过一次，`node_modules` 存在
- 当前 `pnpm --filter @koko/relay test` 跑 **16/16 passed**
- 本地网络可用（你运行时不再有沙箱限制——如遇到仍不能下载，即时报错返回，不要 fallback 到手写）

### 可用依赖（装这些）

```jsonc
"dependencies": {
  "@koko/protocol": "workspace:*",
  "fastify": "^5.x",
  "pino": "^9.x",
  "ws": "^8.x",
  "zod": "^3.x"
  // 不再显式依赖 @types/node（devDep 里有）
},
"devDependencies": {
  "@fastify/websocket": "latest 5.x",   // 可选：只用在你判断值得时
  "@types/node": "^25.x",
  "@types/ws": "^8.x",
  "tsup": "^8.x",
  "typescript": "^5.x",
  "vitest": "^3.x"
}
```

**说明**：
- 任务书**不强制**使用 `@fastify/websocket`。Fastify 处理 HTTP 路由很顺，但 WebSocket 这块用 `@fastify/websocket` 还是直接在 fastify 的底层 server (`app.server.on('upgrade', ...)`) 挂 `WebSocketServer({ noServer: true })` 自己 handleUpgrade，都可以。**你选更简单的那个**，在 Outcome 里说明选择理由。
- `@types/node` 已在。

## 输出契约

### 保持不变（绝对不能动）

- `packages/koko-relay/test/` 下**所有**测试文件 —— 一个字都不改，包括 `test/helpers/testServer.ts` 和 `test/helpers/wsClient.ts`
  - 例外：`wsClient.ts` 可以**完全重写**为基于 `ws` 的实现，**但 export 的类名 `TestWsClient` 和方法签名 `connect / sendJson / sendText / receiveJson / receiveText / close / waitClosed` 必须一字不变**，让现有测试文件不用改
- `packages/koko-relay/src/server.ts` 的 `createRelayServer`、`RelayServer`、`RelayServerOptions`、`stats()` 签名
- `packages/koko-relay/src/config.ts` 的 `Config` 类型和 `loadConfig()` 签名
- 所有 HTTP 端点（URL / 方法 / 请求体 / 响应体 / 状态码）
- 所有 WebSocket 协议消息类型和 close code
- `packages/koko-relay/src/version.ts`
- `packages/koko-relay/src/http/health.ts` 的行为（但实现可以改）
- `packages/koko-relay/src/pairing/store.ts`（纯内存 store，没用 http 细节，不需要改）
- `packages/koko-relay/src/room/store.ts`（同上）
- `packages/koko-relay/src/room/types.ts`（zod schema / `RoomRole` / `HelloMessageSchema` 等都保留）

### 允许 / 需要修改

- `packages/koko-relay/package.json`（加新依赖）
- `packages/koko-relay/src/logger.ts` — **完全重写**为真实 pino wrapper
- `packages/koko-relay/src/server.ts` — 内部实现换成 fastify + ws，API 不变
- `packages/koko-relay/src/http/index.ts` — 可简化甚至删掉（fastify 内置了 JSON 响应 / 404 / error handling）
- `packages/koko-relay/src/pairing/routes.ts` — 重写为 fastify routes（带 zod schema 校验）
- `packages/koko-relay/src/room/handler.ts` — 重写为 `ws` server wrapper
- `packages/koko-relay/src/room/types.ts` 里的 `ManagedWebSocket` interface — 可以替换为直接用 `ws.WebSocket`；如果要这么做，**同时更新 `src/room/store.ts` 的类型**使其仍然工作；但尽量少改
- `packages/koko-relay/test/helpers/wsClient.ts` — **完全重写**为 `ws` client wrapper，但保持 export API 名字和方法签名不变
- `pnpm-lock.yaml`（pnpm install 会自动改）

### 具体实施建议（非强制，但省力）

#### Logger（最简单，先做）

```ts
// src/logger.ts
import pino, { type Logger } from "pino";

export interface CreateLoggerOptions {
  level: "trace" | "debug" | "info" | "warn" | "error";
  enabled?: boolean;
  bindings?: Record<string, unknown>;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  return pino({
    level: options.level,
    enabled: options.enabled ?? true,
    base: options.bindings ?? {},
    timestamp: pino.stdTimeFunctions.isoTime
  });
}

// 同时把 namespace pino export 删掉。
// server.ts 里把 `logger: pino.Logger` 改成 `logger: Logger`（直接 import from "pino"）
```

#### Fastify 化

```ts
// src/server.ts（概念示意）
import Fastify from "fastify";
import { WebSocketServer } from "ws";

export function createRelayServer(options: RelayServerOptions): RelayServer {
  const app = Fastify({ logger: options.logger });
  const pairingStore = new PairingStore(options.pairingTtlMs);
  const roomStore = new RoomStore(...);
  
  // 注册 routes
  app.get("/healthz", async () => ({ ok: true, version: RELAY_VERSION, protocolVersion: 1, uptimeMs: Date.now() - startedAt }));
  
  // pairing routes
  registerPairingRoutes(app, { pairingStore, roomStore, logger: options.logger });
  
  // WebSocket
  const wss = new WebSocketServer({ noServer: true });
  app.server.on("upgrade", (req, socket, head) => {
    // 解析 URL，抽 roomId，合法就 wss.handleUpgrade(req, socket, head, ws => roomHandler.attach(ws, roomId))
  });
  
  return { listen, close, stats };
}
```

#### Pairing routes

用 fastify 的 JSON schema 校验（或 zod + `fastify-type-provider-zod`，但后者又多一个依赖；**推荐**直接 fastify 原生 JSON schema，简单）：

```ts
app.post<{ Body: { publicKey: string; supportsProtocol: number } }>(
  "/v1/pair/request",
  {
    schema: {
      body: {
        type: "object",
        required: ["publicKey", "supportsProtocol"],
        properties: {
          publicKey: { type: "string" },
          supportsProtocol: { type: "number" }
        }
      }
    }
  },
  async (request, reply) => {
    // ... 保持原逻辑
  }
);
```

#### Room WebSocket handler

```ts
import { WebSocket, WebSocketServer } from "ws";

export class RoomWebSocketHandler {
  private readonly wss: WebSocketServer;
  
  constructor(private readonly options: Options) {
    this.wss = new WebSocketServer({ noServer: true });
  }
  
  handleUpgrade(req, socket, head, roomId): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, roomId));
  }
  
  private onConnection(ws: WebSocket, roomId: string): void {
    // 用 ws 的事件 API 替换掉原来 ManagedWebSocket 的手撸实现
    // 内部状态机（waiting-hello / connected）保持一致
    // ws.on("message", handleMessage)
    // ws.on("close", handleClose)
    // ws.on("pong", updateLastPong)
    // 用 ws.ping() 做心跳
  }
  
  close(): Promise<void> { ... }
}
```

#### Test helpers

```ts
// test/helpers/wsClient.ts（重写）
import { WebSocket } from "ws";

export class TestWsClient {
  static connect(url: string): Promise<TestWsClient> { ... }
  sendJson(v: unknown): void { ... }
  sendText(t: string): void { ... }
  receiveJson(timeoutMs?: number): Promise<unknown> { ... }
  receiveText(timeoutMs?: number): Promise<string> { ... }
  close(): Promise<void> { ... }
  waitClosed(timeoutMs?: number): Promise<void> { ... }
}
// API 名字完全和第一轮的一致，让现有 5 个测试文件零改动
```

## 验收标准

所有必须通过：

### 1. 安装 + 基础命令

```bash
pnpm install --no-frozen-lockfile
pnpm --filter @koko/relay typecheck     # 0 errors
pnpm --filter @koko/relay build         # dist/ 产出
```

### 2. **Regression test 必须 16/16 全绿**

```bash
pnpm --filter @koko/relay test
```

**一个测试都不能失败。** 如果有测试意外失败，要么是你的 swap 改了行为（修回来），要么是真实 library 的 edge case 和手撸实现有微小差异（分析后修代码或——**如果有充分理由认为测试预期不对**——在 Outcome 段明确论证后改测试，但默认假设是**测试正确，实现要对齐**）。

### 3. 手动 smoke 对比

启动 `node dist/index.js`，跑下面三个 curl，输出要和第一轮的**字段完全一致**（时间戳 / uptimeMs 这种时变字段除外）：

```bash
curl -s http://localhost:8080/healthz
# 期待: {"ok":true,"version":"0.0.1","protocolVersion":1,"uptimeMs":<number>}

curl -s -X POST http://localhost:8080/v1/pair/request \
  -H "Content-Type: application/json" \
  -d '{"publicKey":"<32B base64url>","supportsProtocol":1}'
# 期待: {"state":"pending","ttlMs":300000}

curl -s -X POST http://localhost:8080/v1/pair/request \
  -H "Content-Type: application/json" \
  -d '{"publicKey":"not-valid","supportsProtocol":1}'
# 期待: {"error":"invalid_public_key","message":"publicKey must be base64url encoded 32 bytes"}
```

pino log 输出格式会**略有变化**（真实 pino 的时间戳 / pid / hostname 字段和第一轮 logger 不完全一致），这可以接受。但**每个 info/error log 必须至少包含 level + time + msg**。

### 4. 代码质量

- 没有 `namespace pino`、没有手撸 WebSocket 帧解析、没有自己实现的 JSON logger
- fastify/pino/ws 都通过标准 import 用
- 移除第一轮里所有"这是为了绕沙箱"的注释

### 5. package.json 清理

- 所有新依赖都列在 `dependencies` / `devDependencies`
- 无 `zod` 作为直接 dep 的假设 —— @koko/protocol 已经 re-export，但 relay 自己要引 zod 做 fastify schema 或 request body 校验时还是声明直接依赖，OK

## 禁止事项

- **不要**改测试文件内容（`test/*.test.ts`），除了重写 `test/helpers/wsClient.ts`（但保持导出 API 名字 / 签名不变）
- **不要**改 `packages/koko-protocol/` 任何文件
- **不要**改 `apps/`
- **不要**改 `DECISIONS.md` / `IDEA.md` / `WORKFLOW.md` / `tasks/01-*.md` / `tasks/02-*.md` / `tasks/README.md`（如有发现 / 重大偏离只写在本任务书末尾 `## Outcome`）
- **不要**改协议（HTTP 端点 URL / WebSocket 消息格式 / close code）
- **不要**改 `createRelayServer` 的签名
- **不要**引入任何新的"应用层"能力（auth / rate limit / push / metrics 都留给后续任务）
- **不要**给 fastify 装额外的插件（helmet / cors 等）— 外层 nginx 处理
- **不要**绕开 pino 自己打 `console.log`
- **不要** git commit

## 设计上的"为什么"

1. **为什么换 fastify**：JSON schema 校验、零成本 route 增长、结构化 log 内置、错误处理规范。未来加 auth / rate limit / plugin 时不用自己搭脚手架。
2. **为什么换 ws**：成熟、大规模验证（Socket.IO 之下就是 ws）、pong / back-pressure / maxPayload / 协议协商都考虑过。自己撸容易在 production 翻车。
3. **为什么换 pino**：JSON log 的事实标准；pino-pretty 给开发时看漂亮；transport 系统方便接 loki/datadog；性能是对手的 5-10 倍。
4. **为什么测试一字不改**：测试就是契约。如果真实依赖让行为变了，变的是实现不是契约。
5. **为什么 `TestWsClient` export 名字和签名要保持一致**：5 个测试文件直接 import 它。改 API 就得改测试，破了"测试当 regression baseline"这个保证。

## Outcome

> 状态: implementation complete; local regression verification blocked by sandbox listen permission — 2026-04-28

### 实际 dependency 清单

`packages/koko-relay/package.json` 当前包含：

- dependencies: `@koko/protocol`, `fastify`, `pino`, `ws`, `zod`
- devDependencies: `@types/node`, `@types/ws`, `tsup`, `typescript`, `vitest`

没有使用 `@fastify/websocket`。WebSocket 选择直接挂 `ws.WebSocketServer({ noServer: true })` 到 Fastify 底层 `app.server.on("upgrade", ...)`，原因是现有协议只有一个 `/v1/room/:roomId` upgrade 入口，直接使用 `ws` 更少抽象，也能保持 roomId 路径解析和 close/heartbeat 生命周期完全由 `RoomWebSocketHandler` 控制。

### 文件变更

- `src/logger.ts`: 删除本地 `namespace pino` 和自写 JSON logger，改为真实 `pino()` wrapper，返回 `pino.Logger`。
- `src/server.ts`: 删除 bare `node:http` server，改为 Fastify app；注册 health/pairing routes；保留 `createRelayServer`/`RelayServerOptions`/`stats()` API；用 Fastify JSON parser/error/not-found handling 保持原响应契约；在底层 server 处理 WebSocket upgrade。
- `src/http/index.ts`: 简化为 relay route modules 共用的 Fastify instance 类型。
- `src/http/health.ts`: 改为 Fastify `GET /healthz` route，响应字段保持不变。
- `src/pairing/routes.ts`: 改为 Fastify route 注册函数，带 JSON schema + 原有 zod/body validation，保持 error code/status/body。
- `src/room/handler.ts`: 删除手写 WebSocket 握手/帧解析，改为真实 `ws.WebSocketServer` 和 `ws.WebSocket` 的 `message`/`close`/`pong` 事件；room 状态机、offline queue、close code 保持原契约。
- `test/helpers/wsClient.ts`: 删除手写 client 握手/帧解析，改为真实 `ws` client；`TestWsClient` 类名和 `connect / sendJson / sendText / receiveJson / receiveText / close / waitClosed` 方法签名保持不变。

未修改 `test/*.test.ts`。

### 验证命令

通过：

```bash
pnpm --filter @koko/relay typecheck
pnpm --filter @koko/relay build
```

未能在当前 Codex 沙箱完成：

```bash
pnpm --filter @koko/relay test
```

失败原因不是断言失败，而是环境禁止监听本地端口：16 个测试全部在 server start 阶段报同一个错误 `listen EPERM: operation not permitted 127.0.0.1`。用最小 Node 命令复现同样问题：

```bash
node -e "const s=require('node:net').createServer(); s.listen(0,'127.0.0.1',()=>{console.log(s.address()); s.close();}); s.on('error',e=>{console.error(e); process.exit(1);});"
# Error: listen EPERM: operation not permitted 127.0.0.1
```

因此本轮只能确认 typecheck/build 通过和源码已完成真实 dependency swap；需要在允许 localhost listen 的环境里复跑 `pnpm --filter @koko/relay test` 验证 16/16。

---

### Claude 本地复跑验收 — 2026-04-28

本地（无沙箱限制）跑完整验收：

```bash
pnpm --filter @koko/relay typecheck  # 0 errors
pnpm --filter @koko/relay test       # 16/16 passed ✅
pnpm --filter @koko/relay build      # dist/index.js 28.33 KB + dist/server.js 25.87 KB
node packages/koko-relay/dist/index.js  # healthz / pair/request valid / invalid 全 OK, SIGTERM 优雅退出
```

**16 个测试全绿，零 regression**。手动 smoke 各端点响应 body 和第一轮完全一致。

Fastify 自带的 req/res log 比第一轮丰富了（每个请求都有 `msg: "incoming request"` + `msg: "request completed"` 带 responseTime）。pino JSON 格式略有不同（`level` 是数字 30 而非 `"info"`；没有 hostname/pid，因为 `base: {}` 显式清空），但核心字段 level / time / msg 都在，符合任务书要求。

### 最终文件清单（02b）

修改：
- `packages/koko-relay/package.json`（加 fastify/pino/ws/@types/ws）
- `packages/koko-relay/src/logger.ts`（真实 pino）
- `packages/koko-relay/src/server.ts`（Fastify + ws.WebSocketServer）
- `packages/koko-relay/src/http/index.ts`（简化为 type alias）
- `packages/koko-relay/src/http/health.ts`（Fastify route）
- `packages/koko-relay/src/pairing/routes.ts`（Fastify routes + JSON schema）
- `packages/koko-relay/src/room/handler.ts`（真实 ws）
- `packages/koko-relay/test/helpers/wsClient.ts`（真实 ws client，API 不变）
- `pnpm-lock.yaml`（install 新依赖）

**没改**：
- `packages/koko-relay/test/*.test.ts`（测试文件一字未动）
- `packages/koko-relay/src/config.ts`, `src/pairing/store.ts`, `src/pairing/types.ts`, `src/room/store.ts`, `src/room/types.ts`, `src/index.ts`, `src/version.ts`
- `packages/koko-protocol/*`
- `DECISIONS.md` / `IDEA.md` / `WORKFLOW.md` / `tasks/01-*.md` / `tasks/02-*.md`

### 工作流反思（Claude）

1. **codex 第一轮因沙箱禁网没用 fastify/ws/pino**——自己手撸但代码是对的。这是沙箱约束，不是 codex 判断失误。
2. **codex 第二轮因沙箱禁 localhost listen 跑不了测试**——这又是沙箱约束。但 codex 按规则停下来、诚实 Outcome、不 fallback，说明它的指令遵循能力很强。
3. **两轮都由 Claude 在本地做最终验收**：第一轮装依赖 + 跑测试，第二轮跑测试 + smoke。这套"codex 写、Claude 验"的流程实际上每次都要 Claude 兜底跑一次验证，但仍比 Claude 独立写后端快。
4. **未来**：对涉及网络 / 端口监听的任务，任务书里要**提前告诉 codex 把"无法网络/listen 时停下来"视为预期行为，不要强行通过跑测试**——避免 codex 花时间反复尝试然后还是失败。本任务其实已经这样做了，效果好。
