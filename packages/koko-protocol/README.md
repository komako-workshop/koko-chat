# @koko/protocol

KokoChat 协议层共享包：@koko/relay / @koko/cli / @koko/app 都依赖。

内容：
- 消息类型 / envelope schema
- E2E 加密封装（基于 libsodium-wrappers）
- HKDF 密钥派生工具
- Ed25519 challenge-response 辅助
- pairing QR 格式编解码

## Development

```bash
pnpm --filter @koko/protocol typecheck
pnpm --filter @koko/protocol build
pnpm --filter @koko/protocol test
```

调用任何加密 helper 前先执行一次：

```ts
import { initCrypto } from "@koko/protocol/crypto";

await initCrypto();
```

详见 `tasks/` 下各模块的任务书。
