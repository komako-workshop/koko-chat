import type { ChatMessage, ConversationMeta } from "@/state/conversations";

export interface OutboundMessageInput {
  conversation: ConversationMeta;
  visibleText: string;
  /** Optional mini-app action hint supplied by trusted in-app UI controls. */
  intent?: string;
  /** Host-provided hint only. Mini-app storage remains authoritative. */
  isFirstUserTurn: boolean;
  /** Local messages already visible before this user turn is appended. */
  messagesBeforeTurn: ChatMessage[];
}

export interface OutboundMessage {
  /** Text stored and shown in the local chat UI. */
  visibleText: string;
  /** Text sent to OpenClaw Gateway. May include hidden mini-app bootstrap. */
  gatewayText: string;
  /** True when the message should update local UI but skip Gateway send. */
  localOnly?: boolean;
  /** Called only after OpenClaw accepts the outbound message. */
  onSendAccepted?: () => void | Promise<void>;
}

export type OutboundMessageBuilder = (input: OutboundMessageInput) => Promise<OutboundMessage>;

const outboundMessageBuilders: Partial<Record<ConversationMeta["mode"], OutboundMessageBuilder>> = {};

export function registerOutboundMessageBuilder(
  mode: ConversationMeta["mode"],
  builder: OutboundMessageBuilder
): void {
  outboundMessageBuilders[mode] = builder;
}

export async function buildOutboundMessage(input: OutboundMessageInput): Promise<OutboundMessage> {
  const builder = outboundMessageBuilders[input.conversation.mode];
  if (builder !== undefined) return builder(input);

    // Host default behavior: send exactly what the user sees.
  return {
    visibleText: input.visibleText,
    gatewayText: input.visibleText
  };
}

export function isFirstUserTurn(messages: ChatMessage[]): boolean {
  return messages.every((message) => message.role !== "user");
}
