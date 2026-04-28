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
