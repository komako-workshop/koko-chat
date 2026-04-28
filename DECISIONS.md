# KokoChat — 工程决定（DECISIONS）

> 本文件记录每个"回不了头"的技术决定。改一条都要有充分理由。
> 读这份文件前先读 [`IDEA.md`](./IDEA.md) 和 [`WORKFLOW.md`](./WORKFLOW.md)。

---

## 架构

### 连接路线：B（Relay 中继）

```
APP (RN+Expo) ↔ koko-relay (Node/WS, Komako 的服务器) ↔ koko-cli (Node, 用户 Mac) ↔ OpenClaw
```

**不走 A（直连 Gateway）或 C（本地 bridge）。** 原因：
- A 要求用户自己搞 Cloudflare Tunnel / Tailscale，非技术用户用不了
- C 只适合 Simulator 开发，真机手机不能用
- B 是唯一能让 Komako 非技术 B 站用户也能用的路径
- 先把"最终对的方案"定下来，避免日后大重构

### 仓库结构：pnpm monorepo

```
koko-chat/
├── packages/
│   ├── koko-relay/       # WebSocket 中继服务器
│   ├── koko-cli/         # Mac 守护进程
│   └── koko-protocol/    # 共享协议 / 加密 / 类型
├── apps/
│   └── koko-chat/        # RN + Expo APP
├── tasks/                # 给 codex 的任务书
└── docs/
```

参考 Happy 的 monorepo 结构。pnpm workspaces。

---

## koko-relay 协议层决定（2026-04-28）

### 关键决定一览

| 决定项 | 结论 | 原因 |
|---|---|---|
| 技术栈 | Node.js 20+ / TypeScript / `ws` | Happy 验证过，生态成熟，codex 写这种精细后端最稳 |
| 信任模型 | **纯 room（1 APP ↔ 1 CLI）** | MVP 最简；换机器重 pair 可接受；account 模型以后补 |
| Pairing 流程 | CLI 生成一次性 `nacl.box` 公钥 → QR（`koko://pair?k=<base64url(pubKey)>`）→ APP 扫 → relay 转密文 bundle → CLI 解密落地 | 抄 Happy 的骨架，补掉 TTL + DELETE |
| QR TTL | **5 分钟**，超时 relay 清理 | Happy 没做、DB 会堆；我们直接做掉 |
| 密码学库 | **libsodium-wrappers**（两端统一） | Happy 两端库不一致打了 sha512 截断补丁，脏；我们统一用一个库 |
| 密钥派生 | master secret → **HKDF**(master, info="sig") / HKDF(master, info="box") | 避免 key reuse across primitives；保持密码学纯洁 |
| 身份认证 | Ed25519 challenge-response | 同 Happy；server 只存 pubKey，client 持私钥签随机 challenge |
| 消息 E2E | **XChaCha20-Poly1305** (libsodium `crypto_aead_xchacha20poly1305_ietf_*`) + dataKey 分层（CLI 本地生成 machineKey，用 APP 公钥 box 加密存 relay） | 跳过 v1 legacy 直接走 v2 结构；libsodium.js 不含 AES-GCM（AES-NI 非常数时间顾虑），XChaCha20 是 libsodium 推荐的对称 AEAD，nonce 24B 随机更安全 |
| Relay 持久化 | **内存 LRU，24h / 1000 条上限** | MVP 简化；relay 重启消息全丢（上层应用层感知重发） |
| SAS 防 MitM | **MVP 不做**，不预留接口 | 等有真实用户再说；现在加会让任务书复杂化 |
| 部署目标 | Komako 的服务器（Ubuntu 22.04，nginx + letsencrypt） | `ssh komako` 可登陆，已有 TLS 基础设施 |

### 明确不做的事

