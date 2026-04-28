# archive/

存放**暂时不在主线上**的 workspace 包和脚本。从 `pnpm-workspace.yaml` 里排除，不会被 `pnpm -r` 遍历到。

## 为什么存档（2026-04-29）

原本的 KokoChat 架构是 **B 路线（公网 relay + 用户 Mac 上跑 koko-cli 守护进程）**。这一晚的讨论重新 align 了产品定位：

- **产品本质**：蹭用户已配好的 OpenClaw（Codex / Claude Code 订阅）做底层
- **价值**：移动端 agent chat app + skill+GUI mini-app 生态
- **技术路径**：RN APP 直接用 `@koko/openclaw-client` 连用户 Mac 上的 OpenClaw Gateway（通过 OpenClaw 原生 `openclaw qr` pair 机制）

这意味着：**我们不需要自己架 relay、不需要自己写 Mac 守护进程、不需要自己设计 pairing 协议**。OpenClaw 原生全都有。

## 存档内容

### `koko-relay/` (16 tests 绿)

WebSocket 中转服务器。原设计是 APP 和 Mac 端 cli 都连它。新路径里 **APP 直连用户 Mac 的 OpenClaw Gateway**，relay 不在链路上。

**未来可能重启的场景**：
- mini-app 间"跨用户分享"（两个不同用户的 APP 要互相传消息）
- 多设备同步（一个用户的 iPad 和 iPhone 同步状态）

### `koko-cli/` (28 tests 绿)

Mac 本地守护进程。连 Gateway 和 relay 的桥。新路径里 **不需要**——APP 直接连 Gateway。

**未来可能重启的场景**：
- 开发期 smoke 工具（不是用户面向产品）
- 需要把 OpenClaw 和非 OpenClaw 系统桥接时（但新 skill 生态应该不需要）

### `scripts/`

`smoke-echo.mjs` 和 `smoke-attach-as-app.mjs` 都依赖 `@koko/relay`，一并归档。

## 如何恢复

```bash
# 把某个包挪回来
mv archive/koko-relay packages/
# 在 pnpm-workspace.yaml 里恢复（如有改动）
# 重新 install
pnpm install --no-frozen-lockfile
```

所有 git 历史保留。commit hash 不会变。
