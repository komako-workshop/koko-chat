import pino, { type Logger } from "pino";
import type { CliConfig } from "./config";

/** Options accepted by the CLI logger factory. */
export interface CreateLoggerOptions {
  /** Minimum log level to emit. */
  level: CliConfig["logLevel"];
  /** Disable output entirely, mainly for tests. */
  enabled?: boolean;
  /** Bindings included on every log line. */
  bindings?: Record<string, unknown>;
}

/** Creates a pino JSON logger for CLI runtime and tests. */
export function createLogger(options: CreateLoggerOptions): Logger {
  return pino({
    level: options.level,
    enabled: options.enabled ?? true,
    base: options.bindings ?? {},
    timestamp: pino.stdTimeFunctions.isoTime
  });
}

export type { Logger };
