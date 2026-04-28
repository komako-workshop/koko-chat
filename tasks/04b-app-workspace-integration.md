# Task 04b — `@koko/app` 集成 workspace 包 + RN 上的 @koko/protocol

> 状态: **partial** — 本任务拆成 04b-1 (workspace 集成 + hello world) 和 04b-2 (QR 扫描 + pairing UI)
> 04b-1 Claude 夜班尝试中；04b-2 需要产品决定才开工
> 上游文档: [`./04a-app-scaffold.md`](./04a-app-scaffold.md)（已完成）, [`../IDEA.md`](../IDEA.md) §8 RN 坑清单

---

## 目标

一句话：让 `apps/koko-chat` 能 `import { something } from "@koko/protocol"`，并且 Metro bundler 正确 resolve + 热重载。这是所有后续 RN 集成（pairing、envelope、chat）的前置。

**04b-1（本任务书今晚范围）**：Metro + pnpm 集成 + `@koko/protocol` 能在 RN Web 里被加载 + 一屏 "Hello from protocol" 证明链路。

**04b-2（另起任务书）**：QR 扫描 + 完整 pairing flow UI + 进入 Chat 屏。需要产品决定：QR 库用哪个、pairing UI 怎么设计、错误态如何展示等。

## 问题域（为什么复杂）

### pnpm 的 symlink 存储

pnpm 不复制依赖，用 symlink。`apps/koko-chat/node_modules/@koko/protocol` 是个 symlink，指向 `packages/koko-protocol/`；其传递依赖（如 `libsodium-wrappers`）存在 `node_modules/.pnpm/.../` 里。

### Metro 的默认假设

Metro 假设单 repo 独立 app：只 watch `projectRoot`，只从 `projectRoot/node_modules` resolve。

### 具体表现

```
Unable to resolve module `libsodium-wrappers` from
`.../packages/koko-protocol/dist/index.js`:
libsodium-wrappers could not be found within the project or in these directories:
  apps/koko-chat/node_modules
```

或热重载失效：改 `packages/koko-protocol/src/` 保存，APP 没反应。

## 三种已知解法

### 方案 A：`metro.config.js` 里 watchFolders + nodeModulesPaths

```js
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules")
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
```

**优点**：官方推荐、workspace 包源码改动实时反映、pnpm 严格依赖检查保留。
**缺点**：可能还需配 `resolver.resolveRequest` 或 `extraNodeModules` 处理某些边界包；iOS autolinking 遇 symlink 有时误判。

### 方案 B：`.npmrc` 强制 hoist

```
node-linker=hoisted
shamefully-hoist=true
```

**优点**：Metro 完全不用改，当成平铺 node_modules。
**缺点**：失去 pnpm 严格依赖检查；整个 workspace 膨胀；和 codex 之前选择的 pnpm workspace 模式部分抵消。

### 方案 C：apps/koko-chat **不用 workspace 依赖**，改 `file:` 路径

```jsonc
{
  "dependencies": {
    "@koko/protocol": "file:../../packages/koko-protocol"
  }
}
```

**优点**：没 symlink 就没 Metro 坑，方案最稳。
**缺点**：改 `@koko/protocol` 后要手动 `pnpm install` 才同步进 app；不能享受 workspace `workspace:*` 的 deduplication；如果 protocol 的依赖（比如 libsodium-wrappers）和 app 的依赖 version conflict，会在 app 的 node_modules 下装两份。

### Happy (slopus/happy) 怎么做

Happy 的 happy-app 是 pnpm monorepo，用方案 A（见其 `metro.config.js`），并加了 `patch-package` 打补丁处理某些依赖的边界行为。

## 今晚的试验顺序（Claude 夜班）

1. **先试方案 A**：改 `apps/koko-chat/metro.config.js`，加 workspace `"@koko/protocol": "workspace:*"` 依赖，写一屏 `import { PROTOCOL_VERSION } from "@koko/protocol"` 显示在 Home 屏。
2. 如果方案 A 跑通 Web bundle：commit、smoke、开心收工。
3. 如果方案 A 遇到**specific 错误**（例如 libsodium-wrappers 不 resolve）：
   - 尝试 extraNodeModules 补一层
   - 尝试 disableHierarchicalLookup=false
   - 如果 30 分钟内仍然挂 → revert metro.config 改动，转方案 C
