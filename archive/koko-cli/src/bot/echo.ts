import { symmetricDecrypt, symmetricEncrypt, PROTOCOL_VERSION, type Envelope } from "@koko/protocol";
import type { Logger } from "pino";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

/** Options accepted by the echo bot. */
export interface EchoBotOptions {
  /** Relay room ID to bind outgoing envelopes to. */
  roomId: string;
  /** 32-byte XChaCha20 key used for Task 03b encrypted echo payloads. */
  sessionKey: Uint8Array;
  /** Optional logger for decrypt failures. */
  logger?: Logger;
}

/** Minimal encrypted echo bot. */
export interface EchoBot {
  /** Handle one incoming envelope and return an echo envelope, or null to ignore. */
  handle(envelope: Envelope, seq: number): Envelope | null;
}

function base64Encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function base64Decode(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "base64"));
}

/** Creates a bot that replies to encrypted chat.user* envelopes with ECHO text. */
export function createEchoBot(options: EchoBotOptions): EchoBot {
  return {
    handle(envelope: Envelope, seq: number): Envelope | null {
      if (envelope.encrypted !== true || !envelope.type.startsWith("chat.user")) {
        return null;
      }
      if (typeof envelope.payload !== "string") {
        options.logger?.warn({ type: envelope.type }, "ignoring encrypted envelope with non-string payload");
        return null;
      }

      try {
        const plaintext = symmetricDecrypt(base64Decode(envelope.payload), options.sessionKey);
        const responseText = `ECHO: ${textDecoder.decode(plaintext)}`;
        const encryptedResponse = symmetricEncrypt(textEncoder.encode(responseText), options.sessionKey);
        return {
          v: PROTOCOL_VERSION,
          type: "chat.agent.final",
          roomId: options.roomId,
          seq,
          ts: Date.now(),
          payload: base64Encode(encryptedResponse),
          encrypted: true
        };
      } catch (error) {
        options.logger?.warn(error instanceof Error ? error : { error }, "failed to decrypt echo input envelope");
        return null;
      }
    }
  };
}
