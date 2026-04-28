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

