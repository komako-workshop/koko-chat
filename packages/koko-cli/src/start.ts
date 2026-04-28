import { initCrypto, type Envelope } from "@koko/protocol";
import { GatewayClient, type GatewayClientOptions } from "@koko/openclaw-client";
import type { Logger } from "pino";
import type { CliConfig } from "./config";
import { loadOrCreateDeviceSeed } from "./identity";
import {
  createOpenClawBot,
  loadOpenClawDeviceSeed,
  loadOpenClawOperatorToken,
  loadOpenClawPairedDevice,
  readMainSession,
  type MainSessionInfo,
  type OpenClawBot,
  type OpenClawDeviceIdentity,
  type OpenClawGatewayClient,
  type OpenClawPairedDeviceInfo,
  type ReadMainSessionOptions
} from "./openclaw";
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
  /** Optional OpenClaw dependency injection used by tests. */
  openclawRuntime?: Partial<StartOpenClawRuntime>;
}

/** Gateway client surface needed by the start command. */
export type StartGatewayClient = OpenClawGatewayClient & {
  /** Opens the Gateway connection. */
  connect(): Promise<void>;
  /** Closes the Gateway connection. */
  disconnect(): Promise<void>;
};

/** Injectable OpenClaw runtime hooks for `runStart` tests. */
export interface StartOpenClawRuntime {
  /** Loads OpenClaw identity material. */
  loadDeviceSeed(identityJsonPath?: string): Promise<OpenClawDeviceIdentity>;
  /** Loads the operator token and Gateway-approved client metadata for the resolved device id. */
  loadPairedDevice(deviceId: string, pairedJsonPath?: string): Promise<OpenClawPairedDeviceInfo>;
  /** @deprecated: prefer {@link loadPairedDevice}; kept for backwards compatibility in older tests. */
  loadOperatorToken(deviceId: string, pairedJsonPath?: string): Promise<string>;
  /** Resolves the main OpenClaw agent session. */
  readMainSession(options?: ReadMainSessionOptions): Promise<MainSessionInfo>;
  /** Creates a connected-capable Gateway client. */
  createGatewayClient(options: GatewayClientOptions): StartGatewayClient;
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

function defaultOpenClawRuntime(overrides: Partial<StartOpenClawRuntime> | undefined): StartOpenClawRuntime {
  return {
    loadDeviceSeed: overrides?.loadDeviceSeed ?? loadOpenClawDeviceSeed,
    loadPairedDevice: overrides?.loadPairedDevice ?? loadOpenClawPairedDevice,
    loadOperatorToken: overrides?.loadOperatorToken ?? loadOpenClawOperatorToken,
    readMainSession: overrides?.readMainSession ?? readMainSession,
    createGatewayClient: overrides?.createGatewayClient ?? ((gatewayOptions) => new GatewayClient(gatewayOptions))
  };
}

async function cleanupRuntime(args: {
  bot: OpenClawBot | undefined;
  gatewayClient: StartGatewayClient | undefined;
  connection: RoomConnection | undefined;
  logger: Logger;
}): Promise<void> {
  if (args.bot !== undefined) {
    try {
      await args.bot.abort();
    } catch (error) {
      args.logger.warn(error instanceof Error ? error : { error }, "failed during OpenClaw bot abort cleanup");
    }
  }
  if (args.gatewayClient !== undefined) {
    try {
      await args.gatewayClient.disconnect();
    } catch (error) {
      args.logger.warn(error instanceof Error ? error : { error }, "failed during OpenClaw Gateway disconnect cleanup");
    }
  }
  if (args.connection !== undefined) {
    try {
      await args.connection.close();
    } catch (error) {
      args.logger.warn(error instanceof Error ? error : { error }, "failed during relay connection cleanup");
    }
  }
  args.bot?.close();
}

/** Run the full start flow: device seed, OpenClaw Gateway, pairing, WebSocket connection, chat loop. */
export async function runStart(options: StartOptions): Promise<void> {
  await initCrypto();
  const logger = options.logger.child({ module: "start" });
  const openclawLogger = options.logger.child({ module: "openclaw" });
  const openclawRuntime = defaultOpenClawRuntime(options.openclawRuntime);

  console.log("🦞 KokoChat CLI (dev)");
  console.log(`relay: ${options.config.relayUrl}`);
  console.log(`device key: ${options.config.deviceKeyPath}`);

  const deviceSeed = await loadOrCreateDeviceSeed(options.config.deviceKeyPath);
  if (deviceSeed.created) {
    logger.info("generated new device seed");
  }

  let connection: RoomConnection | undefined = undefined;
  let gatewayClient: StartGatewayClient | undefined = undefined;
  let bot: OpenClawBot | undefined = undefined;
  try {
    const openClawIdentity = await openclawRuntime.loadDeviceSeed(options.config.openclawIdentityPath);
    const openClawPaired = await openclawRuntime.loadPairedDevice(openClawIdentity.deviceId, options.config.openclawPairedPath);
    const mainSession = await openclawRuntime.readMainSession({ openclawBinary: options.config.openclawBinary });
    openclawLogger.info(
      {
        deviceId: openClawIdentity.deviceId,
        publicKey: openClawIdentity.publicKey,
        clientId: openClawPaired.clientId,
        clientMode: openClawPaired.clientMode,
        sessionKey: mainSession.sessionKey
      },
      "OpenClaw identity resolved"
    );

    gatewayClient = openclawRuntime.createGatewayClient({
      url: options.config.openclawGatewayUrl,
      token: openClawPaired.token,
      deviceSeed: openClawIdentity.seed,
      // OpenClaw Gateway enforces an allow-list for client.id / client.mode.
      // Reuse the values that were already paired on this machine (stored in
      // ~/.openclaw/devices/paired.json), otherwise handshake fails with
      // "invalid connect params: at /client/id: must be equal to one of the
      // allowed values".
      client: {
        id: openClawPaired.clientId,
        version: "0.0.1",
        platform: process.platform,
        mode: openClawPaired.clientMode
      },
      logger: openclawLogger,
      maxRetries: 3,
      requestTimeoutMs: 30_000,
      onStatusChange(status) {
        openclawLogger.info({ status }, "OpenClaw Gateway status");
      }
    });
    await gatewayClient.connect();
    console.log(`✓ OpenClaw Gateway connected (session: ${mainSession.sessionKey})`);

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
    bot = createOpenClawBot({
      roomId: pairing.roomId,
      // ⚠️  PLACEHOLDER: real machineKey exchange is designed in Task 04.
      sessionKey: PLACEHOLDER_SESSION_KEY,
      gatewayClient,
      openclawSessionKey: mainSession.sessionKey,
      logger: openclawLogger
    });

    const connectionOptions: RoomConnectionOptions = {
      wsBaseUrl: options.config.relayWsUrl,
      roomId: pairing.roomId,
      role: "cli",
      logger,
      onEnvelope(envelope: Envelope) {
        return bot?.handle(envelope, (outgoing) => {
          connection?.sendEnvelope(outgoing);
        });
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
    await Promise.race([connection.closed, waitForAbort(options.signal)]);
  } finally {
    await cleanupRuntime({ bot, gatewayClient, connection, logger: openclawLogger });
    logger.info("stopped");
  }
}
