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

export type BlockRendererMap = Record<string, BlockRenderer>;

const sharedBlockRenderers: BlockRendererMap = {};
const modeBlockRenderers: Partial<Record<ConversationMeta["mode"], BlockRendererMap>> = {};

export function registerSharedBlockRenderer(type: string, renderer: BlockRenderer): void {
  sharedBlockRenderers[type] = renderer;
}

export function registerModeBlockRenderer(
  mode: ConversationMeta["mode"],
  type: string,
  renderer: BlockRenderer
): void {
  const renderers = modeBlockRenderers[mode] ?? {};
  renderers[type] = renderer;
  modeBlockRenderers[mode] = renderers;
}

/**
 * Renderer lookup rule: shared registry first, then an explicit mode renderer
 * may override it for the same block type.
 */
export function resolveBlockRenderer(
  conversation: ConversationMeta,
  block: MessageBlock
): BlockRenderer | null {
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

export function MessageBlockView({
  block,
  conversation
}: {
  block: MessageBlock;
  conversation: ConversationMeta;
}): React.ReactElement | null {
  const Renderer = resolveBlockRenderer(conversation, block);
  if (Renderer === null) return <UnsupportedMessageBlock block={block} />;
  return <Renderer block={block} conversation={conversation} />;
}
