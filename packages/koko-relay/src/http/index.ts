import type {
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault
} from "fastify";
import type { Logger } from "pino";

/** Fastify instance type used by relay route modules. */
export type RelayFastifyInstance = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression<RawServerDefault>,
  RawReplyDefaultExpression<RawServerDefault>,
  Logger
>;
