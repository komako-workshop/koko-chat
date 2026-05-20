# KokoChat — Idea & Direction

> KokoChat 是一个 mini-app-first 的移动端 app，最终长成“能装很多 skill + GUI surface”的容器。
> 起步阶段对接 OpenClaw 作为底层 agent / capability provider，但产品身份不绑死 OpenClaw。
> 出品方是 Komako（B 站 ID @komako, AI 应用方向 creator）。

这份文档是 KokoChat 立项时的判断、定位、和已经做过的功课。
新窗口接着干的人，应该先读完这份文档，再开始写任何代码。

---

## 1. 我们到底在做什么

一句话：**KokoChat 是 OpenClaw 在你手机上的家。**

更完整一点：

- 它是一个 **移动端 app**（React Native / Expo）
- 它对外是 **mini-app-first**：用户进来看到的是多个 AI surface,其中聊天是最重要的原语之一
- 它内部是一个 **mini-app 容器**：每个具体场景（推荐文章、做笔记、规划旅行、陪读一本书、听播客、digest 等）都是一个 mini-app
- mini-app = `skill (语义) + GUI (展示) + store (持久化) + worker (后台)` 的组合
- 所有 mini-app 共享同一个底层 agent / capability provider（当前是 OpenClaw）
- 主对话仍然是“家”，mini-app 是被主对话召唤出来的视图

它不是：

- 不是“另一个 ChatGPT 客户端”
- 不是“另一个 OpenClaw 客户端壳”（那种 GitHub 上已经有 70+ 个）
- 不是“一个 NotebookLM 复刻”
- 不是“一个具体功能产品”（不是文章导读、不是听书、不是收件箱）

它是：

> 一个 **mini-app-first 的 AI surface 容器**，第一阶段在 OpenClaw 上跑，是 OpenClaw 移动端事实上的入口。

---

## 2. 名字 / 品牌

### 产品名：KokoChat（短期），未来可演进为 Koko

参考 QQ 的演化：OICQ → 腾讯 QQ → QQ。

KokoChat 阶段：

- “Chat” 标识形态，让用户立刻知道是 chat-first
- 借创作者 IP 启动期借势：B 站观众一眼认出是 Komako 做的
- 对外简介：**KokoChat — by Komako · built on OpenClaw**

未来 Koko 阶段：

- 当 mini-app 多到“chat”不再准确表达整个产品时，去掉 Chat
- 升级为独立品牌 Koko，可以装 KokoNotebook / KokoDigest 等

### 不叫什么、为什么不叫

讨论过的、被否掉的命名方向，避免下一个窗口再绕回来：

| 否掉的方向 | 否掉的核心理由 |
|---|---|
| ClawChat | GitHub 上 70+ 同名小客户端，独占失败；锁死 OpenClaw 客户端身份 |
| ClawDock / ClawPort / ClawMate | 仍然带 Claw 字根，继承 ClawChat 的两个问题 |
| OpenShell | 撞 Windows OpenShell 工具，且 “Shell” 暗示开发者工具 |
| Dobby | 别人 IP（哈利波特），且锁成“仆人”角色 |
| PinkCat | 具象角色 + 萌系锁死，未来扩展不了 |
| Meow | 角色化，易被锁成 AI 朋友形态；可作为子产品 / 通知名 |
| Cove | 实测：Google Play、GitHub `cove/getcove/coveapp`、`cove.dev` 全被占；一个叫 Cove 的公司在用 |
| 裸 Isle / Land / Sea | 被海量游戏 / 旅游 / NFT / 房地产占满 |
| Inner Isle | 是这次讨论里最稳的独立品牌候选，但中文用户认知成本仍然高于 KokoChat |
| OpenShell / 裸 Open- 前缀 | OpenAI / OpenSea 等强势品牌挤压，新 Open- 名字会被淹 |

最终选 KokoChat 的核心理由：

- 借 Komako B 站 IP 启动期借势（2000+ 粉丝是真实数字）
- 中文圈口感好，和 QQ 同类 vibes
- 创作者品牌延续性强（视频和产品形成自然的内容闭环）
- 未来可去掉 Chat 升级为 Koko

