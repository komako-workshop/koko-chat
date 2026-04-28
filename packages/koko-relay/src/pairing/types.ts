import { z } from "zod";
import { PROTOCOL_VERSION } from "@koko/protocol";

const base64UrlPattern = /^[A-Za-z0-9_-]+$/;

function decodeBase64Url(value: string): Buffer | null {
  if (!base64UrlPattern.test(value)) {
    return null;
  }
  try {
    return Buffer.from(value, "base64url");
  } catch {
    return null;
  }
}

/** Validates a base64url-encoded 32 byte public key. */
export const PublicKeySchema = z
  .string()
  .min(1)
  .refine((value) => {
    const decoded = decodeBase64Url(value);
    return decoded !== null && decoded.byteLength === 32;
  }, "publicKey must be base64url encoded 32 bytes");

/** Request body for POST /v1/pair/request. */
export const PairRequestBodySchema = z.object({
  publicKey: PublicKeySchema,
  supportsProtocol: z.literal(PROTOCOL_VERSION)
});

/** Request body for POST /v1/pair/response. */
export const PairResponseBodySchema = z.object({
  publicKey: PublicKeySchema,
  response: z.string().min(1)
});

/** Request body for DELETE /v1/pair/request. */
export const DeletePairRequestBodySchema = z.object({
  publicKey: PublicKeySchema
});

/** Parsed request body for POST /v1/pair/request. */
export type PairRequestBody = z.infer<typeof PairRequestBodySchema>;

/** Parsed request body for POST /v1/pair/response. */
export type PairResponseBody = z.infer<typeof PairResponseBodySchema>;

/** Parsed request body for DELETE /v1/pair/request. */
export type DeletePairRequestBody = z.infer<typeof DeletePairRequestBodySchema>;
