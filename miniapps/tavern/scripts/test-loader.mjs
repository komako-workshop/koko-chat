/**
 * Resolver hook used only by miniapps/tavern/scripts/test-tavern-parse.mjs.
 *
 * The mini-app source code uses the host's `@/*` path alias when importing
 * KokoChat runtime utilities (e.g. `@/runtime/messageBlocks`). Metro and
 * tsc resolve that alias via tsconfig.paths; raw Node does not. This loader
 * hooks Node's module resolution and rewrites those imports so the parser
 * file can be loaded by `node --experimental-strip-types`.
 *
 * Strategy:
 *   - `@/runtime/messageBlocks` is redirected to a pure-JS stub that mirrors
 *     the host's `extractFencedBlock` implementation. The real host module
 *     imports `react-native` and cannot be loaded outside a bundler.
 *   - Any other `@/...` import (none today, but this future-proofs the test
 *     loader) is redirected to the host's source tree, where it will succeed
 *     if the file is RN-free.
 *
 * Scope: tests only. Production builds use the regular bundler-driven alias.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { access } from "node:fs/promises";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOST_SOURCES = resolvePath(HERE, "../../../apps/koko-chat/sources");
const STUB_MESSAGE_BLOCKS = resolvePath(HERE, "test-fixtures/messageBlocks-stub.mjs");

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@/runtime/messageBlocks") {
    return nextResolve(pathToFileURL(STUB_MESSAGE_BLOCKS).href, context);
  }
  if (specifier.startsWith("@/")) {
    const tail = specifier.slice(2);
    for (const candidate of [`${tail}.ts`, `${tail}.tsx`, `${tail}/index.ts`, `${tail}/index.tsx`]) {
      const fullPath = resolvePath(HOST_SOURCES, candidate);
      try {
        await access(fullPath);
        return nextResolve(pathToFileURL(fullPath).href, context);
      } catch {
        // try next candidate
      }
    }
  }
  return nextResolve(specifier, context);
}
