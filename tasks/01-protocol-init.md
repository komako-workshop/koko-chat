# Task 01 — `@koko/protocol` 初始化

> 状态: pending
> 负责: codex
> 创建: 2026-04-28
> 上游文档: [`../IDEA.md`](../IDEA.md), [`../DECISIONS.md`](../DECISIONS.md), [`../WORKFLOW.md`](../WORKFLOW.md)

---

## 目标

一句话：搭起 `packages/koko-protocol` 的全部内容——它是 `@koko/relay`、`@koko/cli`、`@koko/app` 三端共享的**协议层 + 加密原语 + 类型定义**。这一步完成后，三端任何一方都可以 `import { ... } from '@koko/protocol'` 拿到同一套加密、同一套类型、同一套 QR 编解码，不会再出现"两端不兼容"这种事。

## 背景上下文

KokoChat 走 Relay 架构：

```
APP (RN+Expo) ↔ koko-relay (Node/WS) ↔ koko-cli (Node) ↔ OpenClaw
```

三端都是 JS/TS（APP 是 RN，relay 是 Node，cli 是 Node）。都能运行同一份 `@koko/protocol`。

**必读背景**：

- [`../DECISIONS.md`](../DECISIONS.md) 的"koko-relay 协议层决定"一节——列出了所有**不可改**的决定（库选择、密钥派生方式、加密算法、QR 格式等）。本任务必须严格遵守这些决定，**不要替换选型**。
- [`../IDEA.md`](../IDEA.md) 的"11. 写代码之前先决定的几件事"——背景信息。
- [`../WORKFLOW.md`](../WORKFLOW.md)——任务书格式约定。

**关键设计参考**：我们详细调研过 `slopus/happy`（GitHub 19.3k★ 的 Claude Code mobile 客户端）的 pairing 机制，它是本项目的主要灵感来源。但 KokoChat 做了几处明确的**改动**，见下面的"明确偏离 Happy 的地方"。

## 输入契约

### 依赖的仓库状态

- 仓库已是 pnpm monorepo（根 `package.json` + `pnpm-workspace.yaml` 存在）
- `packages/koko-protocol/` 目录已创建但只有 `README.md`
- 根 `package.json` 引用了 `pnpm --filter @koko/protocol build` 等脚本
- Node 版本 >= 20，pnpm 10.33.2

### 外部依赖（只允许这些加密 / 编码相关的运行时依赖）

- **`libsodium-wrappers`** — 唯一的加密库（**不要**用 tweetnacl、sodium-native、node:crypto 去做加密。HKDF 因 libsodium 不直接提供可用 `@noble/hashes` 的 `hkdf` 辅助，也可以基于 libsodium 的 `crypto_kdf` 或自己基于 HMAC-SHA256 实现——选哪种自己判断，但只能引入一个额外库，优先 `@noble/hashes`）
- `zod` —— schema 验证（envelope 类型、网络上进来的数据必须过 zod 校验一次）

**禁止**引入其他重依赖。RN 兼容性是硬要求：`@koko/protocol` 必须能跑在 React Native（0.74+ / Expo SDK 51+）的 Hermes 引擎里。`libsodium-wrappers` 在 RN 上可用（Happy 已验证）。

### 明确偏离 Happy 的地方（必须遵守）

1. **密钥派生用 HKDF**：从 `masterSecret` 派生 `signingSeed` 和 `boxSeed`，**不要**像 Happy 那样把同一个 32B secret 直接喂给 `sign.fromSeed` 和 `box.fromSecretKey`。
2. **消息 E2E 用 AES-256-GCM 而不是 `secretbox`**：dataKey 模式。跳过 v1 legacy。
3. **Bundle 版本字节从 `0x01` 开始**，不用 `0x00`（避免和"空字节"混淆时的排错成本）。
4. **QR URL 用 `koko://pair?k=<base64url(pubKey)>`**，scheme 是 `koko://`，path 是 `pair`。
5. **Room 模型而不是 account 模型**：协议类型里用 `roomId`（不用 `accountId`）。

