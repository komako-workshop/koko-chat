import pino, { type Logger } from "pino";
import type { Config } from "./config";

/** Options accepted by the relay logger factory. */
export interface CreateLoggerOptions {
  /** Minimum log level to emit. */
  level: Config["logLevel"];
  /** Disable output entirely, mainly for tests. */
  enabled?: boolean;
  /** Bindings included on every log line. */
  bindings?: Record<string, unknown>;
}

/** Creates a pino JSON logger for relay runtime and tests. */
export function createLogger(options: CreateLoggerOptions): Logger {
  return pino({
    level: options.level,
    enabled: options.enabled ?? true,
    base: options.bindings ?? {},
    timestamp: pino.stdTimeFunctions.isoTime
  });
}

export type { Logger };
