# @koko/app

KokoChat 的 React Native APP（Expo）。

职责：
- chat-first UI，第一版不做任何 mini-app
- 扫码配对 → 存 master secret 到 SecureStore
- libsodium-wrappers E2E 加密
- 本地消息持久化（MMKV）
- 后续：mini-app 容器、notebook mini-app 等

脚手架参考：`slopus/happy` 的 `packages/happy-app/`。

详见 `tasks/` 下各模块的任务书。
