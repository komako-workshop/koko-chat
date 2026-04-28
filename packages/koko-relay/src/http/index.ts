import type { IncomingMessage, ServerResponse } from "node:http";

/** HTTP request with a parsed WHATWG URL. */
export interface HttpRequestContext {
  /** Node incoming HTTP request. */
  req: IncomingMessage;
  /** Node HTTP response. */
  res: ServerResponse;
  /** Parsed request URL. */
  url: URL;
}

/** Error raised when an HTTP JSON request cannot be parsed. */
export class HttpBodyError extends Error {
  /** Stable error code returned to clients. */
  readonly code: "invalid_json" | "body_too_large";

  constructor(code: "invalid_json" | "body_too_large", message: string) {
    super(message);
    this.name = "HttpBodyError";
    this.code = code;
  }
}

/** Sends a JSON response with status and content headers. */
export function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", Buffer.byteLength(payload));
  res.end(payload);
}

/** Reads and parses a JSON request body with a small safety limit. */
export async function readJsonBody(req: IncomingMessage, limitBytes = 64 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  await new Promise<void>((resolve, reject) => {
    req.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > limitBytes) {
        reject(new HttpBodyError("body_too_large", "request body is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve());
    req.on("error", reject);
  });

  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text.length === 0 ? {} : JSON.parse(text);
  } catch {
    throw new HttpBodyError("invalid_json", "request body must be valid JSON");
  }
}

/** Sends a method/path not found response. */
export function sendNotFound(res: ServerResponse): void {
  sendJson(res, 404, { error: "not_found", message: "route not found" });
}
