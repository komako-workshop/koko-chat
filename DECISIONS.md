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

---

## 2026-04-29 新增：RN Metro + pnpm 集成（04b-1）

**决定**：走"方案 A"（在 `apps/koko-chat/metro.config.js` 里配 `watchFolders` + `nodeModulesPaths` 到 workspace root），**保留** Metro 默认的 hierarchical lookup（不用 `disableHierarchicalLookup: true`）。

**原因**：
- pnpm 不把 peer deps 平铺到 app 级 node_modules。`expo-router` 的 peer dep `@expo/metro-runtime` 只存在于 `node_modules/.pnpm/expo-router@.../node_modules/`。关闭 hierarchical lookup 后 Metro 找不到这条路径。
- 打开 hierarchical lookup 后 Metro 从 importing file 向上找 `node_modules/`，能遍历到 .pnpm 的子 node_modules 里的 peer deps。**有点微弱地放松了严格依赖**（理论上 `apps/koko-chat` 能 import 它没声明的 peer dep），但实践上 Happy 和我们都这么干。
- 相比 "方案 C"（`file:../../packages/koko-protocol` 本地路径依赖），方案 A 保留 workspace `workspace:*` 协议，改 protocol 源码实时反映到 APP，不用额外 `pnpm install` 同步。
- 相比 "方案 B"（`.npmrc shamefully-hoist`），方案 A 不影响 workspace 其他包的严格依赖检查。

**示例配置**（见 `apps/koko-chat/metro.config.js`）：

```js
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules")
];
// do NOT set disableHierarchicalLookup — needed so pnpm's nested peer deps
// (e.g. @expo/metro-runtime via expo-router) can still be found.

module.exports = config;
```

**已知副作用**：
- `@noble/hashes/crypto.js` 会被 Metro 发出 "subpath not in exports" warning，原因是 `@noble/hashes` 的 `package.json` exports 没声明那个 crypto 子路径。Metro fallback 成功、不影响运行。可忽略。
- Future：如果 04b-2 把 `libsodium-wrappers` 真正在 RN 上跑起来还有坑，需要 `@more-tech/react-native-libsodium` 原生模块（bare workflow）或 `libsodium-wrappers` 纯 JS（managed workflow，慢）。这部分见 Task 04b-2 / 04c 的决定。

## 2026-05-06 至 2026-05-07 新增：SDK/auth 踩坑 + mini-app runtime 定位

### SDK 版本：Expo 55 → 54

**决定**：APP 跟 Expo Go 的 runtime 对齐，不追最新 SDK。

**理由**：用户设备上的 App Store Expo Go 不是每月都更新。我们把 `expo` 降到 `~54.0.0`、`react` `19.1.0`、`react-native` `0.81.5`，用 `pnpm exec expo install --fix` 让 Expo 自己把所有 peer dep 对齐。

`expo-router` 之后的 expo-\* 子包跳到各自独立 versioning（`expo-router@~6.0.23` 不是 ~54），以后升级要用 `expo install --check` 读 expo 推荐表，不能照抄 `expo` 的版本号。

### OpenClaw Gateway `crypto.subtle` 在 RN Hermes 上不可用

**决定**：`@koko/openclaw-client` 的 Ed25519 走 noble 同步 API，不走 `subtle.digest` 异步路径。

**理由**：`@noble/ed25519` v2 的 async 函数调用 `crypto.subtle.digest('SHA-512')`。RN Hermes 没有 WebCrypto `subtle`，handshake 直接崩。同步路径只需要一个外部 `sha512` 实现，`@noble/hashes/sha2` 已经是依赖，零新装包。

```ts
ed.etc.sha512Sync = (...messages) =>
  sha512(messages.length === 1 ? messages[0] : ed.etc.concatBytes(...messages));
```

Public API 仍然保留 `Promise` 返回，调用方不用改。

### OpenClaw pairing 的 bootstrapToken 和 gatewayToken 是两种东西

**决定**：`BuildConnectParamsArgs` 同时接受 `token`（长期 `gateway.auth.token`）和 `bootstrapToken`（一次性 `openclaw qr` 出来的配对 token）。

**理由**：Gateway 的 `connect.auth` 分 `token` / `bootstrapToken` / `deviceToken` / `password` 四个独立字段。把 bootstrap token 塞进 `token` 会被拒绝 `gateway token mismatch`。APP 的 setupCode parser 同样接受这两种字段，使用者想用哪个都行。

### Dev auto-connect 不经过手粘 setup code

**决定**：开发环境用 `scripts/dev-start.mjs` 读 `~/.openclaw/openclaw.json` 里的 `gateway.auth.token`，通过 Expo `app.config.js` 的 `extra` 注入，APP 在 `__DEV__` 分支里直接 `connect()`。

**理由**：每次 Expo Go reload 都要扫码/粘 setupCode 不现实。bootstrap token 还只有 10 分钟 TTL。生产环境不会带这些 `extra`，整段代码 skip。

副作用：静态 `app.json` 不能读 env，迁到 `app.config.js`。

### 升级 OpenClaw 时要单独校一次 provider

**决定**：升级 `openclaw` 后第一件事是确认 `agents.defaults.model.primary` 和本机 auth 方式（API key vs Codex OAuth）是否匹配。

