# @koko/cli

KokoChat 的本地 CLI 进程。

Task 03b 的职责：
- 启动时持久化 32-byte device seed，供后续 Gateway 接入使用
- 生成一次性 pairing box keypair，并在终端显示 pairing QR
- 轮询 `@koko/relay` 的 pairing HTTP endpoint，拿到 roomId
- 连接 relay WebSocket room，完成 `hello` handshake
- 收到 APP 的加密 `chat.user*` envelope 后，回传 `ECHO: <原文>`

本任务还不接 OpenClaw。OpenClaw CLI / Gateway 接入留给 Task 03c。

⚠️ PLACEHOLDER: Task 03b 的 envelope payload 使用 `new Uint8Array(32).fill(42)` 作为临时 session key。这个 key 只用于验证端到端数据通路，不是最终安全协议；真正的 machineKey 交换在 Task 04 设计实现。
