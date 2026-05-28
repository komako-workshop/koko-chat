# Deeply Mini-App

> AI 课程化深度学习,跑在用户自己的 OpenClaw agent 上。
> 整套交互对齐 [deeply.plus](https://deeply.plus) 原版,但底层是 KokoChat mini-app runtime。

## 入口

`launcher → Deeply → /deeply`(route 形式 launch,不复用 host 共享聊天页)。

## 三个核心 surface

```text
/deeply                          知识探索 chat(DeeplyExploreScreen)
  ↓ 左下「推荐课程」按钮
  ↓ 或用户文字"再推荐几个 / 列个课题清单"
  ↓ outbound builder 注入推荐 prompt,agent 输出 fenced block
  ↓
推荐课程卡(`koko.deeply.recommendations` block)
  ↓ 点任意一张
  ↓
CourseDetailSheet                 commit gate 弹窗
  inferOnce 调一次,出详细介绍;
  用户可挑「自动 / 轻量 / 深度 / 自定义」长度 preset;
  点「开始讲解」→ 创建 deeply-course conversation
  ↓
/deeply/course/[id]               课程讲解(DeeplyCourseScreen)
  bootstrap 时后台生成 markdown 大纲(`## 第N节:标题`);
  按目录推进 → 顶部进度,底部「N 节 · 标题」chip;
  讲完后再 inferOnce 出 2-3 个好奇点 chip;
  右上目录抽屉支持点任意节跳转。
```

## 文件地图

| 文件 | 作用 |
|---|---|
| `index.ts` | mini-app 注册,挂 mode 默认 agent / outbound builder / block renderer / agent response transformer |
| `persona.ts` | 知识探索 + 课程讲解的 system persona,以及多个 prompt builder |
| `DeeplyExploreScreen.tsx` | `/deeply` 自家 chat surface(博学朋友风 + 推荐课程按钮) |
| `DeeplyCourseScreen.tsx` | `/deeply/course/[id]` 课程讲解 surface(进度 + chip + 抽屉接入点) |
| `CourseDetailSheet.tsx` | 推荐卡点击后的 commit-gate 弹窗(brief inferOnce + 长度 preset) |
| `CourseOutlineDrawer.tsx` | 右侧目录抽屉(读 / 未读 / 当前 三态 badge,点行跳节) |
| `RecommendationCard.tsx` | 单张推荐课程卡(white + ❝reason + shadow,deeply 原版视觉) |
| `courseSession.ts` | `startDeeplyCourseSession` 创建 conversation + 后台跑 outline + 持久化 record |
| `courseProgress.ts` | 进度 store(单调 currentSection + 可回退 activeSection + readSections) |
| `courseSheetStore.ts` | CourseDetailSheet 的开 / 关全局 store(避免每张卡自己挂 Modal,跳出 demo frame) |
| `courseOutlineDrawerStore.ts` | OutlineDrawer 的开 / 关全局 store |
| `inferCourseBrief.ts` | brief 推理封装 |
| `inferCourseOutline.ts` | 课程大纲推理封装(150s 超时) |
| `inferCourseQuickReplies.ts` | 好奇点 chip 推理封装 |
| `parseRecommendations.ts` | `koko.deeply.recommendations` fenced block 解析 |
| `parseCourseBrief.ts` | `koko.deeply.course-brief` fenced block 解析 |
| `parseCourseOutline.ts` | markdown → `{ index, title }[]` |
| `parseCourseSectionHeader.ts` | agent 主线讲解首行 `## 第N节:标题` 解析(进度推进依据) |
| `parseCourseQuickReplies.ts` | 好奇点纯文本逐行解析(对齐 deeply 原版口径) |
| `avatars.ts` | 三张 deeply 头像(main / chat-buddy / learning) |

## OpenClaw 一侧

Deeply 跟探索 / 课程讲解都共用一个 `deeply` OpenClaw agent(`install-openclaw-support.mjs` 已自动创建)。没有自己的 skill,纯 prompt 驱动。

不同 conversation 用不同 sessionKey scope 隔离:

```text
agent:deeply:kokochat:deeply:<exploreScope>       # 探索
agent:deeply:kokochat:deeply-course:<courseScope>  # 每门课一条
```

## 端到端 demo 跑法

```bash
# 1. 一次性:OpenClaw 那侧装 KokoChat 支持(包含 deeply agent)
pnpm openclaw:install

# 2. 仅 Deeply web demo(电脑浏览器,手机框比例,自动配对本地 Gateway)
pnpm deeply:web
# → 浏览器开 http://localhost:8081

# 3. 全 KokoChat(包含 koko / tavern / deeply)在 iOS Expo Go 上跑
pnpm app:dev
```

## 已知 v1 局限

- 主线讲解每次都把完整 outline 注入到 prompt,长课 token 累积,后续考虑只在第 1 节注入完整 + 后续依赖 OpenClaw 自然 history
- chips / brief 失败时静默不显示(不会重试)
- 目录跳转后已学集合直接加 N,实际 agent 是否真的讲了那一节没二次校验
- 进度持久化只在本地 MMKV,不跨设备同步
