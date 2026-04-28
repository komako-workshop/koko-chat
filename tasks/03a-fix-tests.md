# Task 03a-fix — `@koko/openclaw-client` 测试修复

> 状态: pending
> 负责: codex
> 创建: 2026-04-29
> 依赖: Task 03a 第一轮（已 commit / 未 commit 都可）
> 上游: [`./03a-openclaw-client.md`](./03a-openclaw-client.md) 的完整要求

---

## 目标

一句话：修复 `@koko/openclaw-client` 的测试——当前 **16/25 fail + 大量 Unhandled Rejection**，都是同一个根因："Error: null" 从 `openConnection` 的 catch 块抛出，以及测试结束后 server close 触发的残留 Promise reject 没被 catch。

**硬要求**：修完后 `pnpm --filter @koko/openclaw-client test` 必须 **25/25 全绿**，zero Unhandled Rejection，zero Unhandled Error。

`typecheck` 和 `build` 当前都通过，不要破坏。

## 症状分析（已知）

### 错误形式

```
AssertionError: promise rejected "Error: null" instead of resolving
 ❯ test/client.handshake.test.ts:46:32

Caused by: Error: null
 ❯ normalizeError src/client.ts:594:43
 ❯ GatewayClient.openConnection src/client.ts:224:13
```

和多个 `Unhandled Rejection` / `Unhandled Error` 报告。

### 涉及的代码

`packages/koko-openclaw-client/src/client.ts`：
- line 194-226 `openConnection(isReconnectAttempt)`：catch 中调 `normalizeError(error)` 和 `throw`
- line 422-455 `waitForOpen(socket)`：同时挂 `open` / `close` / `error` listener
- line 311-317 `attachSocket()`：挂全局 `error` listener（`this.logger.warn`）
- line 399 / 413 `handleClose()`：close 时可能 `scheduleReconnect`
- line 542-565 `scheduleReconnect()`：`setTimeout → void this.openConnection(true)`

### 根因推测（你要先验证，再修）

1. **"Error: null"** 来自 `normalizeError(null)` → `new Error(String(null))` → `Error: "null"`。上游是某处 `reject(null)` 或 `ws` 的 error 事件发了 null err。
2. **Unhandled Rejection** 来自 `waitForOpen` 里 `onClose` / `onError` 的 reject：test teardown `server.close()` 后 client 侧 close 事件触发，`waitForOpen` 的 Promise 此时已经 resolve（初次握手早就完成），这个新的 reject 变成孤儿 Promise 被 V8 报 Unhandled。
3. **ws 库的 `error` 事件可能带 null / undefined 参数**（某些 terminate 路径），`attachSocket` 的 `(error: Error) => ...` 实际拿到 null，传给 logger 还 OK，但如果走到 `waitForOpen.onError(null)` 就会触发 `reject(null)` → 然后被 catch 成 "Error: null"。

## 修复方向（你可以自己判断更好方案）

### 1. `waitForOpen` 的 listener 清理要更严格

- `waitForOpen` 返回 Promise 只能 settle 一次
- 一旦 settle，后续 close/error 事件不能再触发 reject
- `resolve` / `reject` 用 once-guard（一个 `settled` 标志，或用 `Promise.resolve` 覆盖）

### 2. `normalizeError` 永远不返回含 "null" / "undefined" message 的 Error

```ts
function normalizeError(error: unknown, fallback = "unknown gateway error"): Error {
  if (error instanceof Error) return error;
  if (error === null || error === undefined) return new Error(fallback);
  return new Error(String(error));
}
```

### 3. teardown 路径不要产生孤儿 Promise reject

`disconnect()` 被调用后，所有残留的 listener（包括 `waitForOpen` / `waitForChallenge` / handshake pending）都要用 cleanup 函数主动清掉，而不是被动等 close 事件自然 reject。

可以：
- 在 `openConnection` 的 catch 里，对 `this.intentionalClose === true` 的情况 **swallow error 并 return**，不 throw（因为调用方已经不关心了）
- 或者给 `waitForOpen` / `waitForChallenge` 一个 `AbortSignal`，`disconnect()` 时 abort

### 4. `attachSocket` 的 error listener

`(error: Error) => ...` 改成 `(error: Error | undefined) => ...` 并保护 log 不炸。

### 5. reconnect 的孤儿 Promise

`scheduleReconnect` 里 `void this.openConnection(true)` 是 fire-and-forget，如果 `openConnection` 最后 throw 了（line 224），这个 throw 就是 Unhandled。line 218-221 的 `if (isReconnectAttempt) { scheduleReconnect(); return; }` 已经吞了但**仅在 catch 里**。如果 reject 发生在 catch 外（例如 cleanup 阶段），还是会漏。

确保 `openConnection` **在 reconnect 路径上永远不会 reject**：catch 所有 throw，调 scheduleReconnect 或 setStatus('error') 了事。

## 验收标准

必须全部通过，在本地（Claude 本机，无沙箱限制）：

```bash
pnpm --filter @koko/openclaw-client typecheck   # 0 errors（保持）
pnpm --filter @koko/openclaw-client test        # 25/25 passed，no unhandled rejections/errors
pnpm --filter @koko/openclaw-client build       # 产出 dist/（保持）
```

特别注意：vitest 输出最后**不能**有 "Unhandled Rejection" / "Unhandled Errors" 段落。

## 禁止事项

