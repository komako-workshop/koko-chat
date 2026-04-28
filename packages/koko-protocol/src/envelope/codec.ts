import { Envelope, EnvelopeSchema } from "./types";

const textDecoder = new TextDecoder();

/** Encodes an envelope as validated JSON. */
export function encodeEnvelope(env: Envelope): string {
  return JSON.stringify(EnvelopeSchema.parse(env));
}

/** Decodes an envelope from JSON bytes or string and validates it with zod. */
export function decodeEnvelope(raw: string | Uint8Array): Envelope {
  const json = typeof raw === "string" ? raw : textDecoder.decode(raw);
  return EnvelopeSchema.parse(JSON.parse(json));
}
