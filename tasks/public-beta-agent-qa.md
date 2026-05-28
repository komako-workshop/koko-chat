# 任务:公开测试前 AI Agent 端到端 QA

## 背景

KokoChat 现在是一个移动端 OpenClaw companion app。公开测试前最大的风险不是单个 UI
bug,而是多层系统组合后的不确定性:

- App 本身是 Expo / React Native / Expo Router
- 后端推理依赖本地或云端 OpenClaw Gateway
- OpenClaw 版本、Node 版本、技能安装状态、网络环境都可能不同
- App 内有 3 个 mini-app:
  - Koko 通用助手
  - Deeply 知识探索 / 课程讲解 / 课程库
  - Tavern 角色卡搜索 / 角色扮演
- Deeply 和 Tavern 都依赖 OpenClaw agent 推理、工具调用、长时间 `agent.wait`、session
  restore、后台/前台恢复等复杂路径

本任务是**测试需求**,不是修复需求。执行 Agent 应该尽量模拟真实公开测试用户行为,
记录可复现问题、日志和证据。除非用户另行授权,不要直接改代码。

## 总目标

1. 在多种 OpenClaw 版本和运行环境下验证 KokoChat 能完成配对、连接、推理和恢复。
2. 覆盖 3 个 mini-app 的核心 use case 和高风险边界条件。
3. 重点验证移动端生命周期:
   - app 切后台 / 回前台
   - 网络中断 / 恢复
   - WebSocket 断开 / 重连
   - OpenClaw 仍在后台推理但手机暂时没收到事件
4. 输出一份可用于公开测试 gate 的 QA 报告:
   - 阻塞问题
   - 高风险问题
   - 可接受的小问题
   - 复现步骤
   - 截图 / 录屏 / 日志

## 执行原则

- **报告优先**:默认只测试和记录,不要修代码。
- **真实用户路径优先**:尽量通过手机 UI / iOS Simulator / Expo Go / TestFlight 操作,不要只调内部函数。
- **证据必须可追溯**:每个 bug 至少给出时间、环境、OpenClaw 版本、app 构建方式、复现步骤、预期、实际。
- **日志要脱敏**:setup code、token、deviceToken、公网 IP、用户私有内容在报告中打码。
- **不要破坏用户本机状态**:不要清理 `~/.openclaw`、不要删除 app 数据、不要重置 Git 工作区,除非明确写入该测试步骤并先备份。

## 代码和配置入口

主要代码路径:

```text
apps/koko-chat/                         # Expo app
apps/koko-chat/sources/state/gateway.ts # Gateway 连接、重连、消息同步
apps/koko-chat/sources/gateway/         # RN WebSocket client / pairing
apps/koko-chat/app/chat/[id].tsx        # 通用聊天 UI
miniapps/deeply/mobile/                 # Deeply mini-app
miniapps/tavern/mobile/                 # Tavern 搜索 mini-app
miniapps/tavern/roleplay/mobile/        # Tavern 角色聊天 mini-app
```

本机 OpenClaw 常见日志:

```text
~/.openclaw/logs/gateway.log
~/.openclaw/logs/gateway.err.log
~/.openclaw/agents/<agent-id>/sessions/*.jsonl
~/.openclaw/agents/<agent-id>/sessions/*.trajectory.jsonl
~/.openclaw/devices/paired.json
```

注意:不要把完整 token / deviceToken 原样贴进报告。

## 测试环境矩阵

### App 运行形态

至少覆盖:

1. **Expo Go / dev bundle**
   - 本机 `pnpm --dir apps/koko-chat dev`
   - iOS Simulator 或真机 Expo Go 连接
   - 用于快速复现 JS / React Native 生命周期问题
2. **TestFlight / release bundle**
   - 用最新 main 打包后的 TestFlight
   - 用于最终验证 iOS release 生命周期、权限、ATS、本地网络、后台行为
3. **iOS Simulator**
   - 优先用 Codex / computer use 操作模拟器
   - 适合录屏、自动点击、重复测试
4. **真机 iPhone**
   - 至少做一次 TestFlight 核心回归
   - 重点看本地网络权限、后台挂起、蜂窝/Wi-Fi 切换

### OpenClaw 运行环境

至少覆盖:

1. **开发者本机 OpenClaw**
   - 当前已安装版本
   - 当前用户真实 `~/.openclaw` 配置
2. **干净本机配置**
   - 使用临时 `OPENCLAW_HOME` 或等价隔离目录
   - 只安装 KokoChat 需要的 skills
   - 验证新用户首次配对体验
3. **阿里云 ECS:latest**
   - Linux ECS
   - Node LTS
   - 安装 npm 最新 OpenClaw
   - Gateway 通过公网 `wss://` 或 SSH tunnel 暴露给手机
