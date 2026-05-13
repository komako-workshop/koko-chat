# KokoChat

> Chat-first 的移动 App,容纳多个 AI mini-app。底层蹭用户已经配好的 OpenClaw(Codex / Claude Code 订阅)做能力供给。By Komako.

## Status

迭代中。当前主干能跑:

- **App**(`apps/koko-chat`):Expo / RN,在 iOS 真机/模拟器/Web 跑,WebSocket 直连用户 Mac 上的 OpenClaw Gateway。
- **Mini-app runtime**(`apps/koko-chat/sources/runtime`):`inferOnce` + 长会话原语,fenced block 协议,scoped storage,mini-app 注册表。
- **内置 mini-apps**:
  - `miniapps/tavern` —— 酒馆助手(角色卡推荐)
  - `miniapps/tavern-roleplay` —— 从 Tavern 卡片进入的角色扮演
- **协议层**(`packages/koko-protocol`):envelope / pairing / libsodium 加密(预留给未来 relay 路径)。
- **OpenClaw 客户端**(`packages/koko-openclaw-client`):Gateway Protocol v3,Node + RN 双入口。

## Repo Layout

```
packages/
  koko-protocol/         共享协议(envelope, pairing, libsodium 加密)
  koko-openclaw-client/  OpenClaw Gateway 客户端(Node + RN protocol-only 双入口)
apps/
  koko-chat/             KokoChat 移动 App(Expo / RN)
miniapps/
  tavern/                酒馆角色卡 mini-app + 对应的 OpenClaw skill 源
  tavern-roleplay/       角色扮演 mini-app
openclaw/                给用户机器上 OpenClaw 用的 skill 源 + dist patch 说明
docs/                    mini-app runtime / skills 设计文档
.brand/                  品牌/吉祥物探索资产(生成图被 .gitignore 屏蔽)
```

## Read These First

新人按顺序:

1. [`IDEA.md`](./IDEA.md) — 产品为何存在、不做什么、旧仓库踩过的坑
2. [`DECISIONS.md`](./DECISIONS.md) — 不可逆的工程决定(Gateway 直连、sessionKey、block envelope 等)
3. [`docs/mini-app-runtime.md`](./docs/mini-app-runtime.md) — 内置 mini-app 怎么写
4. [`miniapps/tavern/mobile/README.md`](./miniapps/tavern/mobile/README.md) — 最完整的 mini-app 范例

## Development

前置:

- Node ≥20
- pnpm 10.x
- 本机跑着 OpenClaw,Gateway 监听 `127.0.0.1:18789`(通过 `openclaw qr` 配对)

```bash
pnpm install
pnpm app:dev      # apps/koko-chat 启 expo start --host lan,自动读取 gateway token
```

全 workspace 检查:

```bash
pnpm lint
pnpm test
pnpm typecheck
```

## Owner

Komako · B 站 @komako · GitHub @Eyelids
