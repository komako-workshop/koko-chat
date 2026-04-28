import { PROTOCOL_VERSION } from "@koko/protocol";
import type { RelayFastifyInstance } from "./index";
import { RELAY_VERSION } from "../version";

/** Registers GET /healthz. */
export function registerHealthRoute(app: RelayFastifyInstance, startedAt: number): void {
  app.get("/healthz", async () => ({
    ok: true,
    version: RELAY_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    uptimeMs: Math.max(0, Date.now() - startedAt)
  }));
}
