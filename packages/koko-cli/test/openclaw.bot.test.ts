import { beforeAll, describe, expect, it } from "vitest";
import {
  initCrypto,
  PROTOCOL_VERSION,
  symmetricDecrypt,
  symmetricEncrypt,
  type Envelope
} from "@koko/protocol";
import { createLogger } from "../src/logger";
import {
  createOpenClawBot,
  type OpenClawEnvelopePayload,
  type OpenClawGatewayClient
} from "../src/openclaw";
import { PLACEHOLDER_SESSION_KEY } from "../src/start";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const OPENCLAW_SESSION_KEY = "agent:main:main";

interface GatewayCall {
  method: string;
  params?: Record<string, unknown>;
}

class FakeGatewayClient implements OpenClawGatewayClient {
  readonly calls: GatewayCall[] = [];
  private readonly callbacks = new Map<string, Set<(payload: Record<string, unknown>) => void>>();
  private nextRunNumber = 1;

  call(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.calls.push(params === undefined ? { method } : { method, params });
    if (method === "chat.send") {
      const runId = `run-${this.nextRunNumber}`;
      this.nextRunNumber += 1;
      return Promise.resolve({ runId });
    }
    return Promise.resolve({});
  }

  on(event: string, callback: (payload: Record<string, unknown>) => void): () => void {
    const callbacks = this.callbacks.get(event) ?? new Set<(payload: Record<string, unknown>) => void>();
    callbacks.add(callback);
    this.callbacks.set(event, callbacks);
    return () => {
      callbacks.delete(callback);
    };
  }

  emitChat(payload: Record<string, unknown>): void {
    const callbacks = this.callbacks.get("chat") ?? new Set<(payload: Record<string, unknown>) => void>();
    for (const callback of callbacks) {
      callback(payload);
    }
  }
}

function base64Encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function base64Decode(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "base64"));
}

function encryptedUserEnvelope(payload: unknown, encrypted = true, type = "chat.user"): Envelope {
  const encoded = symmetricEncrypt(textEncoder.encode(JSON.stringify(payload)), PLACEHOLDER_SESSION_KEY);
  return {
    v: PROTOCOL_VERSION,
    type,
    roomId: "room-1",
    seq: 1,
    ts: Date.now(),
    payload: base64Encode(encoded),
    encrypted
  };
}

function decryptOutgoing(envelope: Envelope): OpenClawEnvelopePayload {
  if (typeof envelope.payload !== "string") {
    throw new Error("expected encrypted string payload");
  }
  const decrypted = textDecoder.decode(symmetricDecrypt(base64Decode(envelope.payload), PLACEHOLDER_SESSION_KEY));
  const parsed: unknown = JSON.parse(decrypted);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("expected payload object");
  }
  return parsed as OpenClawEnvelopePayload;
}

function createFixture(): { gateway: FakeGatewayClient; outgoing: Envelope[]; bot: ReturnType<typeof createOpenClawBot> } {
  const gateway = new FakeGatewayClient();
  const outgoing: Envelope[] = [];
  const bot = createOpenClawBot({
    roomId: "room-1",
    sessionKey: PLACEHOLDER_SESSION_KEY,
    gatewayClient: gateway,
    openclawSessionKey: OPENCLAW_SESSION_KEY,
    logger: createLogger({ level: "error", enabled: false })
  });
  return { gateway, outgoing, bot };
}

describe("OpenClaw bot", () => {
  beforeAll(async () => {
    await initCrypto();
  });

  it("turns a chat.user envelope into chat.send with the configured session key", async () => {
    const { gateway, outgoing, bot } = createFixture();

    await bot.handle(encryptedUserEnvelope({ text: "hello" }), (envelope) => outgoing.push(envelope));

    expect(gateway.calls).toHaveLength(1);
    expect(gateway.calls[0]?.method).toBe("chat.send");
    expect(gateway.calls[0]?.params).toMatchObject({
      sessionKey: OPENCLAW_SESSION_KEY,
      message: "hello"
    });
    expect(gateway.calls[0]?.params?.idempotencyKey).toEqual(expect.any(String));
    expect(bot.getActiveRunId()).toBe("run-1");
    expect(outgoing).toHaveLength(0);
  });

  it("forwards delta and final chat events as encrypted monotonic envelopes", async () => {
    const { gateway, outgoing, bot } = createFixture();
    await bot.handle(encryptedUserEnvelope({ message: "hello" }), (envelope) => outgoing.push(envelope));

    gateway.emitChat({
      sessionKey: OPENCLAW_SESSION_KEY,
      runId: "run-1",
      state: "delta",
      message: { content: [{ type: "text", text: "hel" }] }
    });
    gateway.emitChat({
      sessionKey: OPENCLAW_SESSION_KEY,
      runId: "run-1",
      state: "final",
      message: { content: [{ type: "text", text: "hello" }] }
    });

    expect(outgoing.map((envelope) => envelope.type)).toEqual(["chat.agent.delta", "chat.agent.final"]);
    expect(outgoing.map((envelope) => envelope.seq)).toEqual([1, 2]);
    expect(decryptOutgoing(outgoing[0] as Envelope)).toEqual({
      runId: "run-1",
      openclawMessage: { content: [{ type: "text", text: "hel" }] }
    });
    expect(decryptOutgoing(outgoing[1] as Envelope)).toEqual({
      runId: "run-1",
      openclawMessage: { content: [{ type: "text", text: "hello" }] }
    });
    expect(bot.getActiveRunId()).toBeNull();
  });

  it("forwards error chat events with errorMessage and clears the active run", async () => {
    const { gateway, outgoing, bot } = createFixture();
    await bot.handle(encryptedUserEnvelope("hello"), (envelope) => outgoing.push(envelope));

    gateway.emitChat({
      sessionKey: OPENCLAW_SESSION_KEY,
      runId: "run-1",
      state: "error",
      errorMessage: "model failed"
    });

    expect(outgoing).toHaveLength(1);
    expect(outgoing[0]?.type).toBe("chat.agent.error");
    expect(decryptOutgoing(outgoing[0] as Envelope)).toEqual({
      runId: "run-1",
      errorMessage: "model failed"
    });
    expect(bot.getActiveRunId()).toBeNull();
  });

  it("aborts the active run before sending a second chat.user message", async () => {
    const { gateway, outgoing, bot } = createFixture();

    await bot.handle(encryptedUserEnvelope({ text: "first" }), (envelope) => outgoing.push(envelope));
    await bot.handle(encryptedUserEnvelope({ text: "second" }), (envelope) => outgoing.push(envelope));

    expect(gateway.calls.map((call) => call.method)).toEqual(["chat.send", "chat.abort", "chat.send"]);
    expect(gateway.calls[1]?.params).toEqual({ sessionKey: OPENCLAW_SESSION_KEY });
    expect(gateway.calls[2]?.params).toMatchObject({
      sessionKey: OPENCLAW_SESSION_KEY,
      message: "second"
    });
    expect(bot.getActiveRunId()).toBe("run-2");
  });

  it("ignores unencrypted or non-user envelopes without calling Gateway", async () => {
    const { gateway, outgoing, bot } = createFixture();

    await bot.handle(encryptedUserEnvelope({ text: "hello" }, false), (envelope) => outgoing.push(envelope));
    await bot.handle(encryptedUserEnvelope({ text: "hello" }, true, "chat.agent.final"), (envelope) => outgoing.push(envelope));

    expect(gateway.calls).toHaveLength(0);
    expect(outgoing).toHaveLength(0);
  });
});
