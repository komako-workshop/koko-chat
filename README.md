# KokoChat

> Mini-app-first 的移动 App,容纳多个 AI 小程序和对话 surface。底层蹭用户已经配好的 OpenClaw(Codex / Claude Code 订阅)做能力供给。By Komako.

## 这是什么

KokoChat 是基于 OpenClaw 的移动端 agent 开源平台。

你有一台运行 OpenClaw 的服务器或电脑,KokoChat 把它装到手机上,并且开放一套 mini-app 容器架构——任何人都可以在它之上写自己的移动端 agent。

仓库里已经内置了几个参考实现:Koko 聊天助手、酒馆角色卡、角色扮演。它们是样例,不是产品边界,真正的目标是让社区往里塞更多东西。

## 怎么用

跟 ChatGPT / Character.AI 这种"一个聊天界面"的形态不同,KokoChat 想长成"多个 AI 小程序共用一套本地运行时"的样子。

* **Koko 是内置 AI 小搭子,但不是唯一入口**:主聊天可以召唤 mini-app,launcher / 独立页面 / 自定义 chat surface 也都是合法入口。
* **每个具体场景是一个独立 mini-app**:有自己的入口、surface、UI 页面、本地存储、OpenClaw 一侧的 skill / agent。可以是工具、可以是娱乐、可以是长会话型的玩法。
* **mini-app 是会越来越多的**。第一版只内置一个,后面会逐步加。开发者 / 用户也可以自己写。
* **数据在你手里**:聊天记录、角色卡、笔记 source、persona——全部留在你的手机和你的 OpenClaw 机器上,不上传任何云。

当前内置的 mini-app:

* **酒馆**(`miniapps/tavern`):从 character-tavern.com 推荐 / 浏览 AI 角色卡。预置 440 张中文译名 / 中文 tagline 的二次元向卡片,从广场进入秒开聊天;角色聊天由隐藏的 `tavern-roleplay` conversation mode 承接。
* **Deeply**(`miniapps/deeply`):AI 课程化深度学习。在「知识探索」chat 里聊兴趣→点「推荐课程」出几张课题卡→任意一张展开成「按目录推进」的课程讲解(自动生成大纲、一节一轮、底部好奇点 chip、右上目录跳转)。整套交互对齐 deeply.plus 原版,但跑在用户自己的 OpenClaw agent 上。

下一步:打算做 Notebook 形态(基于一组用户信任的资料的 scoped chat,参考 NotebookLM 但 agent 主动 bootstrap 资料、用户做减法)、digest 类。

## 设计原则

KokoChat 的几条不会动摇的设计判断:

1. **Mini-app-first, conversation-native**——KokoChat 是 mini-app 容器。Conversation 是共享原语,不是所有 mini-app 的唯一形态。
2. **Mini-app 容器,不是 chatbot wrapper**——每个 mini-app 拥有自己的入口、surface 和数据,host 提供 OpenClaw 连接、本地存储、路由壳和可复用聊天组件。
3. **借 OpenClaw 启动期借势,但不绑死身份**——OpenClaw 是当前的 capability provider,以后可以换、可以加,产品身份不锁。
4. **不卖 token、不卖订阅**——AI 能力来自你已有的 Codex / Claude Code 等订阅,KokoChat 只是把它移动化。
5. **用户自治**——数据在你手机 + 你的 OpenClaw 服务器,KokoChat 没有云端账号体系,也没打算做。

## Status

迭代中。当前主干能跑:

- **App**(`apps/koko-chat`):Expo / RN,在 iOS 真机/模拟器/Web 跑,默认通过 KokoChat relay 连接用户 OpenClaw 机器上的 Gateway。
- **Mini-app runtime**(`apps/koko-chat/sources/runtime`):`inferOnce` + 长会话原语,fenced block 协议,scoped storage,mini-app / conversation mode 注册表。
- **内置 mini-apps**:
  - `miniapps/tavern` —— 酒馆助手(角色卡推荐)
  - `miniapps/tavern-roleplay` —— 酒馆的隐藏角色聊天 mode,从 Tavern 卡片进入
  - `miniapps/deeply` —— Deeply 知识探索 + 课程讲解;自家 chat surface,不复用 host 共享聊天页
- **协议层**(`packages/koko-protocol`):envelope / pairing / libsodium 加密。
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
  tavern-roleplay/       酒馆隐藏角色聊天 mode
  deeply/                Deeply 学习 mini-app(knowledge explore + 课程讲解)
