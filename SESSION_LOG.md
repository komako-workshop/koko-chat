# Session log — Claude 夜班

> Komako 睡觉后 Claude 独立继续工作的滚动日志。
> 新窗口接手时先看这份，再看 `tasks/` 下具体任务书。

---

## 2026-04-29 00:45 — 开始夜班

**状态**：凌晨 0:45。Komako 去睡觉，说"电脑开着你一直干活"。

**规则**（Claude 给自己定的）：
- 不做需要产品判断的事（方案 A/B/C 选哪个、UI 长什么样、要不要 X feature）
- 只做机械 / 明确收敛的事
- tests 不能挂；挂就 revert
- 每小时左右更新一次本文件
- 不 push 到远程
- 不改 `IDEA.md` / `DECISIONS.md` / `WORKFLOW.md` 的已有决定
- 遇到重大不确定就停手 + commit WIP，给你醒来看

**计划**：
1. 写 `tasks/04b-app-workspace-integration.md`，把 Metro + pnpm 集成的三种方案（A watchFolders / B hoist / C file: 依赖）各自讲清楚、给出试验顺序
2. 尝试 04b 的"workspace 集成 + 能 import @koko/protocol"第一部分。不碰 QR 扫描、不碰 pairing UI
3. 如果第一部分跑通，写一屏"Hello from @koko/protocol"证明链路能工作
4. 保持 `@koko/*` 四个包 + `@koko/app` 的 typecheck 全绿

**不做**：
- QR 扫描（要选 camera 库 → 产品决定）
- pairing flow UI（产品决定）
- Task 04d machineKey 交换（已经决定暂缓）

将在下面滚动更新。

---

## 2026-04-29 01:05 — 04b-1 跑通 🦞

**结果**：方案 A（watchFolders + nodeModulesPaths，**不用** disableHierarchicalLookup）一次试成。

**我做了什么**：
1. `apps/koko-chat/package.json` 加 `"@koko/protocol": "workspace:*"`
2. `apps/koko-chat/metro.config.js` 加 workspace 集成（watchFolders + nodeModulesPaths）
3. `apps/koko-chat/app/index.tsx` 引入 `PROTOCOL_VERSION` 并显示在 Home 副标题
4. `pnpm install` → symlink 建好
5. `expo export --platform web` → 1281 modules bundle 成功
6. `expo start --web` → 浏览器真实渲染 OK
7. `pnpm -r typecheck` → 6 个 workspace 全绿，无 regression

**第一次试错**：`disableHierarchicalLookup: true` 会让 `@expo/metro-runtime` 不能被 expo-router 解析（因为它在 .pnpm 子目录里）。去掉这行就好了。

**已知非阻塞 warning**：
```
Attempted to import .../@noble/hashes/crypto.js which is not listed in the "exports"
Falling back to file-based resolution.
```
@noble/hashes 的 `crypto.ts` 导出一个 `typeof globalThis.crypto !== undefined ? globalThis.crypto : undefined` 的常量，Metro package.json exports 严格模式下有个 subpath 抱怨，但 fallback 后成功。功能上 Web 里 `globalThis.crypto` 是 WebCrypto。不影响运行。

**没做**：真正调用加密原语（例如 `initCrypto()` / `generateMasterSecret()`）。那些会在运行时跑 libsodium 的 WASM，Web 和 native 行为不同，留给 04b-2 或 04c 时一起验证。

**下一步想法**：
- 我睡觉前还可以再压一步：写一个占位 PairScreen，**调** `initCrypto()` + `generateMasterSecret()` 验证 libsodium 真的能在 Web 上跑起来
- 但这算是有点"偷跑"了，因为：
  1. libsodium 在 RN iOS / Android 上行为和 Web 不同，Web 通过不代表真机通过
  2. 产品上这个测试没用户价值，只给我自己一个心安
- 我倾向**不做**——先 commit 这个干净的 workspace 集成，下次窗口再做更大的动作

