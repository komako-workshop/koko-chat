# @koko/openclaw-client

OpenClaw Gateway Protocol v3 的纯 TypeScript 客户端。

## 两个入口

- `@koko/openclaw-client` —— Node 入口,包含 `ws` 传输实现(供 Node 端测试 / 工具用)。
- `@koko/openclaw-client/protocol` —— 协议层(device / errors / frames / handshake / types),不依赖 `ws` 或 `node:*` API,**RN / 浏览器消费方必须用这个**,自带 WebSocket 传输。

详见 `src/index.ts` 顶部的说明,以及 `apps/koko-chat/sources/gateway/BrowserGatewayClient.ts` 是怎么在 RN 里组装协议层 + 全局 `WebSocket` 的。

## 当前消费方

- `apps/koko-chat` —— 通过 protocol-only 入口在 RN 里跑。

## 参考实现

[`ngmaloney/clawchat/src/lib/gateway-client.ts`](https://github.com/ngmaloney/clawchat/blob/main/src/lib/gateway-client.ts)