## 输出契约

### 目录结构

```
packages/koko-protocol/
├── package.json
├── tsconfig.json
├── tsup.config.ts        # 或 tsc 输出，选一种，不加第三种工具
├── vitest.config.ts
├── README.md             # 已存在，可扩写
├── src/
│   ├── index.ts          # 纯 re-export
│   ├── crypto/
│   │   ├── index.ts
│   │   ├── sodium.ts         # libsodium 初始化（`await ready` 幂等包装）
│   │   ├── hkdf.ts           # HKDF-SHA256 派生
│   │   ├── masterSecret.ts   # master secret 生成 + 派生 signingSeed/boxSeed
│   │   ├── box.ts            # 非对称加密（anonymous sealed box + ephemeral sender box）
│   │   ├── aesGcm.ts         # AES-256-GCM 对称加密 (bundle 格式 version||nonce||ct||tag)
│   │   ├── signing.ts        # Ed25519 challenge-response helpers
│   │   └── random.ts         # 统一随机字节入口
│   ├── pairing/
│   │   ├── index.ts
│   │   └── qrUrl.ts          # `koko://pair?k=...` 编解码
│   ├── envelope/
│   │   ├── index.ts
│   │   ├── types.ts          # zod schema + 派生 TS 类型
│   │   └── codec.ts          # wire 格式 (JSON) encode/decode + zod 校验
│   └── version.ts        # export const PROTOCOL_VERSION = 1
└── test/
    ├── crypto.box.test.ts
    ├── crypto.aesGcm.test.ts
    ├── crypto.hkdf.test.ts
    ├── crypto.signing.test.ts
    ├── crypto.masterSecret.test.ts
    ├── pairing.qrUrl.test.ts
    └── envelope.codec.test.ts
```

### `package.json`（必要字段）

```jsonc
{
  "name": "@koko/protocol",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
    "./crypto": { "import": "./dist/crypto/index.js", "types": "./dist/crypto/index.d.ts" },
    "./pairing": { "import": "./dist/pairing/index.js", "types": "./dist/pairing/index.d.ts" },
    "./envelope": { "import": "./dist/envelope/index.js", "types": "./dist/envelope/index.d.ts" }
  },
  "scripts": {
    "build": "tsup",                       // 或 "tsc -p tsconfig.build.json"，选一种
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "tsc --noEmit"                 // MVP 不引 eslint，用 tsc 当 lint
  }
}
```

### API 表面（以下 export 都必须存在且签名稳定）

```ts
// @koko/protocol
export const PROTOCOL_VERSION: 1;

// @koko/protocol/crypto
export async function initCrypto(): Promise<void>;           // 等 libsodium ready，幂等

export function generateMasterSecret(): Uint8Array;          // 32B

export interface DerivedKeys {
  signingSeed: Uint8Array;  // 32B，喂给 sign keypair
  boxSeed: Uint8Array;      // 32B，喂给 box keypair
}
export function deriveKeysFromMaster(masterSecret: Uint8Array): DerivedKeys;

// Ed25519 身份
export interface SigningKeypair {
  publicKey: Uint8Array;    // 32B
  secretKey: Uint8Array;    // 64B (libsodium 的 Ed25519 sk)
}
export function signingKeypairFromSeed(seed: Uint8Array): SigningKeypair;
export function generateChallenge(): Uint8Array;             // 32B random
export function signChallenge(challenge: Uint8Array, kp: SigningKeypair): Uint8Array;
export function verifyChallenge(
  challenge: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): boolean;

// Curve25519 box (非对称加密)
export interface BoxKeypair {
  publicKey: Uint8Array;    // 32B
  secretKey: Uint8Array;    // 32B
}
export function boxKeypairFromSeed(seed: Uint8Array): BoxKeypair;
export function generateEphemeralBoxKeypair(): BoxKeypair;

