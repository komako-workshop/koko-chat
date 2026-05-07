import type { DeviceIdentity, GatewayClientMetadata } from "./types";
import type { EventFrame, JsonRecord } from "./frames";
import { buildSignaturePayload, deriveDeviceIdentity, signDevicePayload } from "./device";
import { HandshakeFailedError } from "./errors";

/** Default OpenClaw operator role. */
export const DEFAULT_ROLE = "operator";

/** Default OpenClaw operator scopes used by the CLI. */
export const DEFAULT_SCOPES = ["operator.read", "operator.write", "operator.approvals", "operator.pairing"] as const;

/** Protocol version requested by this client. */
export const GATEWAY_PROTOCOL_VERSION = 3;

/** Payload accepted from `connect.challenge`. */
export interface ConnectChallengePayload extends JsonRecord {
  /** Server nonce to sign. */
  nonce: string;
}

/** Minimal `hello-ok` shape required by this client. */
export interface HelloOkPayload extends JsonRecord {
  /** Handshake success discriminator. */
  type: "hello-ok";
  /** Optional auth metadata. */
  auth?: JsonRecord;
  /** Optional Gateway snapshot. */
  snapshot?: JsonRecord;
}

/** Arguments used to build a Gateway `connect` request. */
export interface BuildConnectParamsArgs {
  /** Operator token. */
  token?: string;
  /** One-time bootstrap token from `openclaw qr` / device-pair setup code. */
  bootstrapToken?: string;
  /** Optional cached device token. */
  deviceToken?: string;
  /** 32-byte Ed25519 seed for this connection. */
  deviceSeed: Uint8Array;
  /** Challenge nonce. */
  nonce: string;
  /** Client metadata. */
  client: GatewayClientMetadata;
  /** Requested role. */
  role: string;
  /** Requested scopes. */
  scopes: string[];
}

/** Result of constructing Gateway `connect` params. */
export interface BuildConnectParamsResult {
  /** Request params for method `connect`. */
  params: JsonRecord;
  /** Device identity embedded in the params. */
  device: DeviceIdentity;
}

/** Returns default client metadata for Node CLI usage. */
export function defaultClientMetadata(): GatewayClientMetadata {
  return {
    id: "koko-cli",
    version: "dev",
    platform: process.platform,
    mode: "cli"
  };
}

/** Returns true when a frame is an internal `connect.challenge` event with a nonce. */
export function isConnectChallengeFrame(frame: EventFrame): frame is EventFrame & { payload: ConnectChallengePayload } {
  return frame.event === "connect.challenge" && typeof frame.payload.nonce === "string";
}

/** Returns true when a payload is the Gateway `hello-ok` response. */
export function isHelloOkPayload(payload: unknown): payload is HelloOkPayload {
  return isJsonRecord(payload) && payload.type === "hello-ok";
}

/** Builds params for the OpenClaw Protocol v3 `connect` request. */
export async function buildConnectParams(args: BuildConnectParamsArgs): Promise<BuildConnectParamsResult> {
  const signedAt = Date.now();
  const derived = await deriveDeviceIdentity(args.deviceSeed);
  const payload = buildSignaturePayload({
    deviceId: derived.deviceId,
    clientId: args.client.id,
    clientMode: args.client.mode,
    role: args.role,
    scopes: args.scopes,
    signedAtMs: signedAt,
    token: args.token ?? args.bootstrapToken ?? null,
    nonce: args.nonce
  });
  const signature = await signDevicePayload(args.deviceSeed, payload);
  const device: DeviceIdentity = {
    id: derived.deviceId,
    publicKey: derived.publicKey,
    signature,
    signedAt,
    nonce: args.nonce
  };
  const auth: JsonRecord = {};
  if (args.token !== undefined) {
    auth.token = args.token;
  }
  if (args.bootstrapToken !== undefined) {
    auth.bootstrapToken = args.bootstrapToken;
  }
  if (args.deviceToken !== undefined) {
    auth.deviceToken = args.deviceToken;
  }

  return {
    device,
    params: {
      role: args.role,
      scopes: args.scopes,
      auth,
      device,
      client: args.client,
      minProtocol: GATEWAY_PROTOCOL_VERSION,
      maxProtocol: GATEWAY_PROTOCOL_VERSION
    }
  };
}

/** Extracts `snapshot.policy.maxPayload` from a `hello-ok` payload, if present. */
export function maxPayloadFromHelloOk(payload: HelloOkPayload): number | undefined {
  const snapshot = payload.snapshot;
  const policy = isJsonRecord(snapshot?.policy) ? snapshot.policy : undefined;
  const value = policy?.maxPayload;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Extracts `auth.deviceToken` from a `hello-ok` payload, if present. */
export function deviceTokenFromHelloOk(payload: HelloOkPayload): string | undefined {
  const value = payload.auth?.deviceToken;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Converts an unexpected handshake payload into a typed failure. */
export function assertHelloOkPayload(payload: unknown): HelloOkPayload {
  if (!isHelloOkPayload(payload)) {
    throw new HandshakeFailedError("Gateway handshake response was not hello-ok");
  }
  return payload;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
