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

## Development

```bash
pnpm --filter @koko/app typecheck
pnpm --filter @koko/app web
pnpm --filter @koko/app ios
```

04a 只验证独立 Expo shell：4 个路由屏、Zustand store 分片、MMKV settings 持久化、AppState provider 和 twrnc 样式。workspace 包、pairing、chat 网络流和 iOS simulator smoke 放到后续任务。
