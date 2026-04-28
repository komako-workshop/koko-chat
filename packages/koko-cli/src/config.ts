import os from "node:os";
import path from "node:path";
import { DEFAULT_OPENCLAW_IDENTITY_PATH, DEFAULT_OPENCLAW_PAIRED_PATH } from "./openclaw/identity";

/** Compiled-in relay URL for local development. */
export const DEFAULT_RELAY_URL = "http://localhost:8080";

/** Compiled-in local OpenClaw Gateway URL. */
export const DEFAULT_OPENCLAW_GATEWAY_URL = "ws://127.0.0.1:18789";

const logLevels = ["trace", "debug", "info", "warn", "error"] as const;

/** Runtime configuration for the CLI process. */
export interface CliConfig {
  /** HTTP relay base URL without a trailing slash. */
  relayUrl: string;
  /** WebSocket relay base URL derived from relayUrl. */
  relayWsUrl: string;
  /** Path to the persisted 32-byte device seed. */
  deviceKeyPath: string;
  /** Minimum pino log level. */
  logLevel: "trace" | "debug" | "info" | "warn" | "error";
  /** Poll interval while waiting for APP pairing approval. */
  pairingPollIntervalMs: number;
  /** Maximum time to wait for APP pairing approval. */
  pairingMaxWaitMs: number;
  /** WebSocket URL for the local OpenClaw Gateway. */
  openclawGatewayUrl: string;
  /** Path to OpenClaw's persisted device identity JSON. */
  openclawIdentityPath: string;
  /** Path to OpenClaw's paired devices JSON. */
  openclawPairedPath: string;
  /** OpenClaw CLI binary used for session discovery. */
  openclawBinary: string;
}

function normalizeRelayUrl(value: string): string {
  return value.replace(/\/$/, "");
}

function relayWsUrlOf(relayUrl: string): string {
  return relayUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
}

function parseLogLevel(value: string | undefined): CliConfig["logLevel"] {
  if (value !== undefined && logLevels.includes(value as CliConfig["logLevel"])) {
    return value as CliConfig["logLevel"];
  }
  return "info";
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

/** Loads CLI config from env, falling back to local-dev defaults. */
export function loadConfig(): CliConfig {
  const relayUrl = normalizeRelayUrl(process.env.KOKO_RELAY_URL ?? DEFAULT_RELAY_URL);
  return {
    relayUrl,
    relayWsUrl: relayWsUrlOf(relayUrl),
    deviceKeyPath: process.env.KOKO_DEVICE_KEY_PATH ?? path.join(os.homedir(), ".koko-cli", "device.key"),
    logLevel: parseLogLevel(process.env.KOKO_LOG_LEVEL),
    pairingPollIntervalMs: parsePositiveInteger(process.env.KOKO_PAIRING_POLL_MS, 1_000),
    pairingMaxWaitMs: parsePositiveInteger(process.env.KOKO_PAIRING_MAX_WAIT_MS, 300_000),
    openclawGatewayUrl: process.env.KOKO_OPENCLAW_GATEWAY_URL ?? DEFAULT_OPENCLAW_GATEWAY_URL,
    openclawIdentityPath: process.env.KOKO_OPENCLAW_IDENTITY_PATH ?? DEFAULT_OPENCLAW_IDENTITY_PATH,
    openclawPairedPath: process.env.KOKO_OPENCLAW_PAIRED_PATH ?? DEFAULT_OPENCLAW_PAIRED_PATH,
    openclawBinary: process.env.KOKO_OPENCLAW_BINARY ?? "openclaw"
  };
}