- 不做 account 模型、不做多设备
- 不做 relay 持久化存储（SQLite / Redis）
- 不做消息投递 ACK / 精确 once 语义（best-effort）
- 不做推送通知（APNs / FCM）—— MVP 后补
- 不做 koko-cli 到 OpenClaw 的具体接入（单独任务书，不在 relay 范围）
- 不做 UI / RN APP —— 单独阶段

### 协议 QR URL 格式（已定）

```
koko://pair?k=<base64url(cliEphBoxPublicKey)>
```

- scheme 用 `koko://`，全小写，简洁
- 不编码 roomId / relayURL / nonce（relay URL 是 APP 和 CLI 编译期常量）
- scheme 路径是 `pair`，给未来留 `koko://<action>?...` 扩展空间
- 参数只有 `k`（key），base64url 无 padding 编码

---

## 开发工作流决定

见 [`WORKFLOW.md`](./WORKFLOW.md)。核心：

- 后端 / 协议 → codex（bash 调 `codex exec`）
- RN / UI / 产品逻辑 → Claude（在 OpenCode 里）
- 架构 / 产品决定 → Komako + Claude 讨论
- 任务书存 `tasks/NN-<slug>.md`，codex 执行后在末尾追加 `## Outcome`

---

## 历史决定（与旧仓库 openclaw-chat 对比）

### 2026-04-28 修订：对称 AEAD 从 AES-GCM 改为 XChaCha20-Poly1305

原因：实现 `@koko/protocol` 时发现 `libsodium-wrappers` 主包**不含** AES-256-GCM（libsodium.js 因 AES-NI 非常数时间考虑默认剔除，只在 sumo 版才有）。已考虑过的选项：

1. 切换到 `libsodium-wrappers-sumo`（完整版含 AES-GCM）—— RN 兼容性不确定、包体大
2. Node 端 `node:crypto` + RN 端 WebCrypto —— 两端实现不一致、复杂度高
3. **换 XChaCha20-Poly1305**（选定）—— libsodium 两端原生支持、nonce 24B 随机更安全、密码学等价

这是被迫的调整，但结果更干净：`@koko/protocol` 继续只依赖 `libsodium-wrappers` 一个加密库。

---

| 维度 | 旧 openclaw-chat | 新 koko-chat |
|---|---|---|
| 架构 | 本地 bridge（Mac 上 Node spawn CLI） | Relay 中继 |
| 仓库 | 单仓库 | pnpm monorepo |
| UI 栈 | RN + Expo | RN + Expo（未变） |
| OpenClaw 接入 | `openclaw agent --session-id ... --message ...`（spawn CLI） | **Gateway WebSocket 直连**（见 2026-04-29 决定） |
| E2E 加密 | 无 | libsodium-wrappers + XChaCha20-Poly1305（见 2026-04-28 修订） |
| 使用范围 | 只能 Simulator | 真机可用，任何网络 |

旧仓库验证过且可复用的事：`openclaw infer model run --gateway --json` 三路并发 OK、main session file lock 必须 `--gateway` 不是 `--local`、主聊天进来要 cancel 后台任务——这些经验仍然有用，但旧仓库代码本身 Komako 确认不参考（质量差）。

---

## 2026-04-29 新增：koko-cli ↔ OpenClaw 接入 + Task 03 拆分

**决定**：koko-cli 走 **OpenClaw Gateway WebSocket 直连**（`ws://127.0.0.1:18789`），**不 spawn `openclaw agent` CLI**。

**原因**：
- `openclaw agent --session-id ... --message ... --json` 整块返回（~15s 延迟，实测），**不支持流式**
- Gateway Protocol v3 的 `event chat {state: 'delta'}` 支持真正 token 流式
- 透过 relay 把 OpenClaw 流式一路推到 APP，UX 和现代 chat 产品齐平
- 旧仓库 bridge 代码质量差（Komako 明确确认不参考）