openclaw/                给用户机器上 OpenClaw 用的 skill 源 + dist patch 说明
docs/                    mini-app runtime / skills 设计文档
.brand/                  品牌/吉祥物探索资产(生成图被 .gitignore 屏蔽)
```

## Read These First

新人按顺序:

1. [`IDEA.md`](./IDEA.md) — 产品为何存在、不做什么、旧仓库踩过的坑
2. [`DECISIONS.md`](./DECISIONS.md) — 不可逆的工程决定(relay / Gateway、sessionKey、block envelope 等)
3. [`docs/mini-app-runtime.md`](./docs/mini-app-runtime.md) — 内置 mini-app 怎么写
4. [`miniapps/tavern/mobile/README.md`](./miniapps/tavern/mobile/README.md) — 最完整的 mini-app 范例

## OpenClaw Setup

KokoChat 的手机 App 只负责 UI、配对和本地聊天记录。真正的 AI 能力、角色卡搜索、角色扮演 agent 都跑在用户自己的 OpenClaw 里。第一次使用前，需要在 OpenClaw 机器上安装 KokoChat 支持。

OpenClaw 机器上需要有 `git`、`node` 和 `openclaw` CLI。KokoChat 支持的最低 OpenClaw 版本是 `2026.4.15`；如果检测到更早版本，安装脚本会先把 OpenClaw 升级到固定版本 `2026.5.22`，再写入 KokoChat 的 agent、skill 和 allowlist 配置。直接安装 / 更新:

```bash
KOKOCHAT_REPO="${HOME}/.kokochat/koko-chat"
mkdir -p "$(dirname "$KOKOCHAT_REPO")"
if [ -d "$KOKOCHAT_REPO/.git" ]; then
  git -C "$KOKOCHAT_REPO" pull --ff-only
else
  git clone https://github.com/komako-workshop/koko-chat.git "$KOKOCHAT_REPO"
fi
node "$KOKOCHAT_REPO/scripts/install-openclaw-support.mjs"
```

低版本升级时 Gateway 可能会短暂断开并重启一次。等脚本完整结束后，再回到 KokoChat 粘贴连接码；如果手机还没恢复连接，先等十几秒，或在 OpenClaw 机器上手动运行一次 `openclaw gateway restart`。

KokoChat 默认走官方 relay。手机不需要和 OpenClaw 服务器在同一局域网，OpenClaw Gateway 也不需要暴露 LAN 端口。`kokochat-pairing` 会在 OpenClaw 机器上启动一个本地 connector；手机连 relay，connector 再连本机 OpenClaw Gateway；relay 只转发 WebSocket 帧，不直接连接你的 Gateway。

如果你要改用自托管 relay，在生成连接码前设置:

```bash
export KOKOCHAT_RELAY_URL=ws://<relay-host>:8787
```

如果你在开发这个仓库，也可以在仓库根目录运行:

```bash
pnpm install
pnpm openclaw:install
```

等价的 Node 入口:

```bash
node scripts/install-openclaw-support.mjs
```

这个脚本会做这些事:

- 确认 OpenClaw CLI 可用，并在 `openclaw < 2026.4.15` 时先升级到 `2026.5.22`。
- 创建缺失的 `koko`、`deeply`、`tavern`、`tavern-roleplay` agents。
- 安装 `kokochat-pairing` 到默认 OpenClaw workspace。
- 安装 `kokochat-tavern-search` 到 `tavern` agent workspace。
- 安装 `kokochat-tavern-roleplay` 到 `tavern-roleplay` agent workspace。
- 安装 `kokochat-deeply-research` 到 `deeply` agent workspace。
- 自动把这些 skills 写入对应 agent 的 allowlist。
- 自动写入 KokoChat 小程序 agent 指令，并给 `tavern` agent 开启必要的 `exec` 工具权限和脚本 allowlist。
- 用 `openclaw skills info` 验证这些 skills 能被目标 agent 看见；旧版 OpenClaw CLI 不支持按 agent 查询时会跳过对应验证。
- 如果脚本刚刚升级了 OpenClaw，会在配置写完后 best-effort 重启 Gateway，让正在运行的服务切到新版本。

安装完成后，打开 KokoChat 的「配对 OpenClaw」页面，复制页面生成的内容发给 OpenClaw。那段内容会指向本节说明，并附带当前手机的 `kokochat.pairingRequest`。如果 OpenClaw 还没装 KokoChat 支持，先按本节安装 / 更新；装好后用 `kokochat-pairing` 批准请求并返回 KokoChat 连接码。低版本自动升级后，第一次配对可能需要等待 Gateway 重连完成，再重新发送同一段配对请求。

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

只想单独调 Deeply mini-app(在电脑浏览器,只显示 Deeply,带手机框比例):

```bash
pnpm deeply:web   # 内部:KOKO_DEMO_APP=deeply expo start --web,localhost:8081 直接进 /deeply
```

全 workspace 检查:

```bash
pnpm lint
pnpm test
pnpm typecheck
```

## Owner

Komako · B 站 @komako · GitHub @Eyelids
