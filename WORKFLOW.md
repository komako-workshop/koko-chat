# KokoChat — 开发协作 workflow

> 本文档定义"哪种任务交给哪种 AI 模型"以及"怎么调"。
> 新窗口接手时先读完 `IDEA.md`，再读这份，再开始写代码。

---

## 1. 分工原则

KokoChat 的开发同时借助两种 AI：

| 领域 | 主责 | 原因 |
|---|---|---|
| `koko-relay` 后端（WebSocket 路由、房间管理、E2E 转发、APNs/FCM 网关） | **codex / gpt-5.5** | 协议、并发、状态机、边界条件这类精细后端逻辑 codex 更稳 |
| `koko-cli` Mac 守护进程（OpenClaw spawn/调用、session file lock、cancel 语义、重连退避） | **codex / gpt-5.5** | 同上；且旧仓库踩过的 session lock / 并发坑很适合给 codex 重写 |
| 协议层移植（OpenClaw Gateway Protocol v3、TweetNaCl E2E 加密这种纯逻辑） | **codex 起草 + Claude review** | 纯算法 / 协议，codex 准确，Claude 负责对齐 KokoChat 项目上下文 |
| `koko-chat` RN APP：UI / 业务逻辑 / mini-app 容器 / store 设计 | **Claude** | RN 生态 + 产品直觉 + 旧仓库踩过的 UI 坑，Claude 上下文更适配 |
| 架构决定、产品取舍、命名、mini-app 形态 | **Komako + Claude 讨论** | 产品层决定不应外包给任何模型 |

**不要**让 codex 写 React Native：它不知道旧仓库踩过的 state 耦合 / canonical sync / autoscroll / FlatList key / AppState 这些具体坑。

**不要**让 Claude 独立写复杂后端并发逻辑：逻辑密度高的后端（WebSocket 状态机、文件锁、多路 cancel）交给 codex 更稳。

---

## 2. 怎么调 codex

codex CLI 已装在机器上（`/Users/lijianren/.npm-global/bin/codex`，版本 0.125.0）。
开发时由 Claude（在 OpenCode 里）直接 bash 调用 `codex exec` 非交互模式。

### 基本命令模板

```bash
codex exec --cd /Users/lijianren/Desktop/workspace/koko-chat \
  --full-auto \
  "$(cat <<'EOF'
<任务书内容>
EOF
)"
```

关键参数：

- `exec`：非交互模式，适合被 Claude 自动调用
- `--cd <dir>`：工作目录，默认是 KokoChat 仓库
- `--full-auto`：自动沙箱执行（安全的默认）
- `-m, --model <MODEL>`：指定模型，如果需要
- `-s <SANDBOX_MODE>`：`read-only` / `workspace-write` / `danger-full-access`，默认 full-auto 用 workspace-write

### 流程

1. **Komako 发起任务** —— "写一下 koko-relay 的 pairing 模块"
2. **Claude 写任务书** —— 一段结构化 prompt，包含：目标 / 输入契约 / 输出契约 / 验收标准 / 禁止事项 / 相关文件路径
3. **Claude 调 codex** —— `codex exec` 执行任务书
4. **codex 产出代码 + commit**（或仅写文件）
5. **Claude review** —— 读代码、跑 test、lint，写 review 意见
6. **必要时回到 step 3**，把 review 意见追加进任务书再来一轮

### 任务书必须包含的字段

```text
## 目标
一句话说明这次要做什么。

## 输入契约
- 依赖的已有代码路径（相对仓库根）
- 依赖的外部协议 / 接口（附 URL 或已有类型定义路径）
- 环境假设（Node 版本、外部进程是否在跑等）

## 输出契约
- 要创建 / 修改的文件路径清单
- 每个文件的 export / API 签名（如已定）
- 不允许修改的文件清单

## 验收标准
- 必须跑通的命令（`pnpm test xxx` / `node dist/xxx.js ...`）
- 期望的输出 / 副作用
- 性能 / 并发 / 错误处理的具体要求

## 禁止事项
- 不要引入哪些依赖
- 不要修改哪些模块
- 不要凭空假设（URL、版本号、路径）

## 背景上下文
- 相关 IDEA.md 段落
- 旧仓库已踩过的坑（如适用）
```

### 任务书存哪里

任务书存 `tasks/` 目录，文件名 `NN-<slug>.md`，例如：

- `tasks/01-relay-pairing.md`
- `tasks/02-cli-session-bridge.md`

codex 产出代码后，在任务书末尾追加 `## Outcome` 段，记录实际改动 / 遗留问题 / review 结论。

---

## 3. Claude（在 OpenCode 里）自己做的事

- 写任务书
- 调 codex 执行任务书
- review codex 产出：读代码、跑 test、跑 lint、对齐 IDEA.md 约束
- RN APP 本身的实现
- 架构讨论、产品决定的梳理
- 所有文档（README / IDEA / WORKFLOW / tasks）的撰写和维护

---

## 4. 不做的事

- 不要把产品 / 架构决定外包给任一模型。决定由 Komako 做。
- 不要让两个模型同时写同一个模块。冲突解决成本高于收益。
- 不要跳过 review 直接合并 codex 产出。即使 codex 更擅长后端，KokoChat 的项目上下文（OpenClaw 细节、旧仓库坑）仍需要 Claude 对齐。