接受的 trade-off：

- 国际市场上 “Koko” 重名严重（Koko Health、Koko 巧克力等）
- “Chat” 后缀有 Inner Isle / Den 不锁形态那种品牌野心不够
- 借 IP 启动 = 短期天花板被 IP 影响（接受这一点）

### 占用情况实测（2026-04-28）

GitHub：

- `kokochat` — 已被占（个人占位，非活跃产品）
- `koko` — 已被占（个人，88 仓库，非活跃产品）
- `kokoapp` — 已被占（个人，8 仓库，非活跃产品）
- `koko-chat` — 可拿 ✓ ← 本仓库使用这个名字
- `getkoko` — 可拿
- `kokolab` / `kokohq` / `hellokoko` 等变体 — 推断可拿

域名：

- `kokochat.com` — 有人挂着内容，需要单独看是否 parking
- `kokochat.app` — 待 WHOIS 确认
- `koko.com / koko.app / koko.ai` — 大概率被占且贵

行动项（你需要自己手动做）：

- 尽快注册 `kokochat.app` / `kokochat.dev` / `getkoko.com` 中的至少一个
- 微信公众号 / 小红书 / B 站子号 / Twitter handle 上占住 KokoChat 名字
- App Store Connect / Google Play Console 创建 placeholder app entry

---

## 3. 出品方 / 视觉

- 出品方：**Komako**（komako · B 站）
- B 站官方对外说法：“Komako 做的 KokoChat”
- App 启动页 / About 页：a Komako project · built on OpenClaw

视觉方向（未来定，不在 MVP 范围）：

- 一个绿色小生物作为吉祥物
- 不要用 Dobby（IP 风险）
- 不要复刻具体角色，原创即可
- 萌但不幼稚，能撑住 30+ 用户的认真感
- 候选生物形象：小章鱼（多手 = 多 mini-app）/ 小青蛙 / 小苔藓人 / 原创海洋小生物
- 和 OpenClaw 龙虾视觉母体兼容（同一片海）

---

## 4. 架构（要立刻定下来的几件事）

### 三层结构

```text
┌──────────────────────────────────────┐
│ KokoChat host                        │
│  - 主聊天 UI                          │
│  - mini-app launcher                  │
│  - block parser                       │
│  - intent router                      │
│  - OpenClaw client SDK                │
└──────────────────────────────────────┘
              │
              ▼
┌────────────┐ ┌────────────┐ ┌────────────┐
│ mini-app A │ │ mini-app B │ │ mini-app C │
│ skill +    │ │            │ │            │
│ blocks +   │ │            │ │            │
│ pages +    │ │            │ │            │
│ store +    │ │            │ │            │
│ workers    │ │            │ │            │
└────────────┘ └────────────┘ └────────────┘
              │
              ▼
┌──────────────────────────────────────┐
│ OpenClaw                              │
│  - agents (agent:main:main)           │
│  - capabilities (model.run, web.fetch │
│    image, audio, search, memory ...)  │
│  - skills                             │
└──────────────────────────────────────┘
```

### 主对话的位置

主对话是 KokoChat 的一个重要入口,但不是唯一入口,也不是所有
mini-app 的必经入口。mini-app 可以从主对话被召唤,也可以从 launcher、
独立页面、tab 或自己的 chat surface 进入：

- 主对话识别意图 → emit fenced block / intent → 路由给对应 mini-app
- launcher / 页面入口 → 直接打开 mini-app 自己的 surface
- mini-app 自己的页面/store/worker 接管后续体验

### 对接 OpenClaw 的方式

走 main session：

```text
agent:main:main
```

不要走 `/v1/chat/completions`（那是无状态 OpenAI 兼容层，会创建独立 openai:* session，不进入 main session）。

具体接入方式两条路（新仓库要重新决定）：

- **本地 bridge 路径**（旧 openclaw-chat 用过，已验证可行）：spawn `openclaw agent --session-id <main session id> --message ... --json`
- **WebSocket / Gateway 直连**：参考 GitHub 上 `inteye/clawchat`（Dart 版本）这种思路，APP 直接接 OpenClaw Gateway，不走本地 bridge

