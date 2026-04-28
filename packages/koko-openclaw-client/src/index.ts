// Protocol layer (cross-platform: Node, browser, React Native).
// These don't touch the `ws` Node package or node:* APIs.
export * from "./device";
export * from "./errors";
export * from "./frames";
export * from "./handshake";
export * from "./types";

// Node-only transport. Re-exported here for backwards compatibility with
// packages that still run on Node (tests, archive/koko-cli). RN / browser
// consumers should NOT import this — they should use the protocol layer
// above and bring their own WebSocket transport (see apps/koko-chat).
//
// Metro (RN bundler) will try to resolve this file's `import "ws"` and fail.
// Those consumers should import the protocol-only entry:
//   import { ... } from "@koko/openclaw-client/protocol"
// which is wired up via the package.json exports map.
export * from "./client";
