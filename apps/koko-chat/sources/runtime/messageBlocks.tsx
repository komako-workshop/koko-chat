import { Text, View } from "react-native";
import tw from "twrnc";

import type { ConversationMeta, MessageBlock } from "@/state/conversations";

export interface BlockRenderProps<TData = unknown> {
  block: MessageBlock<TData>;
  conversation: ConversationMeta;
}

export type BlockRenderer<TData = unknown> = (
  props: BlockRenderProps<TData>
) => React.ReactElement | null;

export type MessageBlockDataGuard<TData> = (data: unknown) => data is TData;

export interface BlockRendererEntry<TData = unknown> {
  renderer: BlockRenderer<TData>;
  guard?: MessageBlockDataGuard<TData>;
}

export type BlockRendererMap = Record<string, BlockRendererEntry>;

const sharedBlockRenderers: BlockRendererMap = {};
const modeBlockRenderers: Partial<Record<ConversationMeta["mode"], BlockRendererMap>> = {};

export function registerSharedBlockRenderer<TData = unknown>(
  type: string,
  renderer: BlockRenderer<TData>
): void;
export function registerSharedBlockRenderer<TData>(
  type: string,
  guard: MessageBlockDataGuard<TData>,
  renderer: BlockRenderer<TData>
): void;
export function registerSharedBlockRenderer<TData>(
  type: string,
  guardOrRenderer: MessageBlockDataGuard<TData> | BlockRenderer<TData>,
  maybeRenderer?: BlockRenderer<TData>
): void {
  sharedBlockRenderers[type] = normalizeRendererEntry(guardOrRenderer, maybeRenderer);
}

export function registerModeBlockRenderer<TData = unknown>(
  mode: ConversationMeta["mode"],
  type: string,
  renderer: BlockRenderer<TData>
): void;
export function registerModeBlockRenderer<TData>(
  mode: ConversationMeta["mode"],
  type: string,
  guard: MessageBlockDataGuard<TData>,
  renderer: BlockRenderer<TData>
): void;
export function registerModeBlockRenderer<TData>(
  mode: ConversationMeta["mode"],
  type: string,
  guardOrRenderer: MessageBlockDataGuard<TData> | BlockRenderer<TData>,
  maybeRenderer?: BlockRenderer<TData>
): void {
  const renderers = modeBlockRenderers[mode] ?? {};
  renderers[type] = normalizeRendererEntry(guardOrRenderer, maybeRenderer);
  modeBlockRenderers[mode] = renderers;
}

function normalizeRendererEntry<TData>(
  guardOrRenderer: MessageBlockDataGuard<TData> | BlockRenderer<TData>,
  maybeRenderer?: BlockRenderer<TData>
): BlockRendererEntry {
  if (maybeRenderer === undefined) {
    return { renderer: guardOrRenderer as BlockRenderer };
  }
  return {
    guard: guardOrRenderer as MessageBlockDataGuard<TData>,
    renderer: maybeRenderer as BlockRenderer
  };
}

/**
 * Renderer lookup rule: explicit mode renderer first, then shared renderer.
 * Register mode renderers only when a mode intentionally overrides a shared
 * block type.
 */
export function resolveBlockRenderer(
  conversation: ConversationMeta,
  block: MessageBlock
): BlockRendererEntry | null {
  return modeBlockRenderers[conversation.mode]?.[block.type] ?? sharedBlockRenderers[block.type] ?? null;
}

export function UnsupportedMessageBlock({ block }: { block: MessageBlock }): React.ReactElement {
  return (
    <View style={tw`rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900`}>
      <Text style={tw`text-xs font-semibold text-slate-600 dark:text-slate-300`}>
        Unsupported message block
      </Text>
      <Text style={tw`mt-1 text-xs text-slate-500 dark:text-slate-400`}>
        {block.type} v{block.version}
      </Text>
    </View>
  );
}

export function InvalidMessageBlock({ block }: { block: MessageBlock }): React.ReactElement {
  return (
    <View style={tw`rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 dark:border-rose-900 dark:bg-rose-950`}>
      <Text style={tw`text-xs font-semibold text-rose-700 dark:text-rose-200`}>
        Invalid message block data
      </Text>
      <Text style={tw`mt-1 text-xs text-rose-600 dark:text-rose-300`}>
        {block.type} v{block.version}
      </Text>
    </View>
  );
}

export function MessageBlockView({
  block,
  conversation
}: {
  block: MessageBlock;
  conversation: ConversationMeta;
}): React.ReactElement | null {
  const entry = resolveBlockRenderer(conversation, block);
  if (entry === null) return <UnsupportedMessageBlock block={block} />;
  if (entry.guard !== undefined && !entry.guard(block.data)) {
    return <InvalidMessageBlock block={block} />;
  }
  const Renderer = entry.renderer;
  return <Renderer block={block} conversation={conversation} />;
}

export interface ExtractedFencedBlock {
  body: string;
  intro: string;
  language: string;
  start: number;
  end: number;
}

export function extractFencedBlock(
  text: string,
  blockType: string
): ExtractedFencedBlock | null {
  return extractAllFencedBlocks(text, blockType)[0] ?? null;
}

export function extractAllFencedBlocks(
  text: string,
  blockType: string
): ExtractedFencedBlock[] {
  const escaped = escapeRegExp(blockType.trim());
  if (escaped.length === 0) return [];
  const pattern = new RegExp(
    "(^|\\n)```(" + escaped + ")[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n```",
    "g"
  );
  const blocks: ExtractedFencedBlock[] = [];
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