- 不要改 `test/*.test.ts`（测试就是契约）
- 不要改 `test/helpers/mockWsServer.ts`（除非你坚信是 helper bug 且论证充分）
- 不要改 `packages/koko-protocol/`、`packages/koko-relay/`、`apps/`
- 不要改 `DECISIONS.md` / `IDEA.md` / `WORKFLOW.md` / `tasks/` 下除 Outcome 之外的内容
- 不要 git commit
- 不要引入新依赖（用已有的 `ws` / `@noble/*` 够了）

## Outcome

根因最终分析：

- `normalizeError(null | undefined)` 原先会生成 `Error("null")` / `Error("undefined")`，导致真实的 socket/error teardown 失败被误报成 `"Error: null"`。
- `waitForOpen(socket)` 原先只做 listener cleanup，没有显式 once-settle guard；在 close/error/open 竞态和 teardown 路径上，后续事件仍可能试图 reject。
- `scheduleReconnect()` 原先 fire-and-forget 调 `void this.openConnection(true)`，如果 reconnect 路径在外层 catch 之前抛错，会变成 Unhandled Rejection。

修改文件：

- `packages/koko-openclaw-client/src/client.ts`

关键改动：

```ts
function normalizeError(error: unknown, fallback = "unknown gateway error"): Error {
  if (error instanceof Error) return error;
  if (error === null || error === undefined) return new Error(fallback);
  return new Error(String(error));
}
```

```ts
const settle = (error?: Error): void => {
  if (settled) return;
  settled = true;
  cleanup();
  if (error === undefined) {
    resolve();
    return;
  }
  reject(error);
};
```

```ts
this.openConnection(true).catch((error: unknown) => {
  if (this.intentionalClose) return;
  this.logger.warn("gateway reconnect attempt failed", normalizeError(error));
  this.scheduleReconnect();
});
```

验证：

- `pnpm --filter @koko/openclaw-client typecheck`：通过，`tsc --noEmit` 0 errors。
- `pnpm --filter @koko/openclaw-client build`：通过，`tsup` ESM + DTS build success。
- `pnpm --filter @koko/openclaw-client test`：当前 Codex 沙箱仍然禁止 loopback listen，WebSocket server 用例被 `EPERM` 挡住，不能在此环境验证 25/25。

`test` 输出最后 15 行引用：

```text
 FAIL  test/client.handshake.test.ts > GatewayClient handshake > rejects when the connect response times out
 FAIL  test/client.handshake.test.ts > GatewayClient handshake > treats policy violation close as fatal and does not reconnect
 FAIL  test/client.reconnect.test.ts > GatewayClient reconnect > reconnects after an unexpected close and repeats the handshake
 FAIL  test/client.reconnect.test.ts > GatewayClient reconnect > uses exponential delay for consecutive reconnect failures
 FAIL  test/client.reconnect.test.ts > GatewayClient reconnect > sets error after maxRetries is exceeded
 FAIL  test/client.reconnect.test.ts > GatewayClient reconnect > does not reconnect after disconnect
 FAIL  test/client.reconnect.test.ts > GatewayClient reconnect > does not reconnect after a fatal 4xxx close
Error: listen EPERM: operation not permitted 127.0.0.1

 Test Files  4 failed | 2 passed (6)
      Tests  17 failed | 8 passed (25)
   Start at  23:02:36
   Duration  269ms (transform 121ms, setup 0ms, collect 315ms, tests 54ms, environment 0ms, prepare 227ms)
```

---

### Claude 本地补丁 + 验收 — 2026-04-28

codex 的修复让 `normalizeError(null)` 变成 `Error("unknown gateway error")` 而不是 `Error("null")`——但本地仍然 16/25 fail，错误从 `Error: null` 变成 `Error: unknown gateway error`，说明修了症状没修根因。

**真实根因**：`ws` 库的 `socket.send(text, callback)` 在**发送成功**时 callback 参数可能是 **`null`**（而不是 `undefined`，类型声明里通常写 `error?: Error` 但 runtime 会给 null）。原代码只判 `error === undefined`，null 穿透进了 `pending.reject(null)`，握手流程 catch 到 null，经过 normalizeError fallback 成 "unknown gateway error"。

**最终修复**（Claude 补一行）：

```ts
// packages/koko-openclaw-client/src/client.ts, line 300:
socket.send(text, (error?: Error | null) => {
  if (error === undefined || error === null) {
    return;
  }
  // ...
});
```

### 最终验证（Claude 本地）

```bash
pnpm --filter @koko/openclaw-client typecheck   # 0 errors ✓
pnpm --filter @koko/openclaw-client test        # 25/25 passed ✓
pnpm --filter @koko/openclaw-client build       # dist/index.js 23.39 KB + dist/index.d.ts 14.79 KB ✓
```

```
 ✓ test/frames.test.ts (3 tests) 2ms
 ✓ test/device.test.ts (4 tests) 18ms
 ✓ test/client.handshake.test.ts (4 tests) 67ms
 ✓ test/client.call.test.ts (5 tests) 140ms
 ✓ test/client.events.test.ts (4 tests) 193ms
 ✓ test/client.reconnect.test.ts (5 tests) 285ms

 Test Files  6 passed (6)
      Tests  25 passed (25)
```

Zero Unhandled Rejection / Unhandled Errors。

### 工作流总结

- codex 两轮（Task 03a 和 03a-fix）都在沙箱 EPERM 限制下做了正确的推理 + 修复大部分 bug，但错过了 `ws.send` callback 的 null vs undefined 这个边界 case
- 最终通过 Claude 本地 `pnpm test` 暴露真实行为 + 1 行修复搞定
- 这再次验证了 "codex 写 + Claude 本地验收" 的分工：codex 在没法真跑测试的环境里单靠静态推理解决了 90% 的问题，最后 10% 需要真机跑测试暴露
