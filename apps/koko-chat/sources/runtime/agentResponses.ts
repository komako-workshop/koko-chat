import type { ChatMessage, ConversationMeta } from "@/state/conversations";

export interface AgentResponseTransformInput {
  conversation: ConversationMeta;
  runId: string;
  text: string;
}

export interface AgentResponseTransformResult {
  messages: ChatMessage[];
  preview?: string;
}

export type AgentResponseTransformer = (
  input: AgentResponseTransformInput
) => AgentResponseTransformResult | null;

export type AgentStreamingDeferPredicate = (
  input: AgentResponseTransformInput
) => boolean;

/**
 * Streaming 期间,允许 mini-app 把 host 即将写到 chat message 的 text
 * 替换成 "user-visible" 版本。典型用法:agent 流式输出最后接一个 fenced
 * block,fence 那段 raw JSON 流出来很丑;mini-app 返回截到 fence opener
 * 之前的 prose,streaming 时用户只看到干净的 narration。
 *
 * 返回 null 表示不改(host 用 raw fullText)。
 * 只在 streaming(state="delta") 时调用,final 走 transformer。
 */
export type AgentStreamingDisplayTransform = (
  input: AgentResponseTransformInput
) => string | null;

interface AgentResponseTransformerEntry {
  transform: AgentResponseTransformer;
  shouldDeferStreamingText?: AgentStreamingDeferPredicate;
  streamingDisplayText?: AgentStreamingDisplayTransform;
}

const responseTransformers: Partial<Record<ConversationMeta["mode"], AgentResponseTransformerEntry>> = {};

export function registerAgentResponseTransformer(
  mode: ConversationMeta["mode"],
  transformer: AgentResponseTransformer,
  options?: {
    shouldDeferStreamingText?: AgentStreamingDeferPredicate;
    streamingDisplayText?: AgentStreamingDisplayTransform;
  }
): void {
  responseTransformers[mode] = {
    transform: transformer,
    ...(options?.shouldDeferStreamingText !== undefined
      ? { shouldDeferStreamingText: options.shouldDeferStreamingText }
      : {}),
    ...(options?.streamingDisplayText !== undefined
      ? { streamingDisplayText: options.streamingDisplayText }
      : {})
  };
}

export function transformAgentResponse(
  input: AgentResponseTransformInput
): AgentResponseTransformResult | null {
  const entry = responseTransformers[input.conversation.mode];
  if (entry === undefined) return null;
  return entry.transform(input);
}

export function shouldDeferAgentResponseText(
  input: AgentResponseTransformInput
): boolean {
  const entry = responseTransformers[input.conversation.mode];
  return entry?.shouldDeferStreamingText?.(input) === true;
}

export function transformStreamingDisplayText(
  input: AgentResponseTransformInput
): string | null {
  const entry = responseTransformers[input.conversation.mode];
  if (entry?.streamingDisplayText === undefined) return null;
  return entry.streamingDisplayText(input);
}