4. **阿里云 ECS:previous stable**
   - 用 `npm view openclaw versions --json` 查可用版本
   - 选择 latest 前一个 minor/patch 版本
   - 验证 API 兼容性
5. **阿里云 ECS:当前用户本机同版本**
   - 用 `openclaw --version` 记录本机版本
   - ECS 安装同版本,排除 OS 差异

每个环境记录:

```text
OpenClaw version:
Node version:
OS:
Gateway URL shape: ws://LAN / wss://public / SSH tunnel / Cloudflare tunnel
KokoChat app mode: Expo Go / TestFlight / Simulator
App commit:
```

### OpenClaw skills 状态矩阵

至少测三种:

1. skills 全部已安装:
   - `kokochat-pairing`
   - `kokochat-deeply-research`
   - `kokochat-tavern-search`
   - `kokochat-tavern-roleplay`
2. 缺少 Tavern skills
   - 预期:app 给出可理解错误或 OpenClaw 报告缺 skill,不能白屏/卡死
3. 缺少 Deeply skills
   - 预期同上

## 云环境搭建要求

执行 Agent 可以用阿里云 ECS 创建测试机,但要遵守:

1. 不把 Gateway 裸奔开放给公网长期使用。
2. 如果需要公网访问:
   - 优先使用临时 `wss://` 反代 + 强 token
   - 或 SSH tunnel / Cloudflare tunnel
   - 测试结束后关闭安全组端口和测试进程
3. 每台 ECS 测完记录:
   - 公网访问方式
   - Gateway 端口
   - OpenClaw 版本
   - 是否安装 skills
   - 测试结束是否清理

## 核心测试场景

### A. 配对与连接

#### A1. 首次配对

步骤:

1. 安装/打开 KokoChat。
2. 进入配对页。
3. 使用 OpenClaw 生成 setup code。
4. 粘贴配对。
5. 回到聊天列表。

预期:

- 配对成功。
- 连接状态为 connected。
- app 重启后仍可自动重连。
- `~/.openclaw/devices/paired.json` 出现对应设备,但报告中不要泄露 token。

#### A2. 本地网络权限

步骤:

1. TestFlight 首次连接局域网 OpenClaw。
2. 如果 iOS 弹本地网络权限,选择允许。
3. 再测一次选择不允许或撤销权限后的表现。

预期:

- 允许时能连接。
- 拒绝时 app 不应白屏,应出现可理解连接错误。

#### A3. 错误 setup code

步骤:

1. 粘贴损坏 JSON / 缺 token / 错 URL / 不可达 URL。

预期:

- 显示明确错误。
- 不创建半坏连接状态。
- 后续可重新粘贴正确 code。

### B. Koko 通用助手

#### B1. 基础聊天

步骤:

1. 打开默认 Koko conversation。
2. 发送普通问题。
3. 等待流式回复完成。

预期:

- 输入框在 agent 生成期间锁定。
- streaming 完成后解锁。
- 列表 preview 更新。
- 退出再回来滚动位置合理。

#### B2. 生成中切后台

步骤:

1. 发送一个需要 15-60 秒的复杂问题。
2. agent 开始生成后立刻切后台。
3. 分别等待 5 秒、30 秒、2 分钟后回前台。

预期:

- app 不应把进行中的请求误标失败。
- 如果 WebSocket 仍可用,应继续接收。
- 如果 WebSocket 已断,回前台后应重连并从 `chat.history` 补回最终回复。
- 不应出现永久 waiting、重复消息、输入框提前解锁。

#### B3. 网络中断

步骤:

1. 发送消息后开启飞行模式 / 断 Wi-Fi。
2. 等待 10-30 秒。
3. 恢复网络。

预期:

- app 状态可恢复。
- 用户能继续发送。
- 若远端已完成回复,能补历史。

### C. Deeply 知识探索

#### C1. 从 + 菜单新建 Deeply

步骤:

1. 点击聊天列表 `+`。
2. 选择 Deeply。
3. 重复创建两次。

预期:

- 每次创建新 Deeply conversation。
- 旧 row 点击回到旧对话。
- 不应该总是打开 singleton。

#### C2. 推荐卡与 brief cache

步骤:

1. 在 Deeply 里聊天,触发推荐卡。
2. 点击推荐卡打开详情 sheet。
3. 关闭再打开同一张卡。

预期:

- 第一次可能 loading。
- 第二次命中 cache,不应重新长时间 loading。
- sheet 内容不应空白。
- 打开 sheet 时推荐卡不要被完全遮住。

#### C3. 推荐卡开始课程

