import { createRequire } from "node:module";

// libsodium-wrappers 0.7.x 的 ESM 发布有一个已知 packaging bug：
// 其 `dist/modules-esm/libsodium-wrappers.mjs` 里写的是 `import './libsodium.mjs'`，
// 但这个相对路径指向的文件实际不存在（真正的 libsodium.mjs 在独立的
// `libsodium` package 里，但 ESM loader 不会跨 package 找）。
// CJS 入口 (`dist/modules/libsodium-wrappers.js`) 没这个问题，所以显式走 CJS。
//
// 注意：
//   - Node 端（@koko/relay, @koko/cli）：createRequire 可用
//   - RN 端（@koko/app）：RN 的 Metro bundler 会根据 react-native 字段解析，
//     libsodium-wrappers 的 "main" 字段就是 CJS，Metro 也走 CJS，没这个问题。
//     这个 ESM bug 只影响 Node 的原生 ESM loader。
//
// 当 libsodium-wrappers 升级修掉 issue #401 后，可以换回 `import sodium from ...`。
const require = createRequire(import.meta.url);
const sodium = require("libsodium-wrappers") as typeof import("libsodium-wrappers");

let readyPromise: Promise<void> | undefined;
let ready = false;

/** Initializes libsodium once; repeated calls are safe. */
export async function initCrypto(): Promise<void> {
  readyPromise ??= sodium.ready.then(() => {
    ready = true;
  });

  await readyPromise;
}

/** Ensures synchronous crypto helpers only run after initCrypto has completed. */
export function ensureReady(): void {
  if (!ready) {
    throw new Error("libsodium is not initialized; call await initCrypto() first");
  }
}

void initCrypto();

export { sodium };
