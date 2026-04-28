import type { Config } from "./config";

const levels = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50
} as const;

type LogLevel = keyof typeof levels;
type LogContext = Error | Record<string, unknown> | string;
type LogMethod = (context?: LogContext, message?: string) => void;

/** Pino-compatible logger namespace used by the public relay server contract. */
export namespace pino {
  /** Minimal pino logger surface used by the relay implementation. */
  export interface Logger {
    trace: LogMethod;
    debug: LogMethod;
    info: LogMethod;
    warn: LogMethod;
    error: LogMethod;
    child(bindings: Record<string, unknown>): Logger;
  }
}

/** Options accepted by the relay logger factory. */
export interface CreateLoggerOptions {
  /** Minimum log level to emit. */
  level: Config["logLevel"];
  /** Disable output entirely, mainly for tests. */
  enabled?: boolean;
  /** Bindings included on every log line. */
  bindings?: Record<string, unknown>;
}

function normalizeContext(context: LogContext | undefined): Record<string, unknown> {
  if (context === undefined) {
    return {};
  }
  if (context instanceof Error) {
    return {
      err: {
        name: context.name,
        message: context.message,
        stack: context.stack
      }
    };
  }
  if (typeof context === "string") {
    return { msg: context };
  }
  return context;
}

/** Creates a JSON logger with the subset of pino semantics relay needs. */
export function createLogger(options: CreateLoggerOptions): pino.Logger {
  const enabled = options.enabled ?? true;
  const baseBindings = options.bindings ?? {};

  const makeMethod =
    (level: LogLevel): LogMethod =>
    (context?: LogContext, message?: string): void => {
      if (!enabled || levels[level] < levels[options.level]) {
        return;
      }
      const normalized = normalizeContext(context);
      const msg = message ?? (typeof context === "string" ? context : undefined);
      const record = {
        level,
        time: new Date().toISOString(),
        ...baseBindings,
        ...normalized,
        ...(msg === undefined ? {} : { msg })
      };
      process.stdout.write(`${JSON.stringify(record)}\n`);
    };

  const logger: pino.Logger = {
    trace: makeMethod("trace"),
    debug: makeMethod("debug"),
    info: makeMethod("info"),
    warn: makeMethod("warn"),
    error: makeMethod("error"),
    child(bindings: Record<string, unknown>): pino.Logger {
      return createLogger({
        ...options,
        bindings: {
          ...baseBindings,
          ...bindings
        }
      });
    }
  };

  return logger;
}