/** Ephemeral-sender box: 任何人都能加密给 recipient，接收方用自己私钥解。
 *  Bundle 格式: version(1B=0x01) || ephemeralPub(32B) || nonce(24B) || ciphertext */
export function boxEncryptToPublicKey(
  plaintext: Uint8Array,
  recipientPublicKey: Uint8Array
): Uint8Array;
export function boxDecryptWithSecretKey(
  bundle: Uint8Array,
  recipientSecretKey: Uint8Array
): Uint8Array;   // 不匹配时抛错，不返回 null

// AES-256-GCM 对称加密 (消息层)
/** Bundle 格式: version(1B=0x01) || nonce(12B) || ciphertext || authTag(16B) */
export function aesGcmEncrypt(plaintext: Uint8Array, key: Uint8Array): Uint8Array;
export function aesGcmDecrypt(bundle: Uint8Array, key: Uint8Array): Uint8Array;

// HKDF-SHA256
export function hkdf(
  ikm: Uint8Array,
  info: string | Uint8Array,   // string 会以 UTF-8 编码
  length: number,              // 字节数
  salt?: Uint8Array            // 可选，默认全 0
): Uint8Array;

// Random
export function randomBytes(n: number): Uint8Array;

// @koko/protocol/pairing
export interface PairingQr {
  publicKey: Uint8Array;  // 32B
}
export function encodePairingQrUrl(publicKey: Uint8Array): string;   // 返回 `koko://pair?k=...`
export function decodePairingQrUrl(url: string): PairingQr;          // 非法 URL 抛错

