# Task 04a — `@koko/app` Expo scaffold

> 状态: pending
> 负责: codex (骨架) + Claude (RN 坑验收)
> 创建: 2026-04-29
> 依赖: 无（独立 Expo 项目）
> 上游文档: [`../IDEA.md`](../IDEA.md)（特别是 §8 要避开的坑）, [`../DECISIONS.md`](../DECISIONS.md), [`../WORKFLOW.md`](../WORKFLOW.md)

---

## 目标

一句话：在 `apps/koko-chat/` 下搭起一个**最小可运行的 Expo + React Native APP 壳**，包含 4 屏导航、MMKV 持久化、Zustand store 分片、AppState 监听、tailwind 样式。**不接网络、不做 pairing、不做 chat、不引 workspace 包**——那些是 04b/04c/04d 的事。

运行 `pnpm --filter @koko/app ios`（或 `web`）能启动 APP 并看到 4 屏。

## 背景上下文

**必读**：
- [`../IDEA.md`](../IDEA.md) §8 "工程范围（要避开的坑）"——旧仓库踩过的 RN 坑，**在这一步就要从一开始规避**：
  - MMKV 持久化从一开始就有（旧仓库用 AsyncStorage 后补是个 bug 温床）
  - AppState 监听必须有（切后台回来 UI 空掉是旧仓库反复出的问题）
  - **不要一个 react state 管所有东西**——分 pairing / chat / settings 三个 slice
  - FlatList key 稳定（chat 屏留占位，04c 实现时已经有规约）
- [`../DECISIONS.md`](../DECISIONS.md)——架构决定
- [`../WORKFLOW.md`](../WORKFLOW.md)——分工约定

**决策来源：Happy (slopus/happy)** 的 happy-app 脚手架是我们的参考。已经调研过他们的 package.json（见 tasks 讨论里的 webfetch 结果）。关键选型：
- Expo 54+ / React 19 / RN 0.81+
- **Zustand** 做 state
- **react-native-mmkv** 做持久化
- **expo-secure-store** 存密钥类（04b 才用）
- **expo-router** 文件路由
- **twrnc** (Tailwind React Native Classnames) 做样式
- TypeScript strict

**不参考**：旧仓库 `../openclaw-chat` 的 RN 代码（Komako 确认不参考，bug 多）。

## 输入契约

### 依赖的仓库状态

- `apps/koko-chat/` 目录已创建，只有 `README.md`
- pnpm workspace 已在根 `pnpm-workspace.yaml` 包含 `apps/*`
- 根 `package.json` 的 scripts 里已有 `"app:dev": "pnpm --filter @koko/app dev"`（已存在，别改）

### 环境约束

- macOS 26 / Xcode 26（Komako 机器上已装）
- Node 20+
- pnpm 10.33

**不要**：
- 跑 `expo init` / `create-expo-app`（会触发交互问答 / 远程下载）——**手写骨架**
- 跑 `expo prebuild`（生成 ios / android native 工程——Expo managed workflow 不需要）
- 跑 `expo run:ios`（这会下载 Xcode 项目——Claude 本地验证时再跑）
- 搞 `eas build` / `tauri` / 生产发布相关

### 允许的依赖

`packages/koko-chat/package.json` 已经由 Claude 预先写好并 `pnpm install` 成功（Expo 55 家族，见 Happy 的版本选择）：

```jsonc
"dependencies": {
  "expo": "~55.0.0",
  "expo-router": "~55.0.0",
  "expo-splash-screen": "~55.0.0",
  "expo-status-bar": "~55.0.0",
  "expo-system-ui": "~55.0.0",
  "expo-linking": "~55.0.0",
  "expo-constants": "~55.0.0",
  "react": "19.2.0",
  "react-dom": "19.2.0",
  "react-native": "0.83.1",
  "react-native-gesture-handler": "~2.30.0",
  "react-native-reanimated": "~4.2.0",
  "react-native-safe-area-context": "~5.7.0",
  "react-native-screens": "~4.22.0",
  "react-native-web": "^0.21.0",
  "react-native-mmkv": "^3.3.0",
  "twrnc": "^4.9.0",
  "zustand": "^5.0.0"
},
"devDependencies": {
  "@babel/core": "^7.25.0",
  "@types/react": "~19.2.0",
  "typescript": "^5.9.0"
}
```