**接下来行动**：commit + 更新 tasks/README.md + 再抽时间扫描低风险 housekeeping（如 DECISIONS.md 补一条"方案 A 选定"）。

---

## 2026-04-29 01:00 — 04b-1 + housekeeping commit

- 提交 `3e2b35f` 实现 Metro + pnpm 集成
- 提交 `48593aa` 把决定写进 DECISIONS.md "2026-04-29 新增：RN Metro + pnpm 集成（04b-1）"一节
- 更新 tasks/README.md 拆分 04b 为 04b-1（✅）+ 04b-2（pending）

### 停手理由

接下来做的事都需要 Komako 产品决定，所以我停：

- 04b-2 需要选 QR 库（managed vs bare）、设计 pairing UI、决定 relay URL 配置机制
- 04c chat UI 完全是产品判断（UX 设计）
- 04d machineKey 交换决定了暂缓

### 可能还能"偷做"但**我选择不做**的几件

- 调用 `initCrypto()` 跑 libsodium Web 验证：只能验 Web，不能验 RN 真机。边际价值不高，RN 真机还要决定 pure-JS libsodium 还是 react-native-libsodium 原生模块——产品决定
- `tsup --watch` + Metro `resolver.resolveRequest` 改成"从 src 而不是 dist 读"：开发体验提升，但动的是 protocol / metro / 整体 dev workflow，**改动面大**不适合我一个人决定
- 给 `@koko/protocol` 加一个 `initCryptoSync` 的 placeholder export：纯机械改动，但"为什么要这样改"需要上下文判断

### 新窗口/Komako 醒来首件事

1. 读 SESSION_LOG.md 的本节（你在读）
2. git log 看 `48593aa` 之后有没有其他改动（应该没有）
3. `pnpm -r typecheck` 应该全绿
4. `cd apps/koko-chat && pnpm exec expo start --web` 打开 http://localhost:8081 → 看到 "Version 0.0.1 · Protocol v1"
5. 决定 04b-2 的三个产品问题（QR 库、pairing UI、relay URL 配置），或者跳去 04c，或者换方向（比如 relay 部署）

当前测试状态（未变）：107+ 测试全绿（38 protocol + 16 relay + 25 openclaw-client + 28 cli）+ 真实 OpenClaw 流式 smoke 过。

我关闭。

---

## 2026-04-29 01:40 — ⚠️ 重大方向调整发现 ⚠️

Komako 在我关闭前问了一个问题："OpenClaw 支持那么多 channel，就没一个能让我们借用减轻 APP 开发复杂度？"

这个问题把我推到一个**元问题**，深挖后**发现 KokoChat 的整体架构可能要大改**。

### 调研过程

1. 翻 OpenClaw 内置 skill（`~/.npm-global/lib/node_modules/openclaw/skills/`）发现 skill 的本质是 "SKILL.md + scripts/" 的 LLM 教学单元，不是独立守护进程
2. skill 靠 agent 的 `exec` tool（支持 `background=true`）开长进程
3. **最关键**：跑 `openclaw qr --help`、`openclaw devices --help` 发现：
   - `openclaw qr --public-url <tunnel-url> --json` **直接生成 mobile pairing setupCode**
   - `openclaw devices approve` 内置 device pairing approval
   - Gateway 本身已经支持外部 mobile client pairing（这是 OpenClaw 的产品设计目标）

### 结论

"Mac 端 守护进程 + pairing + machineKey 交换 + relay"这一整套我们自己重写的东西，**OpenClaw 已经原生支持**。`openclaw qr` 给出的 setupCode 就是手机 APP pairing 需要的一切信息。

完整流程（**完全用 OpenClaw 内置能力**）：

```
[kokochat skill 指示 agent]
  1. spawn `cloudflared tunnel --url ws://127.0.0.1:18789` background
  2. wait for public URL from cloudflared stdout
  3. run `openclaw qr --public-url <url> --json` → setupCode
  4. display ASCII QR in terminal (openclaw qr 自带)

