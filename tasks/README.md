# tasks/

给 codex 的任务书。每个任务一份 Markdown，命名规则：`NN-<slug>.md`。

任务书格式详见 [`../WORKFLOW.md`](../WORKFLOW.md) §2。

## 索引

| 序号 | 标题 | 负责 | 状态 |
|---|---|---|---|
| 01 | `koko-protocol` 初始化（类型 / 加密 / HKDF / QR 编解码） | codex + Claude | ✅ done (2026-04-28) |
| 02 | `koko-relay` 初始化（WebSocket 服务器 / pairing / 消息路由） | codex + Claude | ✅ done (2026-04-28) — 功能完整，但偏离依赖选择（见 02b） |
| 02b | `koko-relay` swap 成真实 fastify / ws / pino 依赖 | codex + Claude | ✅ done (2026-04-28) — 16/16 无 regression |
| 03a | `@koko/openclaw-client` Gateway Protocol v3 TS 客户端 | codex + Claude | ✅ done (2026-04-28) — 25/25 测试绿，见 03a-fix |
| 03a-fix | `@koko/openclaw-client` 测试修复（Error: null + Promise settle guard + ws.send callback null） | codex + Claude | ✅ done (2026-04-28) |
| 03b | `@koko/cli` 骨架 + echo bot（APP ↔ relay ↔ cli 打通） | codex + Claude | ✅ done (2026-04-28) — 11/11 测试绿 + 真实手动 smoke 过 |
| 03c | `@koko/cli` 接入 `@koko/openclaw-client`（echo → 真 LLM） | codex | pending |

（后续任务随项目推进追加）
