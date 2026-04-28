import { GatewayError } from "./errors";

/** JSON object payload used by Gateway frames. */
export type JsonRecord = Record<string, unknown>;

/** Client to Gateway request frame. */
export interface RequestFrame {
  /** Frame discriminator. */
  type: "req";
  /** Client-generated correlation id. */
  id: string;
  /** RPC method name. */
  method: string;
  /** Optional request params. */
  params?: JsonRecord;
}

/** Gateway to client response frame. */
export interface ResponseFrame {
  /** Frame discriminator. */
  type: "res";
  /** Correlation id copied from the request. */
  id: string;
  /** True when the request succeeded. */
  ok: boolean;
  /** Response payload when `ok` is true. */
  payload?: JsonRecord;
  /** Error payload when `ok` is false. */
  error?: {
    /** Gateway error code. */
    code: string;
    /** Human-readable Gateway error message. */
    message: string;
  };
}

/** Gateway to client event frame. */
export interface EventFrame {
  /** Frame discriminator. */
  type: "event";
  /** Event name. */
  event: string;
  /** Event payload. */
  payload: JsonRecord;
}

/** Any supported Gateway wire frame. */
export type Frame = RequestFrame | ResponseFrame | EventFrame;

/** Returns true when a value is a non-array object. */
export function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Returns true when a value is a valid request frame. */
export function isRequestFrame(value: unknown): value is RequestFrame {
  if (!isRecord(value) || value.type !== "req" || typeof value.id !== "string" || typeof value.method !== "string") {
    return false;
  }
  return value.params === undefined || isRecord(value.params);
}

/** Returns true when a value is a valid response frame. */
export function isResponseFrame(value: unknown): value is ResponseFrame {
  if (!isRecord(value) || value.type !== "res" || typeof value.id !== "string" || typeof value.ok !== "boolean") {
    return false;
  }
  if (value.payload !== undefined && !isRecord(value.payload)) {
    return false;
  }
  if (value.error === undefined) {
    return true;
  }
  return isRecord(value.error) && typeof value.error.code === "string" && typeof value.error.message === "string";
}

/** Returns true when a value is a valid event frame. */
export function isEventFrame(value: unknown): value is EventFrame {
  return (
    isRecord(value) &&
    value.type === "event" &&
    typeof value.event === "string" &&
    isRecord(value.payload)
  );
}

/** Returns true when a value is a supported Gateway frame. */
export function isFrame(value: unknown): value is Frame {
  return isRequestFrame(value) || isResponseFrame(value) || isEventFrame(value);
}

/** Parses and validates a JSON text frame. */
export function parseFrameText(text: string): Frame {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GatewayError("INVALID_JSON", "Gateway frame must be valid JSON");
  }

  if (!isFrame(parsed)) {
    throw new GatewayError("INVALID_FRAME", "Gateway frame has an invalid shape");
  }
  return parsed;
}

/** Serializes a request frame as JSON text. */
export function serializeRequestFrame(frame: RequestFrame): string {
  return JSON.stringify(frame);
}