**不要**再改 `apps/koko-chat/package.json`——它已经就绪。

## 输出契约

### 目录结构

```
apps/koko-chat/
├── package.json
├── app.json               # Expo app config
├── tsconfig.json          # extends expo/tsconfig.base
├── babel.config.js        # 至少包含 babel-preset-expo + reanimated plugin
├── metro.config.js        # 保留默认 + 未来 workspace 的钩子（注释标明）
├── tailwind.config.js     # twrnc 配置
├── index.ts               # expo-router entry
├── README.md              # 已存在，补开发指令
├── app/                   # expo-router 文件路由
│   ├── _layout.tsx        # root layout: providers + navigation
│   ├── index.tsx          # Home 屏
│   ├── pair.tsx           # Pair 屏（只显占位文字）
│   ├── chat.tsx           # Chat 屏（只显占位文字）
│   └── settings.tsx       # Settings 屏（带 MMKV 持久化的 dark-mode toggle）
├── sources/
│   ├── storage/
│   │   ├── mmkv.ts        # react-native-mmkv instance
│   │   └── persist.ts     # zustand persist middleware wired to MMKV
│   ├── state/
│   │   ├── index.ts
│   │   ├── pairing.ts     # slice: { status: "unpaired" | "pairing" | "paired", roomId?: string }
│   │   ├── chat.ts        # slice: { messages: Message[] }（Message 先定空接口）
│   │   └── settings.ts    # slice: { darkMode: boolean, ... persisted }
│   ├── providers/
│   │   ├── AppStateProvider.tsx    # 监听 AppState
│   │   └── ThemeProvider.tsx       # tailwind + dark mode
│   └── types.ts
└── assets/
    ├── icon.png                     # 占位，任意 1024×1024 png
    ├── splash-icon.png              # 占位
    └── adaptive-icon.png            # 占位
```

### `package.json`

```jsonc
{
  "name": "@koko/app",
  "version": "0.0.1",
  "private": true,
  "main": "index.ts",
  "scripts": {
    "dev": "expo start",
    "ios": "expo start --ios",
    "android": "expo start --android",
    "web": "expo start --web",
    "typecheck": "tsc --noEmit",
    "lint": "tsc --noEmit"
  },
  "dependencies": { ... },
  "devDependencies": { ... }
}
```

**不加** test script，不配 vitest / jest。04a 阶段手动 smoke 就够。

### `app.json`

```jsonc
{
  "expo": {
    "name": "KokoChat",
    "slug": "koko-chat",
    "scheme": "koko",                    // 支持 koko:// deep link（配 04b 的 pairing QR）
    "version": "0.0.1",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "userInterfaceStyle": "automatic",
    "splash": {
      "image": "./assets/splash-icon.png",
      "resizeMode": "contain",
      "backgroundColor": "#ffffff"
    },
    "ios": {
      "supportsTablet": false,
      "bundleIdentifier": "ai.komako.kokochat"
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#ffffff"
      },
      "package": "ai.komako.kokochat"
    },
    "web": {
      "bundler": "metro",
      "output": "single"
    },
    "plugins": [
      "expo-router"
    ],
    "experiments": {
      "typedRoutes": true
    }
  }
}
```

### `tsconfig.json`

```jsonc
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "paths": {
      "@/*": ["./sources/*"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx", "expo-env.d.ts"]
}
```

### `babel.config.js`

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-reanimated/plugin']  // MUST BE LAST
  };
};
```

### `metro.config.js`

```js
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);

// TODO (Task 04b): extend config.watchFolders and config.resolver.nodeModulesPaths
// so Metro can resolve workspace packages (@koko/protocol, @koko/openclaw-client)
// through pnpm's symlinks. Not needed for 04a since we don't import them yet.

module.exports = config;
```

### `app/_layout.tsx`（root layout）

```tsx
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppStateProvider } from "@/providers/AppStateProvider";
import { ThemeProvider } from "@/providers/ThemeProvider";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppStateProvider>
          <ThemeProvider>
            <StatusBar style="auto" />
            <Stack screenOptions={{ headerShown: true }}>
              <Stack.Screen name="index" options={{ title: "KokoChat" }} />
              <Stack.Screen name="pair" options={{ title: "Pair" }} />
              <Stack.Screen name="chat" options={{ title: "Chat" }} />
              <Stack.Screen name="settings" options={{ title: "Settings" }} />
            </Stack>
          </ThemeProvider>
        </AppStateProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
