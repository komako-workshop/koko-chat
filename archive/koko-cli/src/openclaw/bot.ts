import { randomUUID } from "node:crypto";
import { PROTOCOL_VERSION, symmetricDecrypt, symmetricEncrypt, type Envelope } from "@koko/protocol";
import type { GatewayClient } from "@koko/openclaw-client";
import type { Logger } from "pino";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

/** Minimal GatewayClient surface the OpenClaw bot needs. */
export type OpenClawGatewayClient = Pick<GatewayClient, "call" | "on">;

/** Payload encrypted into outgoing agent envelopes for the APP. */
export interface OpenClawEnvelopePayload {
  /** Raw OpenClaw message object forwarded without text extraction. */
  openclawMessage?: unknown;
  /** OpenClaw run id for this turn. */
  runId?: string;
  /** Human-readable error text for `chat.agent.error` envelopes. */
  errorMessage?: string;
}

/** Options accepted by the OpenClaw-backed bot. */
export interface OpenClawBotOptions {
  /** Relay room ID to bind outgoing envelopes to. */
  roomId: string;
  /** 32-byte XChaCha20 key used to encrypt APP envelopes. */
  sessionKey: Uint8Array;
  /** Connected OpenClaw Gateway client. */
  gatewayClient: OpenClawGatewayClient;
  /** Gateway session key, normally `agent:main:main`. */
  openclawSessionKey: string;
  /** Structured logger scoped to OpenClaw. */
  logger: Logger;
}

/** OpenClaw-backed bot that turns APP chat.user envelopes into Gateway chat calls. */
export interface OpenClawBot {
  /** Handles one APP envelope and forwards resulting OpenClaw stream events through `onOutgoingEnvelope`. */
  handle(envelope: Envelope, onOutgoingEnvelope: (envelope: Envelope) => void): Promise<void>;
  /** Returns the currently active OpenClaw run id, if any. */
  getActiveRunId(): string | null;
  /** Aborts the active OpenClaw run, if any. */
  abort(): Promise<void>;
  /** Removes the long-lived Gateway event subscription. */
  close(): void;
}

type ChatSendAck = {
  runId?: unknown;
};

function base64Encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function base64Decode(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "base64"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseIncomingText(plaintext: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext) as unknown;
  } catch {
    // Plain UTF-8 text payload (no JSON envelope). Accept it directly as the
    // user's message body so simple APP clients don't have to JSON.stringify.
    const trimmed = plaintext.trim();
    return trimmed.length === 0 ? null : plaintext;
  }

  if (typeof parsed === "string") {
    return parsed;
  }
  if (!isRecord(parsed)) {
    return null;
  }

  const text = parsed.text;
  if (typeof text === "string") {
    return text;
  }
  const message = parsed.message;
  return typeof message === "string" ? message : null;
}

function eventErrorMessage(event: Record<string, unknown>): string {
  if (typeof event.errorMessage === "string") {
    return event.errorMessage;
  }
  if (typeof event.message === "string") {
    return event.message;
  }
  if (typeof event.error === "string") {
    return event.error;
  }
  if (isRecord(event.error) && typeof event.error.message === "string") {
    return event.error.message;
  }
  return "OpenClaw chat error";
}

function outgoingPayloadFor(event: Record<string, unknown>, runId: string, state: string): OpenClawEnvelopePayload {
  const payload: OpenClawEnvelopePayload = { runId };
  if (event.message !== undefined) {
    payload.openclawMessage = event.message;
  }
  if (state === "error") {
    payload.errorMessage = eventErrorMessage(event);
  }
  return payload;
}

/** Creates an OpenClaw-backed bot for encrypted APP chat envelopes. */
export function createOpenClawBot(options: OpenClawBotOptions): OpenClawBot {
  let activeRunId: string | null = null;
  let nextSeq = 1;
  let outgoingHandler: ((envelope: Envelope) => void) | null = null;
  let closed = false;

  const emitEnvelope = (type: string, payload: OpenClawEnvelopePayload): void => {
    if (outgoingHandler === null) {
      return;
    }
    const encrypted = symmetricEncrypt(textEncoder.encode(JSON.stringify(payload)), options.sessionKey);
    const envelope: Envelope = {
      v: PROTOCOL_VERSION,
      type,
      roomId: options.roomId,
      seq: nextSeq,
      ts: Date.now(),
      payload: base64Encode(encrypted),
      encrypted: true
    };
    nextSeq += 1;
    outgoingHandler(envelope);
  };

  const unsubscribe = options.gatewayClient.on("chat", (event) => {
    if (closed || event.sessionKey !== options.openclawSessionKey) {
      return;
    }
    const runId = activeRunId;
    if (runId === null || event.runId !== runId || typeof event.state !== "string") {
      return;
    }

    try {
      if (event.state === "delta") {
        emitEnvelope("chat.agent.delta", outgoingPayloadFor(event, runId, "delta"));
        return;
      }
      if (event.state === "final") {
        emitEnvelope("chat.agent.final", outgoingPayloadFor(event, runId, "final"));
        activeRunId = null;
        return;
      }
      if (event.state === "error") {
        emitEnvelope("chat.agent.error", outgoingPayloadFor(event, runId, "error"));
        activeRunId = null;
      }
    } catch (error) {
      options.logger.warn(error instanceof Error ? error : { error }, "failed to forward OpenClaw chat event");
    }
  });

  const bot: OpenClawBot = {
    async handle(envelope, onOutgoingEnvelope): Promise<void> {
      outgoingHandler = onOutgoingEnvelope;
      if (envelope.encrypted !== true || !envelope.type.startsWith("chat.user")) {
        options.logger.warn({ type: envelope.type, encrypted: envelope.encrypted }, "ignoring non-user encrypted chat envelope");
        return;
      }
      if (typeof envelope.payload !== "string") {
        options.logger.warn({ type: envelope.type }, "ignoring encrypted envelope with non-string payload");
        return;
      }

      let text: string | null;
      try {
        const plaintext = textDecoder.decode(symmetricDecrypt(base64Decode(envelope.payload), options.sessionKey));
        text = parseIncomingText(plaintext);
      } catch (error) {
        options.logger.warn(error instanceof Error ? error : { error }, "failed to decrypt OpenClaw input envelope");
        return;
      }
      if (text === null) {
        options.logger.warn({ type: envelope.type }, "ignoring OpenClaw input envelope with unsupported payload JSON");
        return;
      }

      if (activeRunId !== null) {
        await bot.abort();
      }

      const ack = await options.gatewayClient.call("chat.send", {
        sessionKey: options.openclawSessionKey,
        message: text,
        idempotencyKey: randomUUID()
      }) as ChatSendAck;
      if (typeof ack.runId !== "string") {
        options.logger.warn({ ack }, "OpenClaw chat.send response missing runId");
        return;
      }
      activeRunId = ack.runId;
    },

    getActiveRunId(): string | null {
      return activeRunId;
    },

    async abort(): Promise<void> {
      const runId = activeRunId;
      if (runId === null) {
        return;
      }
      activeRunId = null;
      try {
        await options.gatewayClient.call("chat.abort", { sessionKey: options.openclawSessionKey });
      } catch (error) {
        options.logger.warn(error instanceof Error ? error : { error, runId }, "failed to abort OpenClaw chat run");
      }
    },

    close(): void {
      if (closed) {
        return;
      }
      closed = true;
      unsubscribe();
    }
  };

  return bot;
}
