import type { JsonRecord } from "@koko/openclaw-client/protocol";

import type { BrowserGatewayClient } from "@/gateway/BrowserGatewayClient";
import { useGatewayStore } from "@/state/gateway";
import type { MiniAppId } from "@/state/conversations";
import { resolveMiniAppAgentId } from "@/runtime/miniApps";

const DEFAULT_INFER_TIMEOUT_MS = 3_600_000;
const DEFAULT_HISTORY_LIMIT = 8;
const DEFAULT_HISTORY_MAX_CHARS = 8_000;

export interface OpenClawRpcClient {
  call(method: string, params?: JsonRecord): Promise<JsonRecord>;
}

export interface BuildKokoChatSessionKeyInput {
  miniAppId: MiniAppId | string;
  scope: string;
  agentId?: string;
}

export interface InferOnceInput {
  miniAppId: MiniAppId | string;
  prompt: string;
  agentId?: string;
  timeoutMs?: number;
  cleanup?: boolean;
  client?: OpenClawRpcClient;
}

export interface InferOnceResult {
  text: string;
  runId: string;
  sessionKey: string;
  status: AgentRunStatus;
  message: OpenClawHistoryMessage | null;
  cleanupError?: string;
}

export interface CreateAgentSessionInput {
  miniAppId: MiniAppId | string;
  scope: string;
  agentId?: string;
  label?: string;
  model?: string;
  initialMessage?: string;
  client?: OpenClawRpcClient;
}

export interface CreateAgentSessionResult {
  key: string;
  sessionId?: string;
  runStarted: boolean;
  runId?: string;
  entry?: JsonRecord;
}

export interface SendAgentMessageInput {
  sessionKey: string;
  message: string;
  idempotencyKey?: string;
  timeoutMs?: number;
  thinking?: string;
  client?: OpenClawRpcClient;
}

export interface SendAgentMessageResult {
  runId: string;
  status: string;
  messageSeq?: number;
}

export interface WaitForAgentRunInput {
  runId: string;
  timeoutMs?: number;
  client?: OpenClawRpcClient;
}

export interface AgentRunStatus {
  runId: string;
  status: string;
  startedAt?: number;
  endedAt?: number;
  error?: string;
  stopReason?: string;
  livenessState?: string;
  yielded?: boolean;
}

export interface ReadAgentHistoryInput {
  sessionKey: string;
  limit?: number;
  maxChars?: number;
  client?: OpenClawRpcClient;
}

export interface OpenClawHistoryMessage extends JsonRecord {
  role?: string;
  content?: unknown;
  text?: string;
}

export interface ReadAgentHistoryResult {
  sessionKey: string;
  sessionId?: string;
  messages: OpenClawHistoryMessage[];
  thinkingLevel?: string;
}

export interface DeleteAgentSessionInput {
  sessionKey: string;
  client?: OpenClawRpcClient;
}

export interface DeleteAgentSessionResult {
  ok: boolean;
  deleted?: boolean;
  archived?: unknown[];
}

export interface AbortAgentRunInput {
  sessionKey?: string;
  runId?: string;
  client?: OpenClawRpcClient;
}

export interface AbortAgentRunResult {
  ok: boolean;
  abortedRunId?: string | null;
  status?: string;
  aborted?: boolean;
  runIds?: unknown[];
}

export interface EnsureOpenClawAgentInput {
  agentId: string;
  name?: string;
  workspace?: string;
  client?: OpenClawRpcClient;
}

export interface EnsureOpenClawAgentResult {
  agentId: string;
  created: boolean;
}

export function buildKokoChatSessionKey({
  miniAppId,
  scope,
  agentId
}: BuildKokoChatSessionKeyInput): string {
  const resolvedAgentId = resolveMiniAppAgentId(miniAppId, agentId);
  const safeAgentId = normalizeSessionPart(resolvedAgentId, "main");
  const safeMiniAppId = normalizeSessionPart(miniAppId, "app");
  const safeScope = normalizeSessionScope(scope);
  return `agent:${safeAgentId}:kokochat:${safeMiniAppId}:${safeScope}`;
}

