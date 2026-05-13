/**
 * Test-only stub of the host's `@/runtime/messageBlocks` module.
 *
 * The real module (apps/koko-chat/sources/runtime/messageBlocks.tsx) imports
 * `react-native` for its renderer types, which `node --experimental-strip-types`
 * cannot load. Tests for the Tavern parser only need the pure-string helper
 * `extractFencedBlock`. This stub provides exactly that, mirroring the host
 * implementation, so test-loader.mjs can redirect `@/runtime/messageBlocks` to
 * this file when running the parser tests under raw Node.
 *
 * If the host implementation of `extractFencedBlock` ever changes, update this
 * stub too. A future refactor that pulls `extractFencedBlock` into a separate
 * RN-free module (e.g. `runtime/fencedBlocks.ts`) will make this stub
 * unnecessary.
 */

export function extractFencedBlock(text, blockType) {
  return extractAllFencedBlocks(text, blockType)[0] ?? null;
}

export function extractAllFencedBlocks(text, blockType) {
  const escaped = escapeRegExp(blockType.trim());
  if (escaped.length === 0) return [];
  const pattern = new RegExp(
    "(^|\\n)```(" + escaped + ")[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n```",
    "g"
  );
  const blocks = [];
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const prefix = match[1] ?? "";
    const start = (match.index ?? 0) + prefix.length;
    const end = (match.index ?? 0) + raw.length;
    blocks.push({
      body: match[3] ?? "",
      intro: text.slice(0, start).trim(),
      language: match[2] ?? blockType,
      start,
      end
    });
  }
  return blocks;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
