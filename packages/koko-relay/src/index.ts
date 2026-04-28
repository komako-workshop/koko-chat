#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config";
import { createLogger } from "./logger";
import { createRelayServer } from "./server";

export { createRelayServer } from "./server";
export type { RelayServer, RelayServerOptions } from "./server";

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel });
  const server = createRelayServer({
    port: config.port,
    host: config.host,
    logger,
    pairingTtlMs: config.pairingTtlMs,
    roomTtlMs: config.roomTtlMs,
    roomOfflineQueueMax: config.roomOfflineQueueMax,
    roomOfflineQueueTtlMs: config.roomOfflineQueueTtlMs
  });

  server
    .listen()
    .then((address) => {
      logger.info({ address }, "koko relay listening");
    })
    .catch((error: Error) => {
      logger.error(error, "failed to start koko relay");
      process.exitCode = 1;
    });

  const close = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, "stopping koko relay");
    server
      .close()
      .then(() => {
        process.exitCode = 0;
      })
      .catch((error: Error) => {
        logger.error(error, "failed to stop koko relay cleanly");
        process.exitCode = 1;
      });
  };

  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}