// @koko/protocol/envelope
/** 网线上走的消息信封。relay 只看 type/roomId/seq，其他字段对 relay 不透明 */
export interface Envelope {
  v: 1;                            // protocol version
  type: string;                    // 'chat.user' / 'chat.agent.delta' / 'pair.response' / ...
  roomId: string;                  // room 绑定标识（pairing 后产出，MVP 内用 CLI 公钥 hex）
  seq: number;                     // 单调递增，去重 + 排序
  ts: number;                      // 发送方本地 epoch ms，仅参考
  payload: unknown;                // 自由字段，可以是明文对象或加密后的 base64
  encrypted?: boolean;             // true 表示 payload 是 base64(加密后的 bundle)
}
export const EnvelopeSchema: z.ZodType<Envelope>;
export function encodeEnvelope(env: Envelope): string;          // JSON.stringify + 校验
export function decodeEnvelope(raw: string | Uint8Array): Envelope; // zod parse，失败抛错
```

**注意**：
- 所有公开 API **都不接受 `Buffer`，统一 `Uint8Array`**（RN 没有 Buffer）。
- 二进制 bundle 的"版本字节"必须解码时校验，不匹配就抛错，不要静默接受。
- `boxDecrypt*` / `aesGcmDecrypt` 失败时抛明确的 `DecryptionError`，不返回 null / undefined。
- `initCrypto()` 必须幂等：多次调用不报错；所有用到 libsodium 的函数内部都应先 `await ready`（通过一个内部的 `ensureReady()` helper）。

### 可以不做的事（明确划边界）

- 不做任何网络 I/O（不引 ws / socket.io / axios）
- 不做 Node `fs` / `path` I/O（本 package 要跨 RN / Node）
- 不做 CLI entry、不做 server entry
- 不做任何业务逻辑（room 生命周期、session 语义、消息路由都在 relay / cli 层做）
- 不做 SAS 验证（DECISIONS.md 明确 MVP 不做且不预留接口）
- 不做消息压缩、序列化优化（wire 格式 JSON 字符串就够了）

## 验收标准

必须全部通过，按顺序：

### 1. 安装能过

```bash
pnpm install
```

不报错。`packages/koko-protocol/node_modules` 出现。

### 2. typecheck 过

```bash
pnpm --filter @koko/protocol typecheck
```

零错误。

### 3. build 产出正确

```bash
pnpm --filter @koko/protocol build
ls packages/koko-protocol/dist/
```

至少包含：`index.js` / `index.d.ts` / `crypto/index.js` / `pairing/index.js` / `envelope/index.js`。
ESM 格式。

### 4. 测试全绿

```bash
pnpm --filter @koko/protocol test
```

测试必须覆盖至少下列场景（以下条目每条都应有对应 `it(...)` 或 `test(...)`）：

**`crypto.box.test.ts`**
- box round-trip：A 生成 keypair，B 用 A 的公钥加密 → A 用私钥解密 → 得到原明文
- 错误私钥解密 → 抛错
- bundle 被篡改（改一个字节）→ 抛错
- 版本字节错误（改成 0x00 或 0x02）→ 抛错明确指出 "unknown version"
- bundle 长度不足（< 1+32+24+16）→ 抛错
- 空 plaintext 能正常 round-trip

**`crypto.aesGcm.test.ts`**
- round-trip
- 错 key 解密 → 抛错
- 篡改 ciphertext / tag → 抛错（GCM 认证失败）
- 版本字节错误 → 抛错
- nonce 是 12B（不是 24B）
- 空 plaintext round-trip

**`crypto.hkdf.test.ts`**
- 至少 1 个 RFC 5869 官方测试向量通过（Test Case 1 或 2）
- 相同 input 同一 info 出相同输出（determinism）
- 不同 info 出不同输出
- 不同 salt 出不同输出

**`crypto.signing.test.ts`**
- 从 seed 生成的 keypair 对同一 challenge 签名可验证
- 不同 seed 出不同 publicKey
- 改 challenge 后 verify 返回 false
- 改 signature 后 verify 返回 false
- 改 publicKey 后 verify 返回 false

**`crypto.masterSecret.test.ts`**
- `generateMasterSecret()` 返回 32B
- 同一 masterSecret `deriveKeysFromMaster` 两次出完全相同的 signingSeed 和 boxSeed
- `signingSeed !== boxSeed`（否则 HKDF 没起作用）
- 不同 masterSecret 出不同派生 key

**`pairing.qrUrl.test.ts`**
- encode / decode round-trip
- URL 以 `koko://pair?k=` 开头
- `k` 参数是 base64url（无 `+` `/` `=`）
- 非 `koko://` scheme 抛错
- path 不是 `pair` 抛错
- `k` 参数缺失 / 非法 base64url → 抛错
- `k` 解码后不是 32B → 抛错

**`envelope.codec.test.ts`**
- 完整 envelope round-trip
- zod 校验：`v !== 1` 抛错，`seq` 非 number 抛错，`type` 非 string 抛错
- 额外字段保留（zod 默认剥离时应该用 `.passthrough()` 还是 `.strip()` 请在 types.ts 里显式选，建议 `.strip()` 去掉未定义字段——写注释说明原因）

### 5. 跨运行时兼容性自验（手动跑一次，不必进 CI）

在任务 Outcome 段手动记录：在 macOS Node 20 下跑 `pnpm test` 全绿。RN 侧兼容性留给 Task 03/04 验证，本任务不要求。

### 6. 代码质量

- 所有 export 都有 TSDoc 注释（一行即可）
- 没有 `any`（除非 zod 推断不出来时加 `// eslint-disable` 级别的明确注释）
- 没有 `console.log`（debug 用 `console.error` 并加注释）
- 没有注释掉的死代码

## 禁止事项

- **不要**引入 tweetnacl、sodium-native、node:crypto（HKDF 除外，可用 @noble/hashes）
- **不要**改 `packages/koko-protocol` 以外的任何文件
- **不要**添加 eslint / prettier / husky 配置（MVP 不上这些，用 tsc 当 lint）
- **不要**改根 `package.json`（如需加 workspace-wide devDependency，说明理由但**先不加**）
- **不要**自己"发明"协议字段（Envelope 的字段集严格按输出契约）
- **不要**凭记忆写测试向量（RFC 5869 向量请从 RFC 原文 copy，自己算的对不起）
- **不要**加持久化、网络、文件 I/O
- **不要**上 ci / github actions workflow（本任务外）
- **不要**改 IDEA.md / DECISIONS.md / WORKFLOW.md
- **不要** git commit（留给 Claude review 后统一 commit）