步骤:

1. 从推荐卡详情页点开始讲解。
2. 等待 outline 生成。
3. 开始第 1 节。
4. 使用快捷回复问一个追问。
5. 继续下一节。

预期:

- outline 可解析,目录显示正常。
- 每节标题不重复。
- 讲解结束后 quick replies 正常出现。
- 输入框锁定状态正确。

#### C4. Deeply 自定义课程:研究主题 auto 节数

步骤:

1. 打开定制课程。
2. 选择「深度调研」。
3. 节数选择「自动」。
4. 输入 3 个不同主题:
   - 一个窄主题
   - 一个中等复杂主题
   - 一个很大/跨学科主题

预期:

- agent 自行决定节数。
- 不应固定偏短。
- 窄主题和大主题的节数应有明显差异。
- outline 的每节 sources 是真实 URL。

#### C5. Deeply 自定义课程:链接 auto 节数

步骤:

1. 选择「基于链接」。
2. 节数选择「自动」。
3. 分别输入:
   - 一篇短博客
   - 一篇长文/论文
   - 一个抓取失败或受限链接

预期:

- 对短资料不强行拆太碎。
- 对长资料不强行压成少数几节。
- 抓取失败时有搜索 fallback 或清晰错误。

#### C6. Deeply 一本书入门 auto 节数

步骤:

1. 选择「从一本书入门」。
2. 节数选择「自动」。
3. 输入:
   - 《活着》
   - Sapiens
   - 一个同名歧义书名

预期:

- 歧义书名先出候选,不直接讲错书。
- 选定候选后 outline 与原书章节/结构有对应关系。
- auto 节数不应明显过短。

#### C7. Deeply 课程库

步骤:

1. 打开课程库首页。
2. 进入每个类目。
3. 点击「查看全部」。
4. 打开书详情。
5. 点击相关书。
6. 从书详情开始课程。

预期:

- API 走 `https://deeply.plus` 正常。
- 类目图 / 书封面加载正常。
- 无封面的书使用色块 + 书名 fallback。
- 聊天列表里的 library course row:
  - 有封面时显示书封面
  - 无封面时显示色块 fallback

#### C8. Deeply 滚动恢复

步骤:

1. 在 Deeply explore/course 页面产生长对话。
2. 滚到中间/顶部。
3. 返回 launcher / 聊天列表。
4. 再进入同一 conversation。

预期:

- 回到原滚动位置,不要随机跳底部/顶部。

### D. Tavern 搜索与角色扮演

#### D1. Tavern 推荐搜索

步骤:

1. 新建 Tavern。
2. 输入角色需求,例如:
   - "找一个温柔但有点病娇的女角色"
   - "找 cyberpunk detective"
   - "找适合轻松聊天的非 NSFW 角色"
3. 查看推荐卡。

预期:

- 返回结构化推荐卡。
- 卡片含名称、简介、标签、图片。
- 失败时有清晰错误,不输出 raw JSON。

#### D2. 点击推荐卡进入角色聊天

步骤:

1. 从 Tavern 推荐卡点击角色。
2. 进入角色聊天页。
3. 等待角色卡加载 + 开场白翻译。

预期:

- 先显示 loading banner。
- 成功后显示角色开场白。
- 输入框解锁。
- 头像和标题正确。

#### D3. 角色卡加载时切后台

这是高优先级回归,覆盖最近发现的问题。

步骤:

1. 从推荐卡点击角色。
2. 看到"角色卡加载中"后立刻把 app 切后台。
3. 分别等待 5 秒、30 秒、2 分钟后回前台。
4. 重复 3 次。

预期:

- 不应出现 `角色卡加载失败：disconnect`。
- 如果开场白翻译已经在 OpenClaw 完成,回前台后应该进入 ready。
- 如果 translation 的读回被连接打断,应 fallback 原文开场白,不阻塞整张卡。
- 不应重复创建角色消息。

#### D4. Browse 预置角色路径

步骤:

1. 打开 Tavern browse。
2. 选择预置/已缓存角色。
3. 进入角色聊天。

预期:

- 如果 summary 带 `prefetched`,应快速 ready,不依赖远程 Character Tavern detail API。
- 无 loading 卡死。

#### D5. 角色聊天主流程

步骤:

1. 进入已 ready 的角色聊天。
2. 发送一轮普通对话。
3. 发送一轮包含动作描写的对话。
4. 切后台再回来。
5. 再发送一轮。

预期:

- 角色保持人设。
- 不暴露 KokoChat / OpenClaw / Character Tavern 内部 prompt。
- session restore 后仍保持上下文。

#### D6. Character Tavern 不可达

步骤:

1. 模拟手机无法访问 `character-tavern.com`。
2. 从推荐卡点击一个非 prefetched 角色。

预期:

- 显示明确错误。
- 不应永久 loading。
- 用户可以返回或重试。

### E. 后台/前台恢复专项

对以下操作都做 5s / 30s / 2min 三档后台等待:

- Koko 正在流式回复
- Deeply 正在生成推荐卡 brief
- Deeply 正在生成 research outline
- Deeply 正在生成 course section
- Tavern 正在搜索推荐卡
- Tavern 正在加载角色卡 / 翻译 opening message

每档记录:

```text
是否断线:
是否自动重连:
是否补 history:
是否出现重复消息:
是否出现永久 loading:
是否输入框状态错误:
OpenClaw gateway.log 对应时间窗口:
```

### F. OpenClaw 版本兼容专项

在每个 OpenClaw 版本上至少跑:

1. 配对
2. Koko 基础聊天
3. Deeply research auto outline
4. Deeply library book course
5. Tavern recommendation search
6. Tavern roleplay bootstrap
7. 后台 30 秒恢复

重点记录 API 兼容问题:

- `chat.send`
- `agent.wait`
- `chat.history`
- `sessions.create`
- `sessions.send`
- `sessions.delete`
- `agents.list`
- `agents.create`

如果某版本不支持某 API,不要只写"失败",要记录 OpenClaw 返回的 exact error
message 和对应版本。

## 验收标准

### Blocking,公开测试前必须修

- App 崩溃 / 白屏
- 配对后无法连接 OpenClaw
- Koko 无法完成基础聊天
- Deeply 无法开始课程或 outline 大面积解析失败
- Tavern 推荐卡点击后大概率无法进入角色聊天
- 后台回前台导致进行中的任务稳定失败
- 输入框永久锁定或在 agent 仍生成时提前解锁
- 消息历史丢失或错乱

### High,建议公开测试前修

- OpenClaw latest 和当前本机版本行为明显不一致
- TestFlight 能复现但 Expo Go 不能复现的生命周期 bug
- Deeply auto 节数明显偏短或偏长
- Tavern 角色卡加载偶现 `disconnect` / `not connected`
- 课程库 API 慢或失败后没有 retry / 错误态

### Medium,可以带着公开测试但要记录

- 单个封面图加载失败
- 个别推荐质量不好
- 某些 prompt 输出风格不稳定
- 视觉 polish 问题

## 报告格式

最终输出一个 Markdown 报告,建议结构:

```markdown
# KokoChat Public Beta QA Report

## Summary
- Overall verdict: GO / NO-GO / GO WITH RISKS
- App commit:
- Test date:
- Tester agent:

## Environment Matrix
| ID | App mode | Device | OpenClaw version | OS | Gateway URL shape | Result |

## Blocking Findings
### P0-1 Title
- Environment:
- Steps:
- Expected:
- Actual:
- Evidence:
- Logs:
- Suspected layer: App / OpenClaw / network / third-party API / prompt

## High Findings
...

## Passed Core Flows
...

## OpenClaw Compatibility Notes
...

## Background / Reconnect Notes
...

## Raw Evidence Index
- screenshots/
- recordings/
- logs/
```

每个 finding 必须有最小复现步骤。不能复现但观察到过的问题标记为 `intermittent`,
并说明尝试次数。

## 建议执行顺序

1. 本机 Expo Go 快速 smoke:配对、Koko、Deeply、Tavern 各一条主路径。
2. 本机 Expo Go 后台恢复专项,尤其 Tavern 角色卡加载中切后台。
3. TestFlight 真机跑同样 smoke + 后台恢复。
4. 阿里云 ECS latest OpenClaw 跑核心矩阵。
5. 阿里云 ECS previous OpenClaw 跑核心矩阵。
6. 汇总 API 兼容差异和可公开测试风险。

## 已知重点风险提示

1. **iOS 后台不是可靠长连接环境。**
   正确预期不是"后台一直保持 WebSocket",而是"前台回来后健康检查、必要时重连、从
   `chat.history` 补齐结果"。

2. **OpenClaw agent run 可能已经成功,但手机端读回失败。**
   遇到 app 显示失败时,必须同时查 gateway log 和 agent session trajectory。不要只看
   手机 UI。

3. **Expo Go 和 TestFlight 不完全等效。**
   Expo Go 能验证大部分 JS/RN 逻辑,但 TestFlight 才能验证 release 生命周期、本地网络权限、
   后台挂起、ATS 等最终行为。

4. **Deeply / Tavern prompt 输出不是确定性单元测试。**
   质量问题要多次采样,记录分布,不要只用一次结果下结论。