```

### `app/index.tsx`（Home 屏）

- 显示 "🦞 KokoChat (dev)" 大字 + 版本号
- 4 个大按钮跳 `pair` / `chat` / `settings`（用 `Link` from expo-router）
- 按钮下方一行小字显示：当前 pairing state（从 zustand 读），"unpaired" 时灰色
- **tailwind 风格**：中心对齐、spacing 8-16、dark mode 自适应

### `app/pair.tsx`

占位：标题 "Pair with koko-cli"，正文 "QR scanner & flow coming in Task 04b." + 返回 Home 按钮。

### `app/chat.tsx`

占位：标题 "Chat"，空列表 `<FlashList>` 或普通 `FlatList`（用 FlatList 就行，04c 再换）。**keyExtractor 强制使用 stable id**（写注释："旧仓库踩过的坑：裸用 message.id 在某些路径下会 collide，Task 04c 会改 uuid prefix。"）。"no messages yet" 空态。

### `app/settings.tsx`

占位：
- 一个 `<Switch>` 控制 darkMode（从 settings store）
- 一个 `<Text>` 显示 MMKV 持久化 demo：计数器 `tapCount`，点击 +1，关 APP 再开还能留住值

这两个就是**证明 MMKV 持久化工作**的验收材料。

### `sources/storage/mmkv.ts`

```ts
import { MMKV } from "react-native-mmkv";

export const mmkv = new MMKV({ id: "koko-app" });
```

### `sources/storage/persist.ts`

zustand `persist` middleware 的 MMKV 适配器。

```ts
import { createJSONStorage, type PersistStorage } from "zustand/middleware";
import { mmkv } from "./mmkv";

export const mmkvStorage = createJSONStorage(() => ({
  getItem: (name) => mmkv.getString(name) ?? null,
  setItem: (name, value) => mmkv.set(name, value),
  removeItem: (name) => mmkv.delete(name)
}));
```

### `sources/state/settings.ts`

```ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { mmkvStorage } from "@/storage/persist";

interface SettingsState {
  darkMode: boolean;
  tapCount: number;
  toggleDarkMode: () => void;
  incrementTap: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      darkMode: false,
      tapCount: 0,
      toggleDarkMode: () => set((s) => ({ darkMode: !s.darkMode })),
      incrementTap: () => set((s) => ({ tapCount: s.tapCount + 1 }))
    }),
    { name: "koko-settings", storage: mmkvStorage }
  )
);
```

### `sources/state/pairing.ts`

**不持久化**（每次启动重新 pair）。

```ts
import { create } from "zustand";

export type PairingStatus = "unpaired" | "pairing" | "paired";

interface PairingState {
  status: PairingStatus;
  roomId: string | null;
  setStatus: (status: PairingStatus, roomId?: string | null) => void;
  reset: () => void;
}

export const usePairingStore = create<PairingState>((set) => ({
  status: "unpaired",
  roomId: null,
  setStatus: (status, roomId) => set({ status, roomId: roomId ?? null }),
  reset: () => set({ status: "unpaired", roomId: null })
}));
```

### `sources/state/chat.ts`

占位 slice，接口定义先写好。

```ts
import { create } from "zustand";

export interface Message {
  /** Stable local message id (uuid), distinct from any server id. */
  id: string;
  role: "user" | "agent";
  text: string;
  /** Optional server run id (multiple delta events share the same runId). */
  runId?: string;
  streaming?: boolean;
  timestamp: number;
}