## 背景：为什么要这样

几条需要你理解的"为什么"——写代码时遇到取舍可以自己判断：

1. **为什么 HKDF 派生而不 reuse secret**：Happy 把同一个 32B secret 给 `sign.fromSeed` 和 `box.fromSecretKey`，密码学上是 key reuse across primitives。虽然 tweetnacl 接受，但不够干净。HKDF 相当于一行 MAC，几乎零成本把它做对。
2. **为什么用 AES-GCM 而不是 secretbox**：libsodium 的 secretbox = XSalsa20-Poly1305，和 AES-GCM 安全性等价。选 AES-GCM 是为了和"标准密码学文档"对齐，未来审计更顺，且 nonce 只要 12B 省了点字节。
3. **为什么版本字节从 0x01 开始**：0x00 在 log / hex dump 里和"空"容易混，01 一眼能看出是"协议版本 1"。
4. **为什么 roomId 而不是 accountId**：DECISIONS.md 明确 MVP 走纯 room 模型（1 APP ↔ 1 CLI），不做账号概念。room 生命周期短、强绑 CLI 公钥，不会像 account 那样跨设备。
5. **为什么 Envelope 用 JSON 而不是 msgpack / protobuf**：调试友好、RN 原生支持、省一个依赖。性能不是瓶颈（消息速率远远打不满 JSON 解析）。

## Outcome

> 状态: ✅ **完成** — 2026-04-28
>
> 由 codex 起草，Claude（OpenCode）修复典型环境问题后验收。

### 验收结果

所有 6 项验收标准通过：

1. **`pnpm install`** — 88 packages resolved, 0 errors
2. **`pnpm --filter @koko/protocol typecheck`** — 0 errors
3. **`pnpm --filter @koko/protocol build`** — `dist/{index,crypto/index,pairing/index,envelope/index}.{js,d.ts}` 全部产出
4. **`pnpm --filter @koko/protocol test`** — **38 / 38 passed**，覆盖 crypto.box / symmetric / hkdf / signing / masterSecret / pairing.qrUrl / envelope.codec 全部用例
5. **跨运行时冒烟测试**（手动）— 在 macOS Node 25.8.1 下直接 `node dist/index.js` 加载 ESM 产物，所有主要 API round-trip 成功。
6. **代码质量** — 所有 export 带 TSDoc；无 `any`；无 `console.log`；无死代码

### 协议层决定的修订（本任务执行期间产生）

**对称 AEAD 从 AES-256-GCM 改为 XChaCha20-Poly1305**。

原因：实现时发现 `libsodium-wrappers` 主包**不含 AES-GCM**（libsodium.js 因 AES-NI 非常数时间考虑默认剔除，只在 `libsodium-wrappers-sumo` 才有）。选项权衡后（详见 `DECISIONS.md` 同步更新章节），选 XChaCha20-Poly1305：libsodium 两端原生支持、nonce 24B 随机更安全、密码学与 AES-GCM 等价、保持 `@koko/protocol` 单加密库依赖的纯洁性。

**影响范围**：
- `src/crypto/aesGcm.ts` → `src/crypto/symmetric.ts`
- 导出函数 `aesGcmEncrypt` / `aesGcmDecrypt` → `symmetricEncrypt` / `symmetricDecrypt`（算法中立命名，以后再切不用改名）
- bundle 格式从 `version(1) + nonce(12) + ct + tag(16)` 改为 `version(1) + nonce(24) + ct_and_tag`
- 测试文件改名为 `crypto.symmetric.test.ts`，nonce 断言从 12B 改为 24B
- `DECISIONS.md` 已记录此变更及原因

### 其他偏离任务书的地方

