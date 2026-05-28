# iOS Background Task Simulator Test Requirements

## 背景

KokoChat 新增了一个本地 Expo native module：`koko-background-task`。它在 iOS 上通过 `UIApplication.beginBackgroundTask` 给正在进行的 OpenClaw 任务申请一段后台执行时间。

本轮需要验证：用户把 APP 切到后台几分钟内，当前正在进行的回复 / 小程序初始化尽量不中断，回到前台后 UI 状态正常。

注意：Expo Go 无法测试这个能力。必须打 iOS 原生 dev build 或 TestFlight。本文先要求用 iOS Simulator 做第一轮验证。

## 涉及代码

- `apps/koko-chat/modules/koko-background-task/ios/KokoBackgroundTaskModule.swift`
- `apps/koko-chat/sources/runtime/backgroundTasks.ts`
- `apps/koko-chat/sources/state/gateway.ts`
- `apps/koko-chat/sources/runtime/openclaw.ts`
- `miniapps/tavern/roleplay/mobile/index.ts`

## 测试目标

1. Agent streaming 模式支持后台续跑。
   - 普通 Koko 聊天。
   - Tavern 角色聊天。
   - Deeply 主线课程聊天。

2. `inferOnce` 模式支持后台续跑。
   - Tavern 角色卡详情拉取。
   - Tavern first_mes 翻译。
   - Deeply outline / brief / quick replies 这类一次性推理。

3. 前后台切换后状态不坏。
   - 不应无故停在 `handshaking`。
   - 不应把输入框永久锁死。
   - 不应丢角色卡上下文。
   - 出错时要有可重试入口，而不是永远 loading。

## 本地准备

在仓库根目录执行：

```bash
cd /Users/lijianren/Desktop/workspace/koko-chat
pnpm install
pnpm --filter @koko/protocol build
pnpm --filter @koko/openclaw-client build
pnpm typecheck
```

确认原生模块能被 Expo autolinking 识别：

```bash
cd /Users/lijianren/Desktop/workspace/koko-chat/apps/koko-chat
./node_modules/.bin/expo-modules-autolinking resolve --platform apple --json \
  | jq '.modules[] | select(.packageName == "koko-background-task")'
```

期望能看到：

```json
{
  "packageName": "koko-background-task",
  "pods": [
    {
      "podName": "KokoBackgroundTask"
    }
  ],
  "modules": [
    "KokoBackgroundTaskModule"
  ]
}
```

## 打模拟器 dev build

从 app 目录执行：

```bash
cd /Users/lijianren/Desktop/workspace/koko-chat/apps/koko-chat
pnpm exec expo run:ios
```

如果需要指定模拟器：

```bash
pnpm exec expo run:ios --device "iPhone 16 Pro"
```

说明：

- 这个命令可能生成 `apps/koko-chat/ios/`。测试可以用，但不要提交生成的 `ios/` 目录，除非明确决定转 bare workflow。
- 如果 CocoaPods / Xcode 报错，先记录完整错误，不要直接改业务代码绕过去。
- 如果安装的是旧 dev build，先在模拟器删除 KokoChat 再重新安装。

## 配对 OpenClaw

测试前确保 OpenClaw gateway 可用，并且 KokoChat 已配对。

建议同时开日志：

```bash
xcrun simctl spawn booted log stream --predicate 'process == "KokoChat"' --level debug
```

如果 JS 日志没有进入系统 log，可以同时保留 Metro terminal 输出。

## 测试用例 A：普通 Agent 回复后台续跑

步骤：

1. 打开 Koko 普通聊天。
2. 发送一个会回复较久的问题，例如：
   - `写一个 1500 字的中文短篇故事，分 6 段，每段都具体一点。`
3. 看到回复开始 streaming 或输入框进入 `正在回复` 后，立刻按 Simulator 的 `Cmd+Shift+H` 切到后台。
4. 等 60-120 秒。
5. 回到 KokoChat。

期望：

- APP 没有永久停在 `handshaking`。
- 回复最终能继续显示或已经完成。
- 输入框解锁。
- 不出现 `websocket closed: 1001` 作为最终失败状态。

需要记录：

- 后台停留时长。
- 回前台时连接状态。
- 回复是否完整。
- 是否出现 error bubble。