4. 如果方案 C 也失败：commit WIP，在 SESSION_LOG.md 记录错误详情，停手。**不尝试方案 B**（hoist 改动面大，需要你醒来决定）。

## 输入契约

- Task 04a 已完成，`apps/koko-chat/` 独立 Expo 55 壳能跑通
- `@koko/protocol` 已 build，`dist/index.js` 存在
- 目标只是 `apps/koko-chat` 能 import、Metro 能 bundle，**不用跑 chat / pairing / UI 逻辑**
- 不改 `packages/koko-protocol/` 的任何代码
- 不改 `IDEA.md` / `DECISIONS.md` / `WORKFLOW.md`

## 04b-1 输出契约

### 必做

- 修改 `apps/koko-chat/package.json` 添加 workspace 依赖（方案 A 或 C 任一，取决于最后选哪个）
- 修改 `apps/koko-chat/metro.config.js` （方案 A 必须）
- 新增 `apps/koko-chat/app/_proto.tsx`（或改 Home）显示 "Protocol v{PROTOCOL_VERSION}" 文本
- 保证 typecheck + Metro web bundle 绿
- Claude 本地验证：打开浏览器看到 Home 屏多了 "Protocol v1"

### 不做（留给 04b-2 和 后续任务）

- 不做 QR 扫描
- 不做 pairing 网络调用
- 不做 chat 消息发送
- 不做 libsodium 在 RN 真实调用（import 能成功即可；真 runtime 调用可能还有坑，留给 04b-2 或 04c）
- 不做 iOS Simulator / Android 真机测试

## 04b-2 输入需要的产品决定（**Komako 醒来决定**）

| 决定项 | 候选 | Claude 观察 |
|---|---|---|
| QR 扫描库 | (a) expo-barcode-scanner (managed) (b) react-native-vision-camera (需 prebuild) | Happy 用 vision-camera。更快更可靠但脱离 managed workflow |
| pairing UI 布局 | (a) 全屏 Scanner + overlay (b) 摄像头小窗 + 手动输入 URL 后备 | Happy 是 (a) 加 "manual entry" 辅助 |
| 错误态 UI | 扫错 / 超时 / relay 不可达各自怎么展示 | 需产品决定文案 |
| device seed 存哪 | (a) react-native-mmkv (b) expo-secure-store | MMKV 性能好但不加密；SecureStore 加密但 API 限制 32KB。Happy 用 SecureStore 存 master secret |
| relay URL 用哪个 | (a) hardcode `http://localhost:8080` (开发) (b) env / config 屏支持自定义 (c) 默认 +  Settings 里可改 | (c) 最灵活 |

## 禁止事项（Claude 夜班自己遵守）

- 不选 QR 扫描库（留给 Komako）
- 不做 pairing UI（留给 Komako）
- 不碰 SecureStore（留给 04b-2）
- 不 push 到远程
- 不改 IDEA.md / DECISIONS.md / WORKFLOW.md
- 不改 `packages/koko-*/` 的代码
- 不跑 `expo prebuild`（会产生大 native 工程，commit 噪音大）
- 不跑 `expo run:ios`（iOS Simulator）
- 遇到无法 30 分钟内解决的 bug → commit WIP + 写 SESSION_LOG.md + 停手
- 每次 commit 前跑 `pnpm -r typecheck` 确保全绿

## Outcome

### 04b-1 — Claude 夜班 (2026-04-29 01:00-01:10)

**方案 A 一次试成**（watchFolders + nodeModulesPaths，不用 disableHierarchicalLookup）。

### 改动文件

