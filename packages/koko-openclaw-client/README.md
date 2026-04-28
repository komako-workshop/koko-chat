# @koko/openclaw-client

OpenClaw Gateway Protocol v3 的纯 TypeScript 客户端。

**身份**：可独立使用的 workspace 包，不依赖 `@koko/cli` 或 `@koko/relay`。
**消费方**：
- `@koko/cli`（Node 端，通过 `ws` 连 `ws://127.0.0.1:18789`）
- 未来可能的 `apps/koko-chat`（RN 端，通过 `WebSocket` 全局对象连 Gateway，若走 Tailscale / 公网 Cloudflare Tunnel）

参考实现：[`ngmaloney/clawchat/src/lib/gateway-client.ts`](https://github.com/ngmaloney/clawchat/blob/main/src/lib/gateway-client.ts)

详见 `tasks/03a-openclaw-client.md`（待写）。
