# KokoChat

> Chat-first 的移动 App,容纳多个 AI mini-app。底层蹭用户已经配好的 OpenClaw(Codex / Claude Code 订阅)做能力供给。By Komako.

## 这是什么

KokoChat 是基于 OpenClaw 的移动端 agent 开源平台。

你在 Mac 上跑着 OpenClaw,KokoChat 把它装到手机上,并且开放一套 mini-app 容器架构——任何人都可以在它之上写自己的移动端 agent。

仓库里已经内置了几个参考实现:Koko 聊天助手、酒馆角色卡、角色扮演。它们是样例,不是产品边界,真正的目标是让社区往里塞更多东西。

## 怎么用

跟 ChatGPT / Character.AI 这种"一个聊天界面"的形态不同,KokoChat 想长成"多个 AI 小程序同时活在一个聊天 App 里"的样子。

* **主聊天里有一个常驻的 AI 小搭子 Koko**:你说话不需要明确"我想用哪个功能",Koko 听懂你的意图,该召唤哪个 mini-app 就召唤哪个。
* **每个具体场景是一个独立 mini-app**:有自己的 chat surface、UI 页面、本地存储、OpenClaw 一侧的 skill / agent。可以是工具、可以是娱乐、可以是长会话型的玩法。
* **mini-app 是会越来越多的**。第一版只内置一个,后面会逐步加。开发者 / 用户也可以自己写。
* **数据在你手里**:聊天记录、角色卡、笔记 source、persona——全部留在你的手机和你的 OpenClaw 机器上,不上传任何云。

当前内置的 mini-app:

* **酒馆**(`miniapps/tavern`):从 character-tavern.com 推荐 / 浏览 AI 角色卡。预置 440 张中文译名 / 中文 tagline 的二次元向卡片,从广场进入秒开聊天。
* **酒馆角色聊天**(`miniapps/tavern-roleplay`):点角色卡进入的角色扮演会话。SillyTavern V2 卡完整 binding、`{{user}}/{{char}}` 替换、persona 设置一次全局生效。

下一步:打算做 Notebook 形态(基于一组用户信任的资料的 scoped chat,参考 NotebookLM 但 agent 主动 bootstrap 资料、用户做减法)、学习/陪读类、digest 类。

## 设计原则

KokoChat 的几条不会动摇的设计判断:

1. **Chat-first**——主对话是产品的家,不是入口跳板。所有 mini-app 都从主对话被召唤出来。
2. **Mini-app 容器,不是 chatbot wrapper**——每个 mini-app 拥有自己的 surface 和数据,host 只管聊天 UI / 路由 / 持久化。
3. **借 OpenClaw 启动期借势,但不绑死身份**——OpenClaw 是当前的 capability provider,以后可以换、可以加,产品身份不锁。
4. **不卖 token、不卖订阅**——AI 能力来自你已有的 Codex / Claude Code 等订阅,KokoChat 只是把它移动化。
5. **用户自治**——数据在你手机 + 你 Mac,KokoChat 没有云端账号体系,也没打算做。

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

## OpenClaw Setup

KokoChat 的手机 App 只负责 UI、配对和本地聊天记录。真正的 AI 能力、角色卡搜索、角色扮演 agent 都跑在用户自己的 OpenClaw 里。第一次使用前，需要在 OpenClaw 机器上安装 KokoChat 支持。

拿到公开仓库后，先 clone:

```bash
git clone https://github.com/Eyelids/koko-chat.git
cd koko-chat
```

如果你已经 clone 了这个仓库，在仓库根目录运行:

```bash
pnpm install
pnpm openclaw:install
```

等价的 Node 入口:

```bash
node scripts/install-openclaw-support.mjs
```

这个脚本会做这些事:

- 确认 OpenClaw CLI 可用。
- 创建缺失的 `koko`、`tavern`、`tavern-roleplay` agents。
- 安装 `kokochat-pairing` 到默认 OpenClaw workspace。
- 安装 `kokochat-tavern-search` 到 `tavern` agent workspace。
- 安装 `kokochat-tavern-roleplay` 到 `tavern-roleplay` agent workspace。
- 用 `openclaw skills info` 验证这些 skills 能被目标 agent 看见。

安装完成后，打开 KokoChat 的「配对 OpenClaw」页面，复制页面生成的配对请求发给 OpenClaw。OpenClaw 会批准设备并返回 KokoChat 连接码。

检查安装计划但不改机器:

```bash
node scripts/install-openclaw-support.mjs --dry-run
```

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