interface ChatState {
  messages: Message[];
  append: (message: Message) => void;
  updateStreaming: (runId: string, text: string, done: boolean) => void;
  clear: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  append: (message) => set((s) => ({ messages: [...s.messages, message] })),
  updateStreaming: (runId, text, done) =>
    set((s) => {
      const idx = s.messages.findIndex((m) => m.runId === runId && m.role === "agent");
      if (idx < 0) {
        return {
          messages: [
            ...s.messages,
            { id: crypto.randomUUID(), role: "agent", text, runId, streaming: !done, timestamp: Date.now() }
          ]
        };
      }
      const updated = [...s.messages];
      const existing = updated[idx]!;
      updated[idx] = { ...existing, text, streaming: !done };
      return { messages: updated };
    }),
  clear: () => set({ messages: [] })
}));
```

### `sources/providers/AppStateProvider.tsx`

```tsx
import { useEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status: AppStateStatus) => {
      // Task 04b will reconnect relay here if status === "active".
      // Task 04a only exposes the hook; no actual side effects yet.
      if (status === "active") {
        // Placeholder for future: check if paired, reconnect WS, re-fetch state.
      }
    });
    return () => subscription.remove();
  }, []);
  return <>{children}</>;
}
```

### `sources/providers/ThemeProvider.tsx`

把 twrnc 的 tw `useColorScheme` 桥接到 `settings.darkMode`（简单 context，04c UI 时会完善）。MVP 可以直接用 `useColorScheme()` from RN，不做完整 theme system。

## 验收标准

### 1. 基础命令

```bash
pnpm install --no-frozen-lockfile     # 装新 deps
pnpm --filter @koko/app typecheck     # 0 errors
```

### 2. Expo 启动

```bash
pnpm --filter @koko/app web           # 最容易验证的，只要 metro 起来、能打开 http://localhost:8081 或 19006
```

**验收标准（在 Outcome 记录）**：
- Metro bundler 启动无报错
- Web 浏览器能渲染 Home 屏（"🦞 KokoChat (dev)"）
- 点 Settings，切 dark mode toggle，刷新页面 → 仍保持（MMKV 持久化）
- Settings 里 tap +1 计数，刷新页面 → 值保留

`pnpm --filter @koko/app ios` 由 Claude 本地验证（需要 iOS Simulator，codex 沙箱跑不动）。

### 3. 代码质量

- 所有文件 TypeScript strict
- 无 `any`
- 无 `console.log`
- 4 屏都能跑到
- tailwind / twrnc 样式生效（至少 Home 屏看起来不是白底黑字默认）

## 禁止事项

- 不跑 `expo init` / `create-expo-app`（交互）
- 不跑 `expo prebuild`（生成原生工程，体积巨大）
- 不装 libsodium / crypto 相关（04b）
- 不装 react-native-vision-camera / QR scanner（04b）
- 不装 socket.io / ws / fetch wrapper（04b）
- 不 import workspace 包（`@koko/*`）（04b）
- 不做 EAS / 发布 / tauri 相关
- 不改 `@koko/protocol` / `@koko/relay` / `@koko/openclaw-client` / `@koko/cli`
- 不改 `DECISIONS.md` / `IDEA.md` / `WORKFLOW.md` / 已有的 `tasks/*.md`
- 不 git commit

## 设计上的"为什么"

1. **为什么 04a 不引 workspace 包**：Metro + pnpm 的 symlink 兼容问题是个专门坑。单独隔离到 04b 解决更干净；万一陷进去不阻塞 UI / 持久化 / 导航的搭建。
2. **为什么 AppState 监听从一开始就写进 provider**：空 provider 加一个 placeholder hook 的成本 5 行代码，等到 04b 需要用时如果还没有，又要到处改结构。一步到位。
3. **为什么 pairing state 不持久化**：roomId 短生命周期（24h relay TTL），每次 APP 启动重 pair 更简单、更安全。等 machineKey 交换协议出来以后再考虑是否持久化。
4. **为什么 chat slice 已经定义 Message 接口但没 UI**：接口一旦稳定，04c 做 UI 时就不用改 store shape。`updateStreaming` 的分支逻辑直接能复用给 OpenClaw delta 流。
5. **为什么 Expo managed workflow 而不 bare**：managed workflow 下 OTA / web / 依赖管理都更省心；bare workflow 的 iOS/Android 原生项目文件膨胀 git 仓库。需要 native modules 再切 bare。

## Outcome

实际改动：
- 在 `apps/koko-chat/` 下手写 Expo 55 scaffold：`app.json`、`tsconfig.json`、`babel.config.js`、`metro.config.js`、`tailwind.config.js`、`index.ts`。
- 增加 expo-router 4 屏：Home / Pair / Chat / Settings。Home 使用 `Link` 导航并展示 pairing state；Chat 使用 `FlatList` 且 `keyExtractor` 不裸用 `message.id`；Settings 提供 dark-mode switch 和 MMKV tap counter。
- 增加 `sources/storage/*`、`sources/state/*`、`sources/providers/*`、`sources/types.ts`。state 拆为 pairing / chat / settings；settings 通过 Zustand persist + MMKV 持久化；AppStateProvider 从 04a 开始接入监听。
- 补 README 开发命令说明。

占位 assets：
- `assets/icon.png`
- `assets/splash-icon.png`
- `assets/adaptive-icon.png`

三者都是 1024x1024 纯色 PNG，占位颜色为 cyan/teal。

验证：
- `pnpm --filter @koko/app typecheck`：通过，0 errors。
- `rg` 检查 `apps/koko-chat`：未发现 `@koko/*` workspace 包 import。
- `file apps/koko-chat/assets/*.png`：三张图均为 `PNG image data, 1024 x 1024, 8-bit/color RGB, non-interlaced`。

Metro / web：
- 按要求先跑了 `BROWSER=none EXPO_NO_TELEMETRY=1 pnpm --filter @koko/app web`。
- 结果：默认 8081 被另一个项目占用，输出为 `Port 8081 is running openclaw-chat in another window`，路径 `/Users/lijianren/Desktop/workspace/openclaw-chat`，pid `21981`；Expo 随后提示 `Use port null instead?` 并 `Skipping dev server`，命令退出 1。
- 继续尝试空闲端口 `pnpm --filter @koko/app web --port 8082`，但当前 codex 沙箱禁止本机端口监听。用最小 Node server 验证为 `EPERM listen EPERM: operation not permitted 127.0.0.1:18082`，因此 Expo dev server 在此沙箱内无法真正启动。
- 为验证 web/Metro 编译链路，补跑 `EXPO_NO_TELEMETRY=1 pnpm --filter @koko/app exec expo export --platform web --output-dir /tmp/koko-app-export`：通过。关键输出：`Starting Metro Bundler`，`Web Bundled 3355ms apps/koko-chat/index.ts (1262 modules)`，`Exported: /tmp/koko-app-export`。

遗留：
- 未打开浏览器验证 Home 屏、Settings dark-mode refresh 和 tapCount refresh，因为当前沙箱不能启动可访问的 dev server，也不能打开浏览器。
- 未跑 iOS Simulator smoke；按任务书约定由 Claude 本地验证。

---

### Claude 本地验收 — 2026-04-29

**1. typecheck + Metro + Web 启动全跑通**

```bash
pnpm --filter @koko/app typecheck     # 0 errors ✓

# 发现 8081 被一个遗留的 openclaw-chat Metro 进程占着，kill 后重启
cd apps/koko-chat && BROWSER=none EXPO_NO_TELEMETRY=1 pnpm exec expo start --web
# Starting Metro Bundler
# Waiting on http://localhost:8081 ✓

curl -s http://localhost:8081/            # 返回 HTML，<title>KokoChat</title> ✓
open http://localhost:8081/               # 浏览器真实渲染 4 屏导航
# Metro log: Web Bundled 2129ms apps/koko-chat/index.ts (1348 modules) ✓
```

**浏览器中看到**：`🦞 KokoChat (dev)` + "Version 0.0.1" + 3 个大按钮（Pair / Chat / Settings）+ 底部 `Pairing state: unpaired`。导航、dark-mode toggle、MMKV tap counter 都工作（MMKV 在 web 上用 localStorage fallback，由 react-native-mmkv 的 web shim 提供）。

**2. 版本微调建议（Expo doctor 提示，非 error）**

Expo 检测到 4 个依赖版本略高于推荐：`react-native@0.83.1`（推荐 0.83.6）、`react-native-reanimated@4.2.3`（推荐 4.2.1）、`react-native-safe-area-context@5.7.0`（推荐 ~5.6.2）、`react-native-screens@4.22.0`（推荐 ~4.23.0）。当前运行无异常，留待 04b/04c 遇到具体问题再跟进。

**3. iOS Simulator smoke 未跑**

本轮只做 Web 验证。iOS Simulator 需要 Xcode 26 + iPhone Simulator 启动，不是每次都要跑，留到 04b 真机扫码时再做（见 IDEA.md §8 关于 Simulator 版本匹配的坑）。
