// Protocol-only entry for platforms that don't have Node's `ws` package
// (browsers, React Native). No transport layer is included — the consumer
// must supply their own WebSocket.
//
// See apps/koko-chat/sources/gateway/BrowserGatewayClient.ts for an example.
export * from "./device";
export * from "./errors";
export * from "./frames";
export * from "./handshake";
export * from "./types";
