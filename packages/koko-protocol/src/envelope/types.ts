import { z } from "zod";
import { PROTOCOL_VERSION } from "../version";

/** Wire message envelope shared by app, relay, and CLI. */
export interface Envelope {
  /** Protocol version. */
  v: 1;
  /** Message type such as chat.user, chat.agent.delta, or pair.response. */
  type: string;
  /** Room binding identifier; MVP uses the CLI public key hex upstream. */
  roomId: string;
  /** Monotonic sequence number used for ordering and dedupe. */
  seq: number;
  /** Sender-local epoch milliseconds, used only as a hint. */
  ts: number;
  /** Message payload, either a clear JSON value or encrypted bundle base64. */
  payload: unknown;
  /** True when payload is base64(encrypted bundle). */
  encrypted?: boolean;
}

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

/** Zod schema for envelopes; unknown fields are stripped to keep the wire contract tight. */
export const EnvelopeSchema: z.ZodType<Envelope> = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    type: z.string(),
    roomId: z.string(),
    seq: z.number().finite(),
    ts: z.number().finite(),
    payload: z.unknown(),
    encrypted: z.boolean().optional()
  })
  .strip()
  .superRefine((value, ctx) => {
    if (!hasOwn(value, "payload")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "payload is required",
        path: ["payload"]
      });
    }
  }) as z.ZodType<Envelope>;