export async function inferOnce(input: InferOnceInput): Promise<InferOnceResult> {
  const prompt = input.prompt.trim();
  if (prompt.length === 0) {
    throw new Error("inferOnce prompt is empty");
  }

  const client = input.client ?? getConnectedGatewayClient();
  const sessionKey = buildKokoChatSessionKey({
    miniAppId: input.miniAppId,
    scope: `oneshot:${Date.now()}:${randomId()}`,
    ...(input.agentId !== undefined ? { agentId: input.agentId } : {})
  });
  const idempotencyKey = `koko-oneshot-${Date.now()}-${randomId()}`;
  let cleanupError: string | undefined;
  let result: InferOnceResult | undefined;

  try {
    const send = await client.call("chat.send", {
      sessionKey,
      message: prompt,
      idempotencyKey,
      timeoutMs: input.timeoutMs ?? DEFAULT_INFER_TIMEOUT_MS
    });
    const runId = requireString(send.runId, "chat.send did not return runId");

    const status = await waitForAgentRun({
      runId,
      timeoutMs: input.timeoutMs ?? DEFAULT_INFER_TIMEOUT_MS,
      client
    });
    if (status.status !== "ok") {
      throw new Error(status.error ?? `agent run ended with status=${status.status}`);
    }

    const history = await readAgentHistory({
      sessionKey,
      limit: DEFAULT_HISTORY_LIMIT,
      maxChars: DEFAULT_HISTORY_MAX_CHARS,
      client
    });
    const message = findLastAssistantMessage(history.messages);
    const text = message === null ? "" : extractMessageText(message).trim();
    result = {
      text,
      runId,
      sessionKey,
      status,
      message
    };
  } finally {
    if (input.cleanup !== false) {
      try {
        await deleteAgentSession({ sessionKey, client });
      } catch (error) {
        cleanupError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  if (result === undefined) {
    throw new Error("inferOnce did not produce a result");
  }
  return cleanupError === undefined ? result : { ...result, cleanupError };
}

export async function createAgentSession(
  input: CreateAgentSessionInput
): Promise<CreateAgentSessionResult> {
  const client = input.client ?? getConnectedGatewayClient();
  const key = buildKokoChatSessionKey({
    miniAppId: input.miniAppId,
    scope: input.scope,
    ...(input.agentId !== undefined ? { agentId: input.agentId } : {})
  });
  const payload = await client.call("sessions.create", {
    key,
    agentId: resolveMiniAppAgentId(input.miniAppId, input.agentId),
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.initialMessage !== undefined ? { message: input.initialMessage } : {})
  });

  return {
    key: requireString(payload.key, "sessions.create did not return key"),
    ...(typeof payload.sessionId === "string" ? { sessionId: payload.sessionId } : {}),
    runStarted: payload.runStarted === true,
    ...(typeof payload.runId === "string" ? { runId: payload.runId } : {}),
    ...(isRecord(payload.entry) ? { entry: payload.entry } : {})
  };
}

export async function sendAgentMessage(
  input: SendAgentMessageInput
): Promise<SendAgentMessageResult> {
  const message = input.message.trim();
  if (message.length === 0) {
    throw new Error("sendAgentMessage message is empty");
  }
  const client = input.client ?? getConnectedGatewayClient();
  const payload = await client.call("sessions.send", {
    key: input.sessionKey,
    message,
    idempotencyKey: input.idempotencyKey ?? `koko-agent-${Date.now()}-${randomId()}`,
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.thinking !== undefined ? { thinking: input.thinking } : {})
  });

  return {
    runId: requireString(payload.runId, "sessions.send did not return runId"),
    status: typeof payload.status === "string" ? payload.status : "unknown",
    ...(typeof payload.messageSeq === "number" ? { messageSeq: payload.messageSeq } : {})
  };
}

export async function waitForAgentRun(input: WaitForAgentRunInput): Promise<AgentRunStatus> {
  const client = input.client ?? getConnectedGatewayClient();
  const payload = await client.call("agent.wait", {
    runId: input.runId,
    timeoutMs: input.timeoutMs ?? DEFAULT_INFER_TIMEOUT_MS
  });
  return {
    runId: requireString(payload.runId, "agent.wait did not return runId"),
    status: typeof payload.status === "string" ? payload.status : "unknown",
    ...(typeof payload.startedAt === "number" ? { startedAt: payload.startedAt } : {}),
    ...(typeof payload.endedAt === "number" ? { endedAt: payload.endedAt } : {}),
    ...(typeof payload.error === "string" ? { error: payload.error } : {}),
    ...(typeof payload.stopReason === "string" ? { stopReason: payload.stopReason } : {}),
    ...(typeof payload.livenessState === "string" ? { livenessState: payload.livenessState } : {}),
    ...(typeof payload.yielded === "boolean" ? { yielded: payload.yielded } : {})
  };
}

export async function readAgentHistory(
  input: ReadAgentHistoryInput
): Promise<ReadAgentHistoryResult> {
  const client = input.client ?? getConnectedGatewayClient();
  const params = {
    sessionKey: input.sessionKey,
    limit: input.limit ?? DEFAULT_HISTORY_LIMIT,
    maxChars: input.maxChars ?? DEFAULT_HISTORY_MAX_CHARS
  };
  let payload: JsonRecord;
  try {
    payload = await client.call("chat.history", params);
  } catch (error) {
    if (!isUnsupportedHistoryMaxCharsError(error)) {
      throw error;
    }
    payload = await client.call("chat.history", {
      sessionKey: params.sessionKey,
      limit: params.limit
    });
  }
  return {
    sessionKey: typeof payload.sessionKey === "string" ? payload.sessionKey : input.sessionKey,
    ...(typeof payload.sessionId === "string" ? { sessionId: payload.sessionId } : {}),
    messages: Array.isArray(payload.messages)
      ? (payload.messages.filter(isRecord) as OpenClawHistoryMessage[])
      : [],
    ...(typeof payload.thinkingLevel === "string" ? { thinkingLevel: payload.thinkingLevel } : {})
  };
}

export async function deleteAgentSession(
  input: DeleteAgentSessionInput
): Promise<DeleteAgentSessionResult> {
  const client = input.client ?? getConnectedGatewayClient();
  const payload = await client.call("sessions.delete", { key: input.sessionKey });
  return {
    ok: payload.ok === true,
    ...(typeof payload.deleted === "boolean" ? { deleted: payload.deleted } : {}),
    ...(Array.isArray(payload.archived) ? { archived: payload.archived } : {})
  };
}

export async function abortAgentRun(input: AbortAgentRunInput): Promise<AbortAgentRunResult> {
  const client = input.client ?? getConnectedGatewayClient();
  const payload = await client.call("sessions.abort", {
    ...(input.sessionKey !== undefined ? { key: input.sessionKey } : {}),
    ...(input.runId !== undefined ? { runId: input.runId } : {})
  });
  return {
    ok: payload.ok === true,
    ...(typeof payload.abortedRunId === "string" || payload.abortedRunId === null
      ? { abortedRunId: payload.abortedRunId }
      : {}),
    ...(typeof payload.status === "string" ? { status: payload.status } : {}),
    ...(typeof payload.aborted === "boolean" ? { aborted: payload.aborted } : {}),
    ...(Array.isArray(payload.runIds) ? { runIds: payload.runIds } : {})
  };
}

export async function ensureOpenClawAgent(
  input: EnsureOpenClawAgentInput
): Promise<EnsureOpenClawAgentResult> {
  const agentId = normalizeSessionPart(input.agentId, "main");
  const client = input.client ?? getConnectedGatewayClient();
  const listed = await client.call("agents.list", {});
  const agents = Array.isArray(listed.agents) ? listed.agents : [];
  const exists = agents.some((agent) => isRecord(agent) && agent.id === agentId);
  if (exists) return { agentId, created: false };

  await client.call("agents.create", {
    name: input.name ?? agentId,
    workspace: input.workspace ?? `~/.openclaw/agents/${agentId}/workspace`
  });
  return { agentId, created: true };
}

export function extractMessageText(message: OpenClawHistoryMessage): string {
  if (typeof message.text === "string") return message.text;
  const content = message.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!isRecord(part)) return "";
      if (part.type !== "text") return "";
      return typeof part.text === "string" ? part.text : "";
    })
    .join("");
}

export function findLastAssistantMessage(
  messages: OpenClawHistoryMessage[]
): OpenClawHistoryMessage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === "assistant" || message?.role === "agent") return message;
  }
  return null;
}

function getConnectedGatewayClient(): BrowserGatewayClient {
  const { client } = useGatewayStore.getState();
  if (client === null) throw new Error("OpenClaw Gateway is not connected");
  return client;
}

function requireString(value: unknown, message: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(message);
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUnsupportedHistoryMaxCharsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /maxChars/i.test(message) &&
    /(unexpected|unknown|unrecognized|unsupported|invalid)/i.test(message)
  );
}

function normalizeSessionPart(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeSessionScope(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || randomId();
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}