[用户拿 KokoChat APP 扫 QR]

[APP]
  1. decode setupCode → { url, bootstrapToken }
  2. 连 wss url，通过 bootstrapToken 开始 Gateway device pairing
  3. OpenClaw 弹 pairing 请求 → 用户 approve (或 skill 自动 approve)
  4. APP 拿到 operator token → 常规 @koko/openclaw-client 连接 → 开始聊天
```

### 代码沉没成本评估

| 包 | 在新方向下 | 已写 |
|---|---|---|
| @koko/protocol | 加密原语保留，pairing **废弃** | 38 tests |
| @koko/relay | **完全废弃** | 16 tests |
| @koko/openclaw-client | **完全保留，核心** | 25 tests |
| @koko/cli | **完全废弃** | 28 tests |
| @koko/app | **完全保留** | typecheck + Metro |
| scripts/smoke-* | **废弃** | - |

**67/107 tests (63%) 的代码路径要废弃**，但 git 历史保留、不物理删除（将来如果新路线不行还能回退）。

净节省：
- 不用架公网 relay
- 不用写 cli 守护进程（OpenClaw 本身就是）
- 不用设计 machineKey 交换协议 (Task 04d 作废)
- 不用写 pairing UI (复用 OpenClaw 的 QR setup)
- Task 04b-2 大幅简化：APP 只要做 "扫 QR + 通过 @koko/openclaw-client 连 Gateway" 就行
- Task 04d 完全废弃

### 新需要写的

- **kokochat skill** (SKILL.md + 少量 shell 脚本)：~50 行 + Markdown
- **RN APP 里的 QR scanner** (04b-2 的一部分)：选 expo-barcode-scanner 还是 vision-camera
- **RN APP 里 @koko/openclaw-client 真实 runtime 调用** (之前只 import 了 const)：要验证 libsodium / @noble 在 RN 上能跑
- （可选）**kokochat plugin**：把 skill 升级成持久 channel plugin，和 wechat / telegram 并列

### 决定权在 Komako

我**不做这个方向变更**。需要 Komako 醒来拍板：

**选项 α: 立即切换** — 保留现有 @koko/openclaw-client + @koko/app，废弃 @koko/relay + @koko/cli，开始写 kokochat skill 和 APP 的 Gateway pairing。所有沉没成本接受。
**选项 β: 先验证再切** — 写一个 shell 脚本 smoke 出 "tunnel → openclaw qr → APP 扫 → APP 连上" 的完整流程，确认没隐藏坑，再切。
**选项 γ: 继续原计划** — 已经做了 70%，不换。保留 relay/cli 的代码价值，完成 04b-c-d。

### 我认为是 α（但不该我决定）

理由：
1. α 代价是"已完成代码的一半价值减少"（**但 git 留着，不真正删**）
2. γ 代价是"继续写 40% 相对复杂代码"+"用户装 APP 后还要手动配 tunnel"+"未来还要跟 OpenClaw 协议变化"
3. α 的净工作量**显著更小**，用户体验**显著更好**，架构和 IDEA.md 的"KokoChat = OpenClaw 在你手机上的家"**更一致**

### Komako 醒来首件事（更新）

1. 读这段（`SESSION_LOG.md` 最后）
2. 决定 α / β / γ
3. 如果 α：把决定写进 DECISIONS.md 的新一节"2026-04-29 方向调整：基于 OpenClaw 原生 pairing"，然后重开 task 04x
4. 如果 β：写 `scripts/smoke-openclaw-pair.mjs` 验证完整 tunnel + qr + 连接流程
5. 如果 γ：继续 04b-2 开工

我关机。git 最后 commit 是 `377baf8` session-log 收尾，现在这篇 session-log 更新尚未 commit。将在下一步 commit 后真的退出。