后者更接近“真正的 OpenClaw mobile client”，不依赖 Mac 本地常驻服务，但需要解决 device pairing / operator token / auth scope 这些问题。

旧仓库在 `~/.openclaw/extensions/wechat/node_modules/openclaw/dist/` 里能找到 OpenClaw 内部对 channel / session / device pairing 的真实实现，新仓库可以认真翻一遍再决定。

新仓库 MVP 阶段建议：

- **先继续用本地 bridge**（已验证可行、最快跑通）
- 但 bridge 要从一开始就被设计成“可拆卸、可被 WebSocket 直连方案替代”
- 不要把 bridge 接口耦合到 UI 上

### 后台异步任务的调用

OpenClaw 有 capability layer，已验证可用：

```bash
openclaw infer model run --gateway --json --prompt ...
openclaw infer web fetch --url ... --json
openclaw infer audio
openclaw infer image
```

后台 worker（生成长导读 / 抓正文 / 转写音频等）应该走 `--gateway` transport。
`--local` transport 会撞 main session file lock，并发会失败（旧仓库实测过）。

并发可以做（旧仓库实测 `--gateway` 三路并发成功），但要加保护：主对话 chat 进来时，应该取消正在跑的后台 child process 让路。

### Mini-app 的最小协议（要慢慢长出来，不要一上来就抽象）

每个 mini-app 应该有：

- `manifest`：id / name / icon / 关联的 skill / 能处理的 fenced block tag / 入口路径
- `skill`：OpenClaw skill，定义 agent 在什么时候做什么、输出什么 fenced block
- `blocks`：agent 输出的 fenced block，KokoChat host 路由给对应 mini-app 渲染
- `pages`：mini-app 自己的 React Native 页面 / 视图
- `store`：mini-app 自己的本地 store（`~/koko-chat/apps/<app-id>/`）
- `workers`：mini-app 自己的后台任务

但 **第一版不要做插件抽象**。先把第一个 mini-app 用硬编码方式写完，再看哪些东西需要抽出来。

---

## 5. 第一个 mini-app：Notebook

经过一整轮讨论，第一个 mini-app 选 **Notebook 形态**，参考 NotebookLM。

### 核心心智

> 用户拥有若干 notebook，每个 notebook 是一组**用户信任的资料**，模型只在这组资料范围内对话、引用、派生。

但 KokoChat 版要比 NotebookLM 多做一件事：

> agent 帮用户从 “一个意图” bootstrap 出第一组资料候选，用户做减法 / 补充，而不是从零做加法。

这是 KokoChat Notebook 区别于 NotebookLM 的核心产品价值。

### MVP 不做 RAG

每个 notebook 限制 5–10 个 source，全文塞 prompt。
6–10 条加起来在主流模型上下文里能装下。
不切片、不 embedding、不向量库。

等用户真的要装 100+ source 时再考虑 RAG。

### Notebook 类型（MVP 内置两种）

- **kind: topic** — 研究一个话题（agent 主动 bootstrap）
- **kind: reading_list** — 用户提供一组要读的链接（agent 不主动加，做导读 + 追问）

trip / project / course 等其他形态以后再加。

### Agent 找资料的原则（写进 skill prompt 里）

- 少而精，6–10 条互补的素材，不是 30 条堆砌
- 优先有作者的内容（博客、长文、章节、论文）
- 优先立场互不重合
- 优先能撑长对话的素材（≥ 2000 字，有原创框架/术语）
- 至少留一条反方/异见

5 个素材池（agent 内部应该能识别）：

- 一手作者博客 / essay
- 真书的真章节
- 长访谈 / 对谈实录（文字版）
- 学术 / 半学术长文（可读性高的）
- 中文一手视角（中文用户优先时必须至少 1 条）

加一类必备：反方 / 异见。

黑名单（不去这些地方找）：