- `apps/koko-chat/package.json` — 加 `"@koko/protocol": "workspace:*"` 到 dependencies
- `apps/koko-chat/metro.config.js` — 加 `config.watchFolders = [workspaceRoot]` + `config.resolver.nodeModulesPaths` 两个 path
- `apps/koko-chat/app/index.tsx` — 引 `PROTOCOL_VERSION` 显示在 Home 副标题："Version 0.0.1 · Protocol v1"

### 第一次试错

任务书里示例 metro.config 有 `config.resolver.disableHierarchicalLookup = true`。启用后 Metro 第一次 bundle 时报：

```
Unable to resolve module @expo/metro-runtime from
.../expo-router@55.0.13.../expo-router/entry-classic.js
```

根因：`@expo/metro-runtime` 是 `expo-router` 的 peer dep，pnpm 没把它 hoist 到 `apps/koko-chat/node_modules` 或 workspace root；它存在于 expo-router 自己的 `.pnpm/<hash>/node_modules` 里。禁用 hierarchical lookup 后 Metro 只看我们白名单给的 path，找不到。

**修复**：注释掉 `disableHierarchicalLookup` 那行，依赖 Metro 默认的"从当前文件向上找 node_modules"。这样 `.pnpm/<pkg>@<ver>/node_modules/` 的嵌套路径也能被找到。

### 验证命令

```bash
pnpm install --no-frozen-lockfile           # symlink 建好 ✓
pnpm --filter @koko/app typecheck           # 0 errors ✓
pnpm -r typecheck                           # 6 workspace 全绿 ✓

# Metro bundle
cd apps/koko-chat && EXPO_NO_TELEMETRY=1 pnpm exec expo export --platform web --output-dir /tmp/koko-app-04b-export
# -> Web Bundled 1437ms apps/koko-chat/index.ts (1281 modules) ✓
# -> _expo/static/js/web/index-XXX.js (2.3MB)

# Dev server
cd apps/koko-chat && BROWSER=none EXPO_NO_TELEMETRY=1 pnpm exec expo start --web
# -> Waiting on http://localhost:8081 ✓
# -> Web Bundled 1010ms apps/koko-chat/index.ts (1368 modules) ✓

# 浏览器打开 http://localhost:8081/ 看到 "Version 0.0.1 · Protocol v1" ✓
```

Bundle 里 grep 确认 `PROTOCOL_VERSION` 被链接并展示：

```
Version ", appVersion, " \xB7 Protocol v", _kokoProtocol.PROTOCOL_VERS...
```

### 已知非阻塞 warning

```
Attempted to import the module .../@noble/hashes@1.8.0/.../@noble/hashes/crypto.js
which is not listed in the "exports" of "@noble/hashes" under the requested subpath "./crypto.js".
Falling back to file-based resolution.
```

`@noble/hashes/src/crypto.ts` 就一行：`typeof globalThis.crypto !== undefined ? globalThis.crypto : undefined`——读 WebCrypto。Metro 严格 `exports` 字段检查抱怨没声明 `./crypto.js` 子路径，但 fallback 成功。在 Web / native 下 `globalThis.crypto` 都存在。不影响运行。

### 没做

- 没真正调用 libsodium runtime（`initCrypto()` / `generateMasterSecret()`）。`@koko/protocol` 的纯 const（`PROTOCOL_VERSION`）能 bundle 不等于 `libsodium-wrappers` 的 WASM 加载能跑起来。这个验证留给 04b-2 或 04c 正式需要加密时。
- 没碰 iOS Simulator / Android（04a 已说明延后）
- 没碰 QR 扫描 / pairing UI（04b-2 的事，需要产品决定）

### 下一步（留给醒来的 Komako）

04b-2 可以开工——脚手架现在完全就绪。需要你拍板：
1. QR 库选 `expo-barcode-scanner`（managed OK）还是 `react-native-vision-camera`（需 bare / prebuild，但更稳）？
2. pairing UI 布局（scanner + 手动输入后备？）
3. Settings 里 relay URL 改不改（现在硬编码 `http://localhost:8080`）？

（Claude 夜班到此暂停；已 commit。如继续做只会是 housekeeping：DECISIONS.md 记录方案 A 选定、tasks/README 状态更新。不碰产品判断。）