**协议参考**：`ngmaloney/clawchat` 的 [`src/lib/gateway-client.ts`](https://github.com/ngmaloney/clawchat/blob/main/src/lib/gateway-client.ts)（420 行 TS），握手流程：

```
ws.open
  ↓
server → event: connect.challenge { nonce }
  ↓
client → req: connect {
  role: "operator",
  scopes: ["operator.read","operator.write","operator.approvals","operator.pairing"],
  auth: { token, deviceToken? },
  device: { id, publicKey, signature, signedAt, nonce },  // 已 paired 时才带
  client: { id, version, platform, mode },
  minProtocol: 3, maxProtocol: 3
}
  ↓
server → res: hello-ok { auth.deviceToken, snapshot.policy.maxPayload, ... }
  ↓
后续 req/res 和 event 流式推送
```

**使用方式**：
- `call('chat.send', {sessionKey, message, idempotencyKey})` → 返回 `{runId}`
- `call('chat.history', {sessionKey, limit})` → 返回历史 messages
- `call('chat.abort', {sessionKey})` → 取消正在跑的 run
- `event 'chat' { state: 'delta'|'final'|'error', sessionKey, runId, message }` → 流式 token

**Session 绑定**：koko-cli 启动时读 OpenClaw 的 `agent:main:main` session（用 `openclaw sessions --json --agent main` 获取 sessionKey 和 sessionId），把 APP 消息发到这个 session。所有 APP ↔ OpenClaw 对话进入 main session，和用户在 OpenClaw TUI / 其他客户端共享历史。

**Device pairing**：
- 如果 `~/.openclaw/devices/paired.json` 已有 operator device，**复用** operator token
- 如果没有，koko-cli **不负责** pair（让用户先跑 `openclaw onboard` 或类似），koko-cli 看到没 paired device 就报错退出
- 理由：MVP 不在 koko-cli 里做 device pairing（和 APP pairing 容易混淆），用户机器上 OpenClaw Gateway 本来就已经 paired

**新增仓库结构**：

```
packages/koko-openclaw-client/     # @koko/openclaw-client（03a）
packages/koko-cli/                  # @koko/cli（03b + 03c）
```

`@koko/openclaw-client` 做成独立 workspace package 而非 koko-cli 私有模块，理由：未来 RN APP 如果要直连 Gateway（例如用户在家 WiFi 下 Tailscale 到自己 Mac）可以复用这个包。

**Task 03 拆分**：

- `03a`：`@koko/openclaw-client` 纯协议层，mock WS 单测可覆盖全部 edge case
- `03b`：`@koko/cli` 骨架 + echo bot（收到 APP envelope → 原样回一个 envelope），打通 APP ↔ relay ↔ cli 链路
- `03c`：`@koko/cli` 接入 `@koko/openclaw-client`（echo bot → 真 Gateway 流式）

---

## 环境资源（本机，2026-04-29 确认）

Komako 的 Mac（开发机）：
- OpenClaw 2026.4.26 装在 `/Users/lijianren/.local/bin/openclaw`
- Gateway 作为 LaunchAgent 跑（`openclaw gateway status`）
  - `ws://127.0.0.1:18789`（也监听 `0.0.0.0:18789`，Dashboard: `http://192.168.71.159:18789/`）
  - PID 6808（当前 session，会变）
  - `--port 18789` 是默认
- Paired operator device 已存在（`~/.openclaw/devices/paired.json`）
  - publicKey: `m5DaiOBU8Wk_iW7Tz2BTW1ne1YeD0p0j_SnHwD2Uc-c`
  - operator token: `u9BCjtBb7fqbG96XoZzXx7DHe1ZLHRII_3eaBaFH6QQ`
  - Scopes: `operator.admin/read/write/approvals/pairing`
- Main session 存在（`openclaw sessions --json --agent main`）
  - key: `agent:main:main`
  - sessionId: `bdb0f457-c1e8-458b-845b-daf7e786cafc`（会随使用变）
  - model: `claude-opus-4.7` via `openrouter`

**这些都是 koko-cli 启动时**动态读取**的，不 hardcode**。