- Medium 上的 personal growth / productivity tag 海量低质文
- LinkedIn influencer 帖
- "X habits / N rules / Top 10" 类 listicle
- Blinkist / 二手书摘网站
- "success story" 鸡汤
- 心理玄学 / 频率宇宙 / 速成
- AI 生成的 SEO 长文
- 标题以数字开头超过 70% 的网站

### 重要规则：URL 必须真实

agent 给 URL 必须经过 `web_fetch` 真实验证可达，不能凭“记忆里大概是这个 URL”。
NotebookLM 类产品最不能犯的错就是给假链接。

### 已经做过功课的种子内容

我们已经为 “AI 时代作为一个大学生应该做什么” 这个 topic 真实 fetch 验证过 4 条 source 可用：

- Paul Graham — *What You'll Wish You'd Known* (https://paulgraham.com/hs.html)
- Paul Graham — *How to Do Great Work* (https://paulgraham.com/greatwork.html)
- Anthropic — *Core Views on AI Safety* (https://www.anthropic.com/news/core-views-on-ai-safety)
- Ted Chiang — *ChatGPT Is a Blurry JPEG of the Web* (https://www.newyorker.com/tech/annals-of-technology/chatgpt-is-a-blurry-jpeg-of-the-web)

新仓库写 Notebook MVP 时可以拿这 4 条作为 demo notebook 的种子。

### 用户路径（MVP）

```text
1. 主对话: 用户说 "我想搞清楚 X"
2. agent: 推断子方向,让用户挑
3. agent: web_search + ClawChat 已有上下文 → 给出 8–12 条候选 source
4. emit candidate cards (强烈推荐 / 备选 / 不确定 三档)
5. 用户勾选保留 6–8 条
6. KokoChat 后台抓正文 + 缓存
7. 进入 notebook 工作区
   - 左: sources
   - 中: scoped chat (只用这组资料回答 + 附 source 引用)
   - 右: overview (mvp 唯一派生物)
```

### 不做（MVP 范围外）

- 真正 RAG / 向量索引
- pdf / audio source
- 跨 notebook 检索
- 推送 / 邮件 / 多设备同步
- 协作
- 多种派生物（只做 overview）
- 自动订阅源 / RSS / 定时抓取

---

## 6. 现有原型（旧 openclaw-chat）已经验证过的事

旧仓库 `../openclaw-chat/` 一行不动，留作参考。
里面已经验证过的有用的事：

- `openclaw infer model run --gateway --json --prompt ...` 可用，三路并发可行
- `openclaw infer web fetch --url ... --json` 可用（部分站点抓不到，需要 fallback HTTP fetch + readability）
- main session 接入：`openclaw agent --session-id <main session id> --message ... --json` 可用
- 走 main session 比走 `/v1/chat/completions` 更对（后者会创建独立 openai 直 session，不进 main）
- main session file lock 在 `--local` infer 下会撞，必须用 `--gateway`
- 主聊天进来时取消后台 article worker 子进程的策略是有效的
- React Native 在 Expo 上做 chat / article-card / reader modal / persisted messages 都可行
- iOS Simulator 在 macOS 26 + Xcode 26 修好后能用
- Web prototype（`:8791/articles`）证明可以用 bridge 同时服务 mobile + web

旧仓库里有 4 份 handoff 文档：

- `openclaw-chat/MOBILE_BRIDGE_STATUS.md`
- `openclaw-chat/HANDOFF_ARTICLE_WEB.md`
- `openclaw-chat/HANDOFF_NOTEBOOK_MVP.md`
- `openclaw-chat/SIMULATOR_ISSUE_HANDOFF.md`

新仓库不带任何旧代码，但开发时可以 cross-reference 这些文档。

---

## 7. 当前已有的可参考第三方实现

讨论过第三方 OpenClaw 客户端的代码可以学习。结论：

- 前端代码参考价值不大（多数是 Flutter / Swift / Vue，KokoChat 用 React Native）
- **OpenClaw 协议层 / WebSocket 直连方式** 值得认真看
- 最值得看的两个：
  - `inteye/clawchat`（Dart, 自称 “Direct WebSocket client，no backend，no limits”）—— 看它怎么直连 Gateway
  - `ngmaloney/clawchat`（TypeScript, desktop）—— 看它怎么处理 OpenClaw session/auth

GitHub 上社区里 OpenClaw 客户端最成功的是 `hillghost86/OpenClawWeChat`（171★，微信小程序），它解决的不是“原生客户端工程结构”问题，是“怎么把 OpenClaw 接到一个真实有用户的入口”。

---

## 8. 工程范围（要避开的坑）

新仓库要从一开始就避开旧仓库踩过的几个具体坑：

- **不要让一个 react state 管所有东西**。chat / article / notebook / bridge state 要拆成独立模块，避免“切个后台回来就乱”
- **不要把 main session history 直接覆盖本地 messages**。canonical sync 要保守，不能把空 history 覆盖非空 UI
- **不要做激进自动 scroll**。两处 useEffect + onContentSizeChange 都 scrollToEnd 会把用户手动滑动抢走
- **AsyncStorage 持久化要从一开始就有**，不要等 bug 出现再补
- **AppState 监听必须有**：APP 切后台再切回来要能正确恢复，不能让 UI 空掉
- **bridge 必须有 busy / 单飞 / cancel 语义**，不能让两个聊天请求并发打架
- **不要让 bridge 后台任务和主聊天抢 OpenClaw**。主聊天进来要让路
- **FlatList key 要稳定**，main session 历史里有重复 message id，不能裸用 m.id 当 key
- **iOS Simulator + Xcode + macOS 版本必须匹配**。否则 Simulator GUI 会 crash（macOS 26 + Xcode 15 是死的）
- **Expo Go 启动时机要稳**：scripts/dev-mobile.sh 要做幂等启动 + 自动选择 booted iPhone

---

## 9. 第一阶段（一周内）的目标

新仓库第一阶段不要追求 mini-app 抽象。
直接做：

1. **bridge 层**：能调 OpenClaw main session，能调 `infer model run --gateway`，能调 `infer web fetch`，能管理 article store 类的本地存储
2. **Notebook 后端**：能 prepare notebook、能加 source、能后台 fetch + 生成 overview、能 scoped chat
3. **Web prototype**：模拟手机聊天窗口 + 右侧 reader pane（旧仓库 `:8791/articles` 已经证明可行）
4. **React Native APP**：先不做。等 Web 上跑顺再做手机端，避免又陷入 UI 调试地狱

第一周做完上述 4 步，能用浏览器演示一个 “建 notebook → 攒 source → 看 overview → scoped chat 追问” 的端到端流程，就算第一阶段达标。

---

## 10. 写在最前面的几条原则

1. **不要再讨论叫什么名字**。已经叫 KokoChat。短期内不会换。
2. **不要再讨论第一个 mini-app 是什么**。已经定 Notebook。短期内不会换。
3. **不要追求 mini-app 框架抽象**。先把一个 mini-app 做扎实，再做第二个，框架自然浮现。
4. **MVP 阶段不上 RAG**。
5. **绝不给假链接**。每条 URL 必须 web_fetch 真实验证。
6. **mobile 暂缓，先做 Web**。Web 上跑顺再做手机。
7. **借 OpenClaw 启动期借势，但不绑死身份**。底层未来可以换。
8. **不删旧仓库 openclaw-chat**。它是历史档案。

---

## 11. 写代码之前先决定的几件事（下一窗口要回答）

新窗口接手后，第一件事不是写代码，是回答这几个问题：

- 是用本地 bridge（Node + spawn `openclaw` CLI），还是直连 Gateway（WebSocket）？建议先用本地 bridge，结构上预留切换空间
- bridge 用什么语言？建议 Node.js（旧仓库已验证），但可以重新评估
- Web prototype 用什么栈？建议无框架原生 HTML + JS（旧仓库已验证），不要急着上 React/Vue
- React Native APP 什么时候做？建议第二阶段
- 文档 / handoff 怎么沉淀？建议每完成一个里程碑就更新本文件 / 加一份 docs/

---

文档结束。
新窗口请基于这份文档继续。
不要回到上面已经讨论过的死循环里。
