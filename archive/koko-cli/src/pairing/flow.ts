import { setTimeout as delay } from "node:timers/promises";
import {
  boxDecryptWithSecretKey,
  encodePairingQrUrl,
  generateEphemeralBoxKeypair,
  initCrypto,
  PROTOCOL_VERSION,
  type BoxKeypair
} from "@koko/protocol";
import type { Logger } from "pino";
import { renderQrToStdout } from "./qr";

/** Options for the CLI-side pairing flow. */
export interface PairingFlowOptions {
  /** HTTP relay base URL without a trailing slash. */
  relayUrl: string;
  /** Structured logger. */
  logger: Logger;
  /** Poll interval while waiting for APP authorization. */
  pollIntervalMs: number;
  /** Maximum pairing wait time in milliseconds. */
  maxWaitMs: number;
  /** Optional abort signal for Ctrl+C and tests. */
  signal?: AbortSignal;
  /** Emits the raw koko:// pairing URL, mainly for integration tests. */
  onPairingUrl?: (url: string) => void;
  /** Set false in tests to avoid drawing a terminal QR. Defaults to true. */
  renderQr?: boolean;
}

/** Result returned after APP authorizes pairing. */
export interface PairingFlowResult {
  /** Relay room assigned to this CLI and APP pair. */
  roomId: string;
  /** CLI ephemeral box secret key generated for pairing. */
  cliEphSecretKey: Uint8Array;
  /** APP box public key decrypted from the pairing response bundle. */
  appBoxPublicKey: Uint8Array;
}

interface HttpJsonResponse {
  status: number;
  body: unknown;
}

interface PairRequestResponse {
  state: "pending" | "authorized";
  ttlMs: number;
  roomId?: string;
  response?: string;
}

function abortError(): DOMException {
  return new DOMException("Operation aborted", "AbortError");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw abortError();
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function base64Decode(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "base64"));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parsePairRequestResponse(value: unknown): PairRequestResponse {
  const record = asRecord(value);
  if (record === null) {
    throw new Error("pairing response body must be an object");
  }
  if (record.state !== "pending" && record.state !== "authorized") {
    throw new Error("pairing response state is invalid");
  }
  if (typeof record.ttlMs !== "number") {
    throw new Error("pairing response ttlMs is invalid");
  }
  const response: PairRequestResponse = {
    state: record.state,
    ttlMs: record.ttlMs
  };
  if (typeof record.roomId === "string") {
    response.roomId = record.roomId;
  }
  if (typeof record.response === "string") {
    response.response = record.response;
  }
  return response;
}

async function postJson(url: string, body: unknown, signal: AbortSignal | undefined): Promise<HttpJsonResponse> {
  const init: RequestInit = {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  };
  if (signal !== undefined) {
    init.signal = signal;
  }
  const response = await fetch(url, init);
  const parsedBody: unknown = await response.json().catch(() => ({}));
  return {
    status: response.status,
    body: parsedBody
  };
}

async function postPairRequest(
  relayUrl: string,
  publicKey: string,
  signal: AbortSignal | undefined
): Promise<PairRequestResponse> {
  const response = await postJson(`${relayUrl}/v1/pair/request`, {
    publicKey,
    supportsProtocol: PROTOCOL_VERSION
  }, signal);
  if (response.status !== 200) {
    throw new Error(`pairing request failed with HTTP ${response.status}`);
  }
  return parsePairRequestResponse(response.body);
}

function decryptAuthorizedResponse(
  response: PairRequestResponse,
  cliEphKeypair: BoxKeypair
): PairingFlowResult | null {
  if (response.state !== "authorized") {
    return null;
  }
  if (response.roomId === undefined || response.response === undefined) {
    throw new Error("authorized pairing response is missing roomId or response bundle");
  }
  const appBoxPublicKey = boxDecryptWithSecretKey(base64Decode(response.response), cliEphKeypair.secretKey);
  if (appBoxPublicKey.byteLength !== 32) {
    throw new Error("decrypted APP public key must be 32 bytes");
  }
  return {
    roomId: response.roomId,
    cliEphSecretKey: cliEphKeypair.secretKey,
    appBoxPublicKey
  };
}

/**
 * Runs the full CLI-side pairing flow: ephemeral keypair, QR render, HTTP
 * request publication, polling, and encrypted APP public key decryption.
 */
export async function runPairingFlow(options: PairingFlowOptions): Promise<PairingFlowResult> {
  await initCrypto();
  throwIfAborted(options.signal);

  const relayUrl = options.relayUrl.replace(/\/$/, "");
  const cliEphKeypair = generateEphemeralBoxKeypair();
  const cliEphPublicKey = base64UrlEncode(cliEphKeypair.publicKey);
  const qrUrl = encodePairingQrUrl(cliEphKeypair.publicKey);
  const logger = options.logger.child({ module: "pairing.flow" });

  if (options.renderQr ?? true) {
    renderQrToStdout(qrUrl);
  }
  // Also print the plain URL so it can be scraped from log output or copied
  // when the terminal doesn't render QR blocks well (common in CI and tmux).
  console.log(qrUrl);

  const startedAt = Date.now();
  let response = await postPairRequest(relayUrl, cliEphPublicKey, options.signal);
  options.onPairingUrl?.(qrUrl);
  console.log("waiting for APP to scan...");

  for (;;) {
    throwIfAborted(options.signal);
    const result = decryptAuthorizedResponse(response, cliEphKeypair);
    if (result !== null) {
      logger.info({ roomId: result.roomId }, "pairing authorized");
      return result;
    }

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= options.maxWaitMs) {
      throw new Error("pairing timed out");
    }
    const remainingMs = Math.max(1, options.maxWaitMs - elapsedMs);
    await delay(Math.min(options.pollIntervalMs, remainingMs), undefined, { signal: options.signal });
    response = await postPairRequest(relayUrl, cliEphPublicKey, options.signal);
  }
}
