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

interface AgentResponseTransformerEntry {
  transform: AgentResponseTransformer;
  shouldDeferStreamingText?: AgentStreamingDeferPredicate;
}

const responseTransformers: Partial<Record<ConversationMeta["mode"], AgentResponseTransformerEntry>> = {};

export function registerAgentResponseTransformer(
  mode: ConversationMeta["mode"],
  transformer: AgentResponseTransformer,
  options?: {
    shouldDeferStreamingText?: AgentStreamingDeferPredicate;
  }
): void {
  responseTransformers[mode] = {
    transform: transformer,
    ...(options?.shouldDeferStreamingText !== undefined
      ? { shouldDeferStreamingText: options.shouldDeferStreamingText }
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
