import { randomUUID } from "node:crypto";
import { PROTOCOL_VERSION } from "@koko/protocol";
import { HttpBodyError, readJsonBody, sendJson, type HttpRequestContext } from "../http";
import type { pino } from "../logger";
import type { RoomStore } from "../room/store";
import { DeletePairRequestBodySchema, PairRequestBodySchema, PairResponseBodySchema, PublicKeySchema } from "./types";
import type { PairingStore } from "./store";

/** Dependencies required by pairing HTTP routes. */
export interface PairingRoutesOptions {
  /** Pairing request store. */
  pairingStore: PairingStore;
  /** Room store that receives newly authorized rooms. */
  roomStore: RoomStore;
  /** Structured logger. */
  logger: pino.Logger;
}

/** Handles pairing HTTP endpoints. */
export interface PairingRoutes {
  /** Handles a request if it matches a pairing route. */
  handle(ctx: HttpRequestContext): Promise<boolean>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function validationErrorForPairRequest(body: Record<string, unknown>): { error: string; message: string } | null {
  if (!PublicKeySchema.safeParse(body.publicKey).success) {
    return { error: "invalid_public_key", message: "publicKey must be base64url encoded 32 bytes" };
  }
  if (body.supportsProtocol !== PROTOCOL_VERSION) {
    return { error: "unsupported_protocol", message: `supportsProtocol must be ${PROTOCOL_VERSION}` };
  }
  return null;
}

function validationErrorForPairResponse(body: Record<string, unknown>): { error: string; message: string } | null {
  if (!PublicKeySchema.safeParse(body.publicKey).success) {
    return { error: "invalid_public_key", message: "publicKey must be base64url encoded 32 bytes" };
  }
  if (typeof body.response !== "string" || body.response.length === 0) {
    return { error: "invalid_response", message: "response must be a non-empty string" };
  }
  return null;
}

async function readBody(ctx: HttpRequestContext, logger: pino.Logger): Promise<unknown | null> {
  try {
    return await readJsonBody(ctx.req);
  } catch (error) {
    if (error instanceof HttpBodyError) {
      sendJson(ctx.res, error.code === "body_too_large" ? 413 : 400, {
        error: error.code,
        message: error.message
      });
      return null;
    }
    logger.warn(error instanceof Error ? error : { error }, "failed to read request body");
    sendJson(ctx.res, 400, { error: "invalid_json", message: "request body must be valid JSON" });
    return null;
  }
}

/** Creates handlers for all pairing HTTP routes. */
export function createPairingRoutes(options: PairingRoutesOptions): PairingRoutes {
  const logger = options.logger.child({ module: "pairing.routes" });

  return {
    async handle(ctx: HttpRequestContext): Promise<boolean> {
      if (ctx.url.pathname === "/v1/pair/request" && ctx.req.method === "POST") {
        const body = await readBody(ctx, logger);
        if (body === null) {
          return true;
        }
        const record = asRecord(body);
        const validationError = validationErrorForPairRequest(record);
        if (validationError !== null) {
          sendJson(ctx.res, 400, validationError);
          return true;
        }
        const parsed = PairRequestBodySchema.parse(record);
        const entry = options.pairingStore.getOrCreate(parsed.publicKey);
        const ttlMs = Math.max(0, entry.expiresAt - Date.now());
        if (entry.response !== undefined && entry.roomId !== undefined) {
          sendJson(ctx.res, 200, {
            state: "authorized",
            roomId: entry.roomId,
            response: entry.response,
            ttlMs
          });
          return true;
        }
        sendJson(ctx.res, 200, {
          state: "pending",
          ttlMs
        });
        return true;
      }

      if (ctx.url.pathname === "/v1/pair/response" && ctx.req.method === "POST") {
        const body = await readBody(ctx, logger);
        if (body === null) {
          return true;
        }
        const record = asRecord(body);
        const validationError = validationErrorForPairResponse(record);
        if (validationError !== null) {
          sendJson(ctx.res, 400, validationError);
          return true;
        }
        const parsed = PairResponseBodySchema.parse(record);
        const roomId = randomUUID();
        const result = options.pairingStore.authorize(parsed.publicKey, parsed.response, roomId);
        if (!result.ok) {
          const statusCode = result.error === "request_not_found" ? 404 : 409;
          sendJson(ctx.res, statusCode, { error: result.error });
          return true;
        }
        options.roomStore.createRoom(roomId);
        sendJson(ctx.res, 200, { roomId });
        return true;
      }

      if (ctx.url.pathname === "/v1/pair/request" && ctx.req.method === "DELETE") {
        const body = await readBody(ctx, logger);
        if (body !== null) {
          const parsed = DeletePairRequestBodySchema.safeParse(asRecord(body));
          if (parsed.success) {
            options.pairingStore.delete(parsed.data.publicKey);
          }
        }
        sendJson(ctx.res, 200, { ok: true });
        return true;
      }

      return false;
    }
  };
}
