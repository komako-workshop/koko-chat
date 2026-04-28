import { initCrypto, type Envelope } from "@koko/protocol";
import type { Logger } from "pino";
import type { CliConfig } from "./config";
import { loadOrCreateDeviceSeed } from "./identity";
import { createEchoBot } from "./bot";
import { runPairingFlow, type PairingFlowOptions } from "./pairing";
import { connectRoom, type RoomConnection, type RoomConnectionOptions } from "./relay";

/** Options for running `koko-cli start`. */
export interface StartOptions {
  /** Loaded runtime config. */
  config: CliConfig;
  /** Structured logger. */
  logger: Logger;
  /** Optional abort signal for Ctrl+C and tests. */
  signal?: AbortSignal;
  /** Emits the raw koko:// pairing URL, mainly for integration tests. */
  onPairingUrl?: (url: string) => void;
  /** Set false in tests to avoid drawing a terminal QR. Defaults to true. */
  renderQr?: boolean;
}

/**
 * ⚠️  PLACEHOLDER: real machineKey exchange is designed in Task 04.
 * This matches scripts/smoke-echo.mjs so Task 03b can verify the data path.
 */
export const PLACEHOLDER_SESSION_KEY = new Uint8Array(32).fill(42);

function waitForAbort(signal: AbortSignal | undefined): Promise<void> {
  if (signal === undefined) {
    return new Promise(() => undefined);
  }
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

function nextResponseSeq(incoming: Envelope, current: number): number {
  const incomingNext = Number.isFinite(incoming.seq) ? Math.trunc(incoming.seq) + 1 : current;
  return Math.max(current, incomingNext);
}

/** Run the full start flow: device seed, pairing, WebSocket connection, echo loop. */
export async function runStart(options: StartOptions): Promise<void> {
  await initCrypto();
  const logger = options.logger.child({ module: "start" });

  console.log("🦞 KokoChat CLI (dev)");
  console.log(`relay: ${options.config.relayUrl}`);
  console.log(`device key: ${options.config.deviceKeyPath}`);

  const deviceSeed = await loadOrCreateDeviceSeed(options.config.deviceKeyPath);
  if (deviceSeed.created) {
    logger.info("generated new device seed");
  }

  const pairingOptions: PairingFlowOptions = {
    relayUrl: options.config.relayUrl,
    logger,
    pollIntervalMs: options.config.pairingPollIntervalMs,
    maxWaitMs: options.config.pairingMaxWaitMs
  };
  if (options.signal !== undefined) {
    pairingOptions.signal = options.signal;
  }
  if (options.onPairingUrl !== undefined) {
    pairingOptions.onPairingUrl = options.onPairingUrl;
  }
  if (options.renderQr !== undefined) {
    pairingOptions.renderQr = options.renderQr;
  }

  const pairing = await runPairingFlow(pairingOptions);

  let nextSeq = 1;
  let connection: RoomConnection | undefined = undefined;
  const bot = createEchoBot({
    roomId: pairing.roomId,
    // ⚠️  PLACEHOLDER: real machineKey exchange is designed in Task 04.
    sessionKey: PLACEHOLDER_SESSION_KEY,
    logger
  });

  const connectionOptions: RoomConnectionOptions = {
    wsBaseUrl: options.config.relayWsUrl,
    roomId: pairing.roomId,
    role: "cli",
    logger,
    onEnvelope(envelope) {
      const seq = nextResponseSeq(envelope, nextSeq);
      nextSeq = seq + 1;
      const response = bot.handle(envelope, seq);
      if (response !== null) {
        connection?.sendEnvelope(response);
      }
    },
    onPeerEvent(event) {
      logger.info(event, "relay peer event");
    },
    onFatal(reason) {
      logger.error({ reason }, "relay connection fatal error");
    }
  };
  if (options.signal !== undefined) {
    connectionOptions.signal = options.signal;
  }

  connection = await connectRoom(connectionOptions);

  console.log("✓ paired, bot ready. Press Ctrl+C to stop.");

  try {
    await Promise.race([connection.closed, waitForAbort(options.signal)]);
  } finally {
    await connection.close();
    logger.info("stopped");
  }
}