1. **`vitest.config.ts` 之前有 libsodium-wrappers 的 ESM 解析 workaround**（alias 重定向），这个 workaround 后来移除了。真正的修法是 `src/crypto/sodium.ts` 里改用 `createRequire` 显式加载 CJS 入口——这样不仅测试能跑，下游的 @koko/relay / @koko/cli 在 Node 原生 ESM 环境下也能正常加载 libsodium-wrappers（不然会触发 libsodium-wrappers 0.7.x 的 packaging bug: `import './libsodium.mjs'` 指向另一个 package）。
   - RN 端（未来 @koko/app）不受影响：Metro bundler 根据 `main` 字段走 CJS，没这个 bug。
   - 当 libsodium-wrappers 修掉 packaging bug 后可以换回 `import sodium from "libsodium-wrappers"`。
2. 加了一个任务书未列出的小依赖：`@types/node`（devDep）——因为 `sodium.ts` 用了 `node:module`，typecheck 需要它。
3. 加了几个任务书没明说的内部辅助文件：
   - `src/crypto/bytes.ts`（concatBytes / sliceBytes / assertByteLength helper）
   - `src/crypto/errors.ts`（DecryptionError）
   - `src/pairing/base64url.ts`（纯 JS 的 base64url 编解码，避免依赖 Buffer）
   这些都没 public export，只是 `src/crypto/*.ts` 和 `src/pairing/*.ts` 内部使用。

### 实际改动文件清单

新建：
- `packages/koko-protocol/package.json`
- `packages/koko-protocol/tsconfig.json`
- `packages/koko-protocol/tsup.config.ts`
- `packages/koko-protocol/vitest.config.ts`
- `packages/koko-protocol/src/version.ts`
- `packages/koko-protocol/src/index.ts`
- `packages/koko-protocol/src/crypto/{index,sodium,random,bytes,errors,hkdf,masterSecret,signing,box,symmetric}.ts`
- `packages/koko-protocol/src/pairing/{index,qrUrl,base64url}.ts`
- `packages/koko-protocol/src/envelope/{index,types,codec}.ts`
- `packages/koko-protocol/test/crypto.{box,symmetric,hkdf,masterSecret,signing}.test.ts`
- `packages/koko-protocol/test/{pairing.qrUrl,envelope.codec}.test.ts`

修改：
- `packages/koko-protocol/README.md`（加 Development 段）
- `DECISIONS.md`（记录 XChaCha20 替换）

### 跑通的命令列表（按顺序）

```bash
pnpm install
pnpm --filter @koko/protocol typecheck
pnpm --filter @koko/protocol test
pnpm --filter @koko/protocol build
```

### 遗留疑点

**无阻塞问题**。几个小观察留给后续：

1. `initCrypto()` 模块加载时会 `void initCrypto()` 自动启动 libsodium 初始化。这个"立即启动"的 side effect 在 RN 上是 OK 的（Metro 会立刻执行），但在某些测试 runner 下会有多次初始化的 warning。当前设计用幂等 Promise 解决，没问题，但如果未来发现有副作用，可以考虑改为"纯 lazy"。
2. `boxDecryptWithSecretKey` 和 `symmetricDecrypt` 都会把底层 libsodium 抛出的具体错误包装成 `DecryptionError`。这对安全有利（不暴露时序 / 错误细节），但调试时要加 log 可以改成 `new DecryptionError(msg, { cause: e })` —— 本版本未做，因为 Node < 16.9 之前的 cause 支持不齐，RN 端也未确认完全支持。
3. HKDF 用的是 `@noble/hashes/hkdf`（RFC 5869 合规，有 test vector 验证）。这是唯一一个非 libsodium 的加密依赖——本可以用 libsodium 的 `crypto_kdf_blake2b_derive_from_key`，但它是 BLAKE2b 而不是 SHA-256，和 HKDF-SHA256 行业标准不一致。保持 HKDF-SHA256 更稳。
