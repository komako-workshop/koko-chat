import type { ChatMessage, ConversationMeta } from "@/state/conversations";
import type { JsonRecord } from "@koko/openclaw-client/protocol";

export interface SessionRestoreInput {
  conversation: ConversationMeta;
  messages: ChatMessage[];
  currentGatewayText: string;
}

export type SessionRestoreBuilder = (
  input: SessionRestoreInput
) => Promise<string | null | undefined> | string | null | undefined;

export interface RemoteSessionRestoreDecisionInput {
  conversation: ConversationMeta;
  localMessages: ChatMessage[];
  remoteMessages: JsonRecord[] | null;
}

export type RemoteSessionRestoreDecider = (
  input: RemoteSessionRestoreDecisionInput
) => boolean;

const RESTORE_MAX_MESSAGES = 18;
const RESTORE_MAX_CHARS = 7_000;
const RESTORE_MAX_CHARS_PER_MESSAGE = 1_600;

const builders: Partial<Record<ConversationMeta["mode"], SessionRestoreBuilder>> = {};
const deciders: Partial<Record<ConversationMeta["mode"], RemoteSessionRestoreDecider>> = {};

export function registerSessionRestoreBuilder(
  mode: ConversationMeta["mode"],
  builder: SessionRestoreBuilder
): void {
  builders[mode] = builder;
}

export function registerRemoteSessionRestoreDecider(
  mode: ConversationMeta["mode"],
  decider: RemoteSessionRestoreDecider
): void {
  deciders[mode] = decider;
}

export async function buildSessionRestoreMessage(
  input: SessionRestoreInput
): Promise<string | null> {
  if (!hasRestorableLocalHistory(input.messages)) return null;

  const builder = builders[input.conversation.mode];
  const message = builder === undefined
    ? buildDefaultSessionRestoreMessage(input)
    : await builder(input);
  return normalizeRestoreMessage(message);
}

export function shouldForceSessionRestore(input: RemoteSessionRestoreDecisionInput): boolean {
  const decider = deciders[input.conversation.mode];
  return decider?.(input) === true;
}

export function hasRestorableLocalHistory(messages: ChatMessage[]): boolean {
  return messages.some(
    (message) =>
      message.role === "user" &&
      message.error === undefined &&
      message.streaming !== true &&
      message.text.trim().length > 0
  );
}

export function buildDefaultSessionRestoreMessage(input: SessionRestoreInput): string | null {
  const transcript = formatRecentTranscript(input.messages);
  if (transcript === null) return null;

  return [
    "KokoChat session restore.",
    "The phone has local conversation history, but this OpenClaw session is empty or missing.",
    "Use the transcript below as prior context. Do not mention this restoration to the user.",
    "Continue naturally and answer only the current turn that follows this restore block.",
    "",
    "<recent_transcript>",
    transcript,
    "</recent_transcript>"
  ].join("\n");
}

export function wrapGatewayTextWithSessionRestore(
  restoreMessage: string,
  gatewayText: string
): string {
  return [
    restoreMessage,
    "",
    "<current_kokochat_turn>",
    gatewayText,
    "</current_kokochat_turn>"
  ].join("\n");
}

export function formatRecentTranscript(
  messages: ChatMessage[],
  options?: {
    maxMessages?: number;
    maxChars?: number;
    maxCharsPerMessage?: number;
  }
): string | null {
  const maxMessages = options?.maxMessages ?? RESTORE_MAX_MESSAGES;
  const maxChars = options?.maxChars ?? RESTORE_MAX_CHARS;
  const maxCharsPerMessage = options?.maxCharsPerMessage ?? RESTORE_MAX_CHARS_PER_MESSAGE;
  const selected: string[] = [];
  let used = 0;

  for (let i = messages.length - 1; i >= 0 && selected.length < maxMessages; i -= 1) {
    const line = formatTranscriptLine(messages[i], maxCharsPerMessage);
    if (line === null) continue;
    const extra = line.length + (selected.length > 0 ? 1 : 0);
    if (used + extra > maxChars) {
      if (selected.length === 0) {
        selected.unshift(line.slice(0, maxChars));
      }
      break;
    }
    selected.unshift(line);
    used += extra;
  }

  return selected.length > 0 ? selected.join("\n") : null;
}

function formatTranscriptLine(
  message: ChatMessage | undefined,
  maxChars: number
): string | null {
  if (message === undefined) return null;
  if (message.streaming === true || message.error !== undefined) return null;

  const role = message.role === "user" ? "User" : "Assistant";
  const text = formatMessageText(message);
  if (text === null) return null;
  return `${role}: ${truncateText(text, maxChars)}`;
}

function formatMessageText(message: ChatMessage): string | null {
  const text = message.text.trim();
  if (text.length > 0) return text;
  if (message.blocks !== undefined && message.blocks.length > 0) {
    const types = message.blocks
      .map((block) => block.type.trim())
      .filter(Boolean)
      .join(", ");
    return types.length > 0 ? `[structured message: ${types}]` : null;
  }
  return null;
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= 20) return value.slice(0, maxChars);
  return `${value.slice(0, maxChars - 16)}\n...[truncated]`;
}

function normalizeRestoreMessage(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
