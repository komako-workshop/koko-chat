import { describe, expect, it } from "vitest";
import { parseFrameText, type Frame } from "../src/frames";
import { GatewayError } from "../src/errors";

function describeFrame(frame: Frame): string {
  switch (frame.type) {
    case "req":
      return `req:${frame.method}:${frame.id}`;
    case "res":
      return `res:${frame.ok}:${frame.id}`;
    case "event":
      return `event:${frame.event}`;
  }
}

describe("Gateway frames", () => {
  it("narrows request, response, and event frames", () => {
    expect(describeFrame({ type: "req", id: "pd-1", method: "chat.send", params: { x: 1 } })).toBe(
      "req:chat.send:pd-1"
    );
    expect(describeFrame({ type: "res", id: "pd-1", ok: true, payload: { y: 2 } })).toBe("res:true:pd-1");
    expect(describeFrame({ type: "event", event: "chat", payload: { delta: "hi" } })).toBe("event:chat");
  });

  it("parses valid JSON text frames", () => {
    expect(parseFrameText(JSON.stringify({ type: "event", event: "tick", payload: {} }))).toEqual({
      type: "event",
      event: "tick",
      payload: {}
    });
  });

  it("rejects malformed JSON and invalid frame shapes", () => {
    expect(() => parseFrameText("{")).toThrow(GatewayError);
    expect(() => parseFrameText(JSON.stringify({ type: "event", event: "chat" }))).toThrow(GatewayError);
    expect(() => parseFrameText(JSON.stringify({ type: "res", id: "pd-1", ok: "yes" }))).toThrow(GatewayError);
  });
});
