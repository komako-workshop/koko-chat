import { describe, expect, it } from "vitest";
import { decodeEnvelope, encodeEnvelope, type Envelope } from "../src/envelope";

const validEnvelope: Envelope = {
  v: 1,
  type: "chat.user",
  roomId: "room-1",
  seq: 1,
  ts: 1_777_399_200_000,
  payload: { text: "hello" },
  encrypted: false
};

describe("envelope codec", () => {
  it("round-trips a complete envelope", () => {
    expect(decodeEnvelope(encodeEnvelope(validEnvelope))).toEqual(validEnvelope);
  });

  it("throws when v is not 1", () => {
    const raw = JSON.stringify({ ...validEnvelope, v: 2 });

    expect(() => decodeEnvelope(raw)).toThrow();
  });

  it("throws when seq is not a number", () => {
    const raw = JSON.stringify({ ...validEnvelope, seq: "1" });

    expect(() => decodeEnvelope(raw)).toThrow();
  });

  it("throws when type is not a string", () => {
    const raw = JSON.stringify({ ...validEnvelope, type: 42 });

    expect(() => decodeEnvelope(raw)).toThrow();
  });

  it("strips extra fields from decoded envelopes", () => {
    const raw = JSON.stringify({ ...validEnvelope, extra: "removed" });
    const decoded = decodeEnvelope(raw);

    expect(decoded).toEqual(validEnvelope);
    expect("extra" in decoded).toBe(false);
  });

  it("decodes envelopes from Uint8Array JSON", () => {
    const raw = new TextEncoder().encode(encodeEnvelope(validEnvelope));

    expect(decodeEnvelope(raw)).toEqual(validEnvelope);
  });
});
