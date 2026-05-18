import {
  registerOutboundMessageBuilder,
  type OutboundMessageBuilder
} from "@/runtime/outboundMessages";
import { inferOnce } from "@/runtime/openclaw";
import { registerMiniApp } from "@/runtime/miniApps";
import {
  useConversationStore,
  type ChatMessage
} from "@/state/conversations";

/**
 * Example mini-app: "Hello OpenClaw".
 *
 * The smallest realistic mini-app, intended as a developer reference. It does
 * three things in one mode:
 *
 *   1. Declares itself in the mini-app registry.
 *   2. Registers an outbound message builder that runs `inferOnce` on every
 *      user message and appends the agent's reply as a normal agent message.
 *   3. Uses no custom UI: the existing /chat/[id] screen renders everything.
 *
 * Read this file alongside docs/mini-app-runtime.md.
 *
 * What this demonstrates:
 *   - mini-app registration via a single idempotent function
 *   - outbound `localOnly` to bypass the default Gateway send
 *   - one-shot agent calls via the runtime
 *   - writing replies back into the host conversation message buffer
 *
 * What this intentionally skips:
 *   - block renderers / cards
 *   - persistent agent sessions (each turn is a fresh inferOnce)
 *   - mini-app-owned storage
 *   - any custom screens
 *
 * If you are starting a new mini-app, copy this folder, change the descriptor,
 * and grow from there.
 */

const MINI_APP_ID = "example";

let registered = false;

const exampleOutboundBuilder: OutboundMessageBuilder = async ({
  conversation,
  visibleText
}) => {
  schedulePlaceholderAndReply(conversation.id, visibleText);
  return {
    visibleText,
    gatewayText: visibleText,
    localOnly: true
  };
};

function schedulePlaceholderAndReply(conversationId: string, userText: string): void {
  const placeholderId = `example-pending-${Date.now()}`;
  const store = useConversationStore.getState();

  store.setMessages(conversationId, (prev) => [
    ...prev,
    {
      id: placeholderId,
      role: "agent",
      text: "",
      streaming: true
    }
  ]);

  void runInference(conversationId, placeholderId, userText);
}

async function runInference(
  conversationId: string,
  placeholderId: string,
  userText: string
): Promise<void> {
  const store = useConversationStore.getState();
  try {
    const result = await inferOnce({
      miniAppId: MINI_APP_ID,
      prompt: buildPrompt(userText),
      timeoutMs: 60_000
    });
    const replyText = result.text.length > 0 ? result.text : "(没有返回内容)";
    finalizeMessage(conversationId, placeholderId, replyText, undefined);
    if (replyText.length > 0) {
      store.touch(conversationId, replyText.slice(0, 120));
    }
  } catch (error) {
    finalizeMessage(
      conversationId,
      placeholderId,
      "",
      error instanceof Error ? error.message : String(error)
    );
  }
}

function buildPrompt(userText: string): string {
  // The host does not provide a context bridge yet. Mini-apps build their own
  // prompts. Keep them small and explicit.
  return [
    "You are the KokoChat Example mini-app.",
    "Reply to the user briefly in their language.",
    "Do not call tools unless explicitly required by the user.",
    "",
    `User: ${userText}`
  ].join("\n");
}

function finalizeMessage(
  conversationId: string,
  placeholderId: string,
  text: string,
  error: string | undefined
): void {
  useConversationStore.getState().setMessages(conversationId, (prev) => {
    const idx = prev.findIndex((m) => m.id === placeholderId);
    if (idx < 0) return prev;
    const next = [...prev];
    const existing = prev[idx];
    if (existing === undefined) return prev;
    const updated: ChatMessage = {
      ...existing,
      text,
      streaming: false,
      ...(error !== undefined ? { error } : {})
    };
    next[idx] = updated;
    return next;
  });
}

export function registerExampleMiniApp(): void {
  if (registered) return;
  registered = true;

  registerMiniApp({
    id: MINI_APP_ID,
    displayName: "Example",
    listGlyph: "Ex",
    // Developer reference only — never surfaced in the production "+" menu.
    // The registration stays so existing example conversations keep rendering
    // and so mini-app authors can copy this folder as a starting point.
    showInLauncher: false,
    defaultTitle: (createdAt) => `Example ${formatTime(createdAt)}`,
    // Keep the developer reference app usable on a stock OpenClaw install.
    // Real mini-apps should normally omit this so their default agent id is
    // their own mini-app id.
    openclaw: { defaultAgentId: "main" },
    onCreate: () => useConversationStore.getState().create({ mode: MINI_APP_ID })
  });
  registerOutboundMessageBuilder(MINI_APP_ID, exampleOutboundBuilder);
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
