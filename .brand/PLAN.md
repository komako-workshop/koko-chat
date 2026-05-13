# KokoChat Logo / Mascot 批量生图方案

> 模型：`google/gemini-3.1-flash-image-preview` (Nano Banana 2)
> 单价：~$0.067/张 (1024x1024, 1:1)
> 计划：~200 张

## 生成矩阵

每张图 = `[姿态/构图]` × `[气质]` × `[配色]` × `[风格]` 的一个组合。

### 维度 1：姿态/构图（8 种）

1. `head-side` — 鹦鹉头部侧面剪影，弯喙清晰
2. `head-front` — 鹦鹉头部正面，大眼睛对称
3. `full-side` — 整只鹦鹉侧面站立
4. `full-3q` — 整只鹦鹉 3/4 角度
5. `head-tilted` — 歪头思考（聪明气质）
6. `holding-note` — 嘴里叼便签/信纸（chat/notebook 隐喻）
7. `on-book` — 蹲在一本书上（学习/notebook 隐喻）
8. `silhouette-only` — 极简单色剪影（最抽象 logo 形态）

### 维度 2：气质（3 种）

- `smart` — 聪明可靠：克制、几何、留白多
- `friendly` — 亲切可爱：圆润、表情足
- `playful` — 俏皮社区感：有动作感、轻微 meme 气

### 维度 3：配色（6 种）

- `mono-black` — 黑白极简（Linear/Notion 风）
- `coral` — 珊瑚橘/粉橘单色 + 米白底
- `mint` — 薄荷绿单色 + 奶油底
- `sunset` — 黄+红渐变（鹦鹉经典彩羽）
- `dual-teal-coral` — 蓝绿主体 + 珊瑚点缀
- `rainbow-soft` — 柔和彩虹，致敬 Party Parrot 但低饱和

### 维度 4：风格（3 种）

- `flat` — 扁平矢量、纯色块、无渐变、无描边
- `line` — 单线 line art、最少元素
- `chibi` — Q 版插画感、保留少量描边和高光

## 输出

- 文件名：`{idx:03d}_{pose}_{mood}_{palette}_{style}.png`
- 路径：`.brand/out/`
- 索引页：`.brand/index.html`（缩略图墙 + 标签 + 一键放大）

## 不生成什么

- 不出现真实 Party Parrot 的彩虹摇头帧
- 不出现具象的"派对帽"/"派对场景"
- 不出现写实羽毛/写实鸟类摄影风
- 不带具体单词 / 文字（logo 和 wordmark 分开做）