**背景**：`openclaw@2026.5.5` 升级 + `openclaw doctor --fix` 自动把 `openai-codex/gpt-5.5` 改回了 `openai/gpt-5.5`。我本机是 Codex OAuth，没有 `OPENAI_API_KEY`，导致手机上所有消息直接返回 `No API key found for provider "openai"`。修法 `openclaw models set openai-codex/gpt-5.5 && openclaw gateway restart`。

后续产品化做 `koko setup` 或安装向导时要把这个检查内建进去。

### KokoChat 产品定位：mini-app runtime，不是第三方 OpenClaw client

**决定**：KokoChat 不以"更好的 OpenClaw 客户端"为差异化。差异化是**mobile-first mini-app runtime**：每个 mini-app = OpenClaw agent 能力 + skill 行为 + 原生 GUI + 本地 context + 可选 worker。

**理由**：OpenClaw 自己有官方 Control PWA（4/29 发现的）。如果我们做通用 chat 壳直接对比，用户心智上没理由装 KokoChat。但 OpenClaw Control 没有 mini-app / 卡片 / 收藏 / 课程进度这类**产品型消费体验**。这才是 KokoChat 能立住的缝隙。

对应：原本 Komako session-log 4/29 那四个选项里选 **γ' 自己做产品**，但产品形态是 mini-app runtime 而不是"手机 OpenClaw 壳"。

设计稿：`docs/mini-app-runtime.md`（commit `fcaa04c`）。

### Session key 命名契约

**决定**：KokoChat 的每个 conversation 对应的 OpenClaw session key 格式统一为：

```text
agent:<agentId>:kokochat:<miniAppId>:<conversationScope>
```

- `<agentId>` 默认 `main`
- `<miniAppId>` 是 mini-app id（`claw` / `feed` / `book` / ...）
- `<conversationScope>` 通常是 `<conversationId>`；Book Tutor 用 `<bookId>`

**KokoChat 不再使用 `agent:main:main`**。那是 OpenClaw CLI / Control UI / 默认 chat 的共享入口，用了会跟 Mac 终端聊天互相污染。

**理由**：
- `openclaw sessions --json` 输出按前缀自然分区，排查问题方便。
- 手机 APP 的对话不会被 Mac 终端 `/reset` 吃掉。
- 不同 mini-app 的 session 完全隔离，cleanup / daily reset / compaction 都各自走各自的。
- 这是产品契约，skill prompt、UI 逻辑、统计都可以依赖这个前缀结构。

### OpenClaw transcript 是 agent-facing 的 source of truth

**决定**：OpenClaw Gateway 写的 `~/.openclaw/agents/<agent>/sessions/<sessionId>.jsonl` 是 agent 侧的 truth，KokoChat 本地 `conversations/<id>/messages.jsonl` 是 UI cache。

**理由**：OpenClaw 有自己的 compaction / context window / 模型历史语义。APP 侧如果当 truth 会在 compaction 后和 agent 看到的不一致，产生"APP 显示了，但 agent 记不住"的 bug。Mini-app state（Feed interests、Book Tutor outline 等）是 KokoChat 独有的，不受 OpenClaw 管辖，也不受 compaction 影响。

### OpenClaw session daily reset 对 KokoChat 不友好

**背景**：OpenClaw 默认 `session.reset.mode: "daily"`, `atHour: 4`，凌晨 4 点全局 reset。文档 `/concepts/session` 和源码 `reset-aZvMiHFk.js` 都确认这是 `DEFAULT_RESET_MODE`。

**决定**：KokoChat 自己的 webchat channel 应该配成长期 idle（`mode: "idle", idleMinutes: 525600`）。OpenClaw 没有 `mode: "never"`，只能用大 idle 模拟。

**配置方式**（只改 webchat，不动全局）：

```bash
openclaw config set session.resetByChannel.webchat '{"mode":"idle","idleMinutes":525600}' --strict-json
openclaw gateway restart
```

**不做**：不让 APP 直接写用户的 `~/.openclaw/openclaw.json`。应用层只做检测 + 提示，配置由 CLI / onboarding 工具执行。

### Block protocol envelope + versioning

**决定**：agent 输出的 fenced block 必须包一层 envelope：

```ts
type KokoBlockEnvelope<T> = {
  type: string;       // 匹配 fenced language tag
  version: number;    // 从 1 开始
  id: string;
  createdAt: number;
  source?: "skill" | "tool" | "system" | "user";
  payload: T;
};
```

Fenced language tag 用 `koko.<miniAppId>.<kind>`（如 `koko.feed.card`）。

**理由**：
- `type` 在 JSON 里重复，防止用户复制粘贴把 fenced tag 弄丢。
- `version` 让客户端升级不会破坏老 APP。
- `id` + `createdAt` 让 UI 能 dedup / 排序 / 局部更新。
- 未知 type 或 future version 必须降级渲染为纯文本或折叠 JSON，不能崩。

**Capability declaration**：APP 连接时通过 system instruction 告诉 agent 自己支持的 block type 和版本，agent skill 输出时按 client 支持度降级。

### Action kinds

**决定**：Block payload 里的 `actions` 不是任意字符串指令，而是引用 mini-app 声明过的 `ActionDefinition`。kind 只有四种：`local | agent_feedback | link_open | system`。

**理由**：让"按钮点击"是类型化的，不让 agent 决定客户端执行什么任意命令。安全边界清晰。Feed 的 `not_interested` 是 `agent_feedback`，点一下会合成一条结构化反馈 turn 给 agent，影响下一轮推荐。
