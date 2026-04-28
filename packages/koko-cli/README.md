# @koko/cli

KokoChat 的 Mac 守护进程。

职责：
- 启动时生成一次性 box 密钥对 + 显示 pairing QR
- 保持到 @koko/relay 的 WebSocket 连接
- 收到 APP 消息 → 调 OpenClaw（`openclaw agent --session-id ... --message ...` 或 Gateway 直连）
- 流式转发 OpenClaw 响应回 APP
- 管理 main session file lock（`--gateway` transport，旧仓库已验证）
- 后台任务 cancel 语义（主聊天进来要让 OpenClaw）

详见 `tasks/` 下各模块的任务书。