## 测试用例 B：Tavern 角色卡加载后台续跑

步骤：

1. 从 Tavern 广场选一个没有本地缓存的角色卡。
2. 点击进入角色聊天页。
3. 看到 `正在拉角色卡 / 准备开场白` 后，立刻 `Cmd+Shift+H` 切后台。
4. 等 60-120 秒。
5. 回前台。

期望：

- 角色卡加载完成后进入可聊天状态。
- 如果拉取失败，页面显示明确错误和 `重试`。
- 不应永久显示 loading。
- 不应因为 first_mes 翻译失败而阻塞进入聊天。

需要记录：

- 角色名、角色 path。
- 是否走了 OpenClaw 拉取详情。
- first_mes 是中文翻译还是原文 fallback。
- 是否有 retry 按钮。

## 测试用例 C：Tavern 首轮角色聊天上下文

步骤：

1. 选择一个 Tavern 角色并等角色卡加载完成。
2. 发送第一句话，例如：
   - `你现在在哪里？刚刚发生了什么？`
3. 发送后立刻切后台 60-120 秒。
4. 回前台等回复结束。
5. 继续追问：
   - `你能复述一下你的角色设定和我们刚才的场景吗？`

期望：

- 第一轮回复不要变成通用助手口吻。
- 第二轮能知道角色卡和前文，不应说“我没有看到完整角色卡/最早设定”。
- 如果重连发生，应该通过本地历史 restore 保住上下文。

需要记录：

- 第一轮是否带角色口吻。
- 第二轮是否丢上下文。
- 日志里是否有 reconnect / session restore。

## 测试用例 D：Deeply `inferOnce` 后台续跑

步骤：

1. 打开 Deeply。
2. 选一本书或输入一个研究主题，触发课程目录 / brief 生成。
3. 出现 `正在准备` 后立刻切后台 60-120 秒。
4. 回前台。

期望：

- outline / brief 最终出现。
- 页面不应永久卡在 `正在准备`。
- 如果失败，应能重试或重新发起。

可选追加：

1. 进入一个课程章节。
2. 等章节回复完成后，观察 quick replies 是否出现。
3. quick replies loading 时切后台，再回前台。

期望：

- quick replies 要么生成成功，要么 watchdog 触发重试。
- 不应永久卡住。

## 测试用例 E：超过后台时间的失败恢复

步骤：

1. 触发一个明显长任务。
2. 切后台 4-5 分钟。
3. 回前台。

期望：

- 可以失败，但失败状态必须可理解。
- 输入框不能永久锁死。
- Tavern 角色卡加载失败时要能点 `重试`。
- 普通聊天失败时要能点重试或重新发送。

说明：iOS background task 是 best-effort，系统不给无限后台时间。这个用例不是要求长任务必成，而是验证失败恢复。

## 通过标准

可以认为第一轮模拟器测试通过，当满足：

1. `pnpm typecheck` 通过。
2. dev build 能成功安装启动。
3. `koko-background-task` autolinking resolve 正常。
4. 用例 A/B/C/D 至少各跑一次，未出现永久 loading / 永久 handshaking / 输入框永久锁死。
5. 用例 C 中 Tavern 没有明显丢角色卡上下文。
6. 用例 E 即使失败，也能恢复到可继续操作状态。

## 输出报告格式

请在测试窗口最后给出：

````md
## 环境
- macOS:
- Xcode:
- Simulator:
- iOS:
- OpenClaw version:
- KokoChat commit:

## 构建结果
- pnpm typecheck:
- expo run:ios:
- autolinking:

## 用例结果
- A 普通 Agent 后台续跑:
- B Tavern 角色卡加载:
- C Tavern 上下文:
- D Deeply inferOnce:
- E 超时恢复:

## 发现的问题
1. ...

## 日志摘录
```text
关键错误 / reconnect / websocket closed / background task 相关日志
```
````

## 注意事项

- 模拟器后台行为不能完全代表真机。模拟器通过后，仍需要 TestFlight 真机复测。
- 这次不要把临时生成的 `apps/koko-chat/ios/` 提交。
- 如果发现 native module 没生效，优先查 dev build 是否真的是重新打出来的，而不是 Expo Go 或旧包。
