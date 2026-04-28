import { randomUUID } from "node:crypto";
import { PROTOCOL_VERSION } from "@koko/protocol";
import type { Logger } from "pino";
import type { RelayFastifyInstance } from "../http";
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
  logger: Logger;
}

type PairRequestBody = {
  publicKey?: unknown;
  supportsProtocol?: unknown;
};

type PairResponseBody = {
  publicKey?: unknown;
  response?: unknown;
};

type DeletePairRequestBody = {
  publicKey?: unknown;
};

const publicKeyBodySchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    publicKey: { type: "string" }
  }
} as const;

const pairRequestBodySchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    publicKey: { type: "string" },
    supportsProtocol: { type: "number" }
  }
} as const;

const pairResponseBodySchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    publicKey: { type: "string" },
    response: { type: "string" }
  }
} as const;

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

/** Registers all pairing HTTP endpoints. */
export function registerPairingRoutes(app: RelayFastifyInstance, options: PairingRoutesOptions): void {
  const logger = options.logger.child({ module: "pairing.routes" });

  app.post<{ Body: PairRequestBody }>(
    "/v1/pair/request",
    {
      attachValidation: true,
      schema: {
        body: pairRequestBodySchema
      }
    },
    async (request, reply) => {
      if (request.validationError !== undefined) {
        logger.debug({ err: request.validationError }, "pair request schema validation failed");
      }
      const record = asRecord(request.body);
      const validationError = validationErrorForPairRequest(record);
      if (validationError !== null) {
        return reply.status(400).send(validationError);
      }
      const parsed = PairRequestBodySchema.parse(record);
      const entry = options.pairingStore.getOrCreate(parsed.publicKey);
      const ttlMs = Math.max(0, entry.expiresAt - Date.now());
      if (entry.response !== undefined && entry.roomId !== undefined) {
        return reply.status(200).send({
          state: "authorized",
          roomId: entry.roomId,
          response: entry.response,
          ttlMs
        });
      }
      return reply.status(200).send({
        state: "pending",
        ttlMs
      });
    }
  );

  app.post<{ Body: PairResponseBody }>(
    "/v1/pair/response",
    {
      attachValidation: true,
      schema: {
        body: pairResponseBodySchema
      }
    },
    async (request, reply) => {
      if (request.validationError !== undefined) {
        logger.debug({ err: request.validationError }, "pair response schema validation failed");
      }
      const record = asRecord(request.body);
      const validationError = validationErrorForPairResponse(record);
      if (validationError !== null) {
        return reply.status(400).send(validationError);
      }
      const parsed = PairResponseBodySchema.parse(record);
      const roomId = randomUUID();
      const result = options.pairingStore.authorize(parsed.publicKey, parsed.response, roomId);
      if (!result.ok) {
        const statusCode = result.error === "request_not_found" ? 404 : 409;
        return reply.status(statusCode).send({ error: result.error });
      }
      options.roomStore.createRoom(roomId);
      return reply.status(200).send({ roomId });
    }
  );

  app.delete<{ Body: DeletePairRequestBody }>(
    "/v1/pair/request",
    {
      attachValidation: true,
      schema: {
        body: publicKeyBodySchema
      }
    },
    async (request, reply) => {
      if (request.validationError !== undefined) {
        logger.debug({ err: request.validationError }, "delete pair request schema validation failed");
      }
      const parsed = DeletePairRequestBodySchema.safeParse(asRecord(request.body));
      if (parsed.success) {
        options.pairingStore.delete(parsed.data.publicKey);
      }
      return reply.status(200).send({ ok: true });
    }
  );
}
