import { PROTOCOL_VERSION } from "@koko/protocol";
import { RELAY_VERSION } from "../version";
import { sendJson, type HttpRequestContext } from "./index";

/** Handles GET /healthz. */
export function handleHealth(ctx: HttpRequestContext, startedAt: number): boolean {
  if (ctx.req.method !== "GET" || ctx.url.pathname !== "/healthz") {
    return false;
  }
  sendJson(ctx.res, 200, {
    ok: true,
    version: RELAY_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    uptimeMs: Math.max(0, Date.now() - startedAt)
  });
  return true;
}
