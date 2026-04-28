import { z } from "zod";

const integerFromEnv = (name: string, defaultValue: number) =>
  z.preprocess(
    (value) => (value === undefined || value === "" ? defaultValue : Number(value)),
    z.number({ invalid_type_error: `${name} must be a number` }).int().positive()
  );

const configSchema = z.object({
  port: integerFromEnv("KOKO_RELAY_PORT", 8080),
  host: z.string().min(1).default("0.0.0.0"),
  logLevel: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  pairingTtlMs: integerFromEnv("KOKO_RELAY_PAIRING_TTL_MS", 300_000),
  roomTtlMs: integerFromEnv("KOKO_RELAY_ROOM_TTL_MS", 86_400_000),
  roomOfflineQueueMax: integerFromEnv("KOKO_RELAY_ROOM_OFFLINE_QUEUE_MAX", 1_000),
  roomOfflineQueueTtlMs: integerFromEnv("KOKO_RELAY_ROOM_OFFLINE_QUEUE_TTL_MS", 86_400_000)
});

/** Runtime configuration for the relay server. */
export type Config = z.infer<typeof configSchema>;

/** Loads relay configuration from process environment with validated defaults. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return configSchema.parse({
    port: env.KOKO_RELAY_PORT,
    host: env.KOKO_RELAY_HOST,
    logLevel: env.KOKO_RELAY_LOG_LEVEL,
    pairingTtlMs: env.KOKO_RELAY_PAIRING_TTL_MS,
    roomTtlMs: env.KOKO_RELAY_ROOM_TTL_MS,
    roomOfflineQueueMax: env.KOKO_RELAY_ROOM_OFFLINE_QUEUE_MAX,
    roomOfflineQueueTtlMs: env.KOKO_RELAY_ROOM_OFFLINE_QUEUE_TTL_MS
  });
}
