#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config";
import { createLogger } from "./logger";
import { runStart } from "./start";

export { DEFAULT_RELAY_URL, loadConfig, type CliConfig } from "./config";
export { loadOrCreateDeviceSeed, saveDeviceSeed, type DeviceSeedResult } from "./identity";
export { createLogger, type CreateLoggerOptions, type Logger } from "./logger";
export { runPairingFlow, renderQrToStdout, type PairingFlowOptions, type PairingFlowResult } from "./pairing";
export { connectRoom, type PeerEvent, type RoomConnection, type RoomConnectionOptions } from "./relay";
export { createEchoBot, type EchoBot, type EchoBotOptions } from "./bot";
export { PLACEHOLDER_SESSION_KEY, runStart, type StartOptions } from "./start";

const VERSION = "0.0.1";

function helpText(): string {
  return [
    "koko-cli",
    "",
    "Usage:",
    "  koko-cli start      Pair with the APP and run the encrypted echo bot",
    "  koko-cli --version  Print version",
    "  koko-cli help       Print this help"
  ].join("\n");
}

function logError(logger: ReturnType<typeof createLogger>, error: unknown): void {
  logger.error(error instanceof Error ? error : { error }, "koko-cli failed");
}

/** CLI entrypoint used by the executable wrapper. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const command = argv[0] ?? "help";

  if (command === "help" || command === "-h" || command === "--help") {
    console.log(helpText());
    return 0;
  }

  if (command === "--version" || command === "version") {
    console.log(VERSION);
    return 0;
  }

  if (command !== "start") {
    console.log(helpText());
    return 1;
  }

  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel });
  const controller = new AbortController();
  const abort = (): void => {
    controller.abort();
  };

  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    await runStart({ config, logger, signal: controller.signal });
    return 0;
  } catch (error) {
    if (controller.signal.aborted) {
      return 0;
    }
    logError(logger, error);
    return 1;
  } finally {
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      const logger = createLogger({ level: "error" });
      logError(logger, error);
      process.exitCode = 1;
    });
}
