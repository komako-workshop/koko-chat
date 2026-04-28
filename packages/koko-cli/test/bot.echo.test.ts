import { beforeAll, describe, expect, it } from "vitest";
import {
  initCrypto,
  symmetricDecrypt,
  symmetricEncrypt,
  PROTOCOL_VERSION,
  type Envelope
} from "@koko/protocol";
import { createEchoBot } from "../src/bot";
import { PLACEHOLDER_SESSION_KEY } from "../src/start";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function base64Encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function base64Decode(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "base64"));
}

function encryptedUserEnvelope(text: string, key: Uint8Array = PLACEHOLDER_SESSION_KEY): Envelope {
  return {
    v: PROTOCOL_VERSION,
    type: "chat.user",
    roomId: "room-1",
    seq: 1,
    ts: Date.now(),
    payload: base64Encode(symmetricEncrypt(textEncoder.encode(text), key)),
    encrypted: true
  };
}

function decryptPayload(envelope: Envelope): string {
  if (typeof envelope.payload !== "string") {
    throw new Error("expected string payload");
  }
  return textDecoder.decode(symmetricDecrypt(base64Decode(envelope.payload), PLACEHOLDER_SESSION_KEY));
}

describe("echo bot", () => {
  beforeAll(async () => {
    await initCrypto();
  });

  it("decrypts a chat.user envelope and returns encrypted ECHO text with the caller seq", () => {
    const bot = createEchoBot({ roomId: "room-1", sessionKey: PLACEHOLDER_SESSION_KEY });
    const response = bot.handle(encryptedUserEnvelope("hello"), 5);

    expect(response).not.toBeNull();
    expect(response?.seq).toBe(5);
    expect(response?.type).toBe("chat.agent.final");
    expect(response?.encrypted).toBe(true);
    expect(decryptPayload(response as Envelope)).toBe("ECHO: hello");
  });

  it("ignores unencrypted envelopes", () => {
    const bot = createEchoBot({ roomId: "room-1", sessionKey: PLACEHOLDER_SESSION_KEY });
    const response = bot.handle({
      v: PROTOCOL_VERSION,
      type: "chat.user",
      roomId: "room-1",
      seq: 1,
      ts: Date.now(),
      payload: "hello",
      encrypted: false
    }, 2);

    expect(response).toBeNull();
  });

  it("ignores non-chat.user envelope types", () => {
    const bot = createEchoBot({ roomId: "room-1", sessionKey: PLACEHOLDER_SESSION_KEY });
    const envelope = encryptedUserEnvelope("hello");
    const response = bot.handle({ ...envelope, type: "chat.agent.final" }, 2);

    expect(response).toBeNull();
  });

  it("returns null instead of throwing when decryption fails", () => {
    const bot = createEchoBot({ roomId: "room-1", sessionKey: PLACEHOLDER_SESSION_KEY });
    const wrongKey = new Uint8Array(32).fill(7);
    const response = bot.handle(encryptedUserEnvelope("hello", wrongKey), 2);

    expect(response).toBeNull();
  });

  it("preserves Chinese text and emoji", () => {
    const bot = createEchoBot({ roomId: "room-1", sessionKey: PLACEHOLDER_SESSION_KEY });
    const response = bot.handle(encryptedUserEnvelope("你好 OpenClaw 🦞"), 8);

    expect(response).not.toBeNull();
    expect(decryptPayload(response as Envelope)).toBe("ECHO: 你好 OpenClaw 🦞");
  });
});
