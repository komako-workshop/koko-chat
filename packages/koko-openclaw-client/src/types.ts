/** Connection lifecycle state exposed by {@link GatewayClient}. */
export type ConnectionStatus = "disconnected" | "connecting" | "handshaking" | "connected" | "error";

/** OpenClaw backend flavor selected by the caller. */
export type BackendType = "openclaw" | "channel";

/** Client metadata sent in the Gateway `connect` request. */
export interface GatewayClientMetadata {
  /** Stable client identifier. */
  id: string;
  /** Client version string. */
  version: string;
  /** Runtime platform. */
  platform: string;
  /** Client mode, for example `cli`. */
  mode: string;
}

/** OpenClaw Protocol v3 device identity fields. */
export interface DeviceIdentity {
  /** hex(sha256(publicKey raw bytes)). */
  id: string;
  /** Base64url-encoded raw Ed25519 public key. */
  publicKey: string;
  /** Base64url-encoded Ed25519 signature over the canonical v2 payload. */
  signature: string;
  /** Signature creation time in epoch milliseconds. */
  signedAt: number;
  /** Challenge nonce received from `connect.challenge`. */
  nonce: string;
}

/** Minimal logger interface. */
export interface Logger {
  /** Trace-level diagnostic logging. */
  trace: (...args: unknown[]) => void;
  /** Debug-level diagnostic logging. */
  debug: (...args: unknown[]) => void;
  /** Informational logging. */
  info: (...args: unknown[]) => void;
  /** Warning logging. */
  warn: (...args: unknown[]) => void;
  /** Error logging. */
  error: (...args: unknown[]) => void;
}

/** Constructor options for {@link GatewayClient}. */
export interface GatewayClientOptions {
  /** ws:// or wss:// URL. The operator token is appended as a query param. */
  url: string;
  /** Operator token read by the caller from OpenClaw pairing state. */
  token: string;
  /** Optional cached device token returned by a previous `hello-ok`. */
  deviceToken?: string;
  /** Optional long-lived 32-byte Ed25519 seed. Omitted means one ephemeral seed per connection. */
  deviceSeed?: Uint8Array;
  /** Optional client metadata sent to the Gateway. */
  client?: Partial<GatewayClientMetadata>;
  /** Backend type. Defaults to `openclaw`. */
  backend?: BackendType;
  /** Requested role. Defaults to `operator`. */
  role?: string;
  /** Requested scopes. Defaults to OpenClaw operator read/write/approval/pairing scopes. */
  scopes?: string[];
  /** Maximum reconnect attempts after an established connection drops. Defaults to 10. */
  maxRetries?: number;
  /** Per-request and handshake timeout in milliseconds. Defaults to 30000. */
  requestTimeoutMs?: number;
  /** Base reconnect delay in milliseconds. Defaults to 1000. */
  reconnectBaseDelayMs?: number;
  /** Maximum reconnect delay in milliseconds. Defaults to 30000. */
  reconnectMaxDelayMs?: number;
  /** Optional injected logger. Defaults to a noop logger. */
  logger?: Logger;
  /** Called whenever the connection status changes. */
  onStatusChange?: (status: ConnectionStatus) => void;
  /** Called when `hello-ok` returns a new device token. */
  onDeviceToken?: (token: string) => void;
}

/** OpenClaw chat event payload, intentionally loose for protocol evolution. */
export interface ChatEvent {
  /** Event state such as `delta`, `final`, or `error`. */
  state?: string;
  /** Gateway session key. */
  sessionKey?: string;
  /** Agent run id. */
  runId?: string;
  /** Message payload supplied by OpenClaw. */
  message?: unknown;
  /** Additional OpenClaw fields are forwarded unchanged. */
  [key: string]: unknown;
}

/** OpenClaw chat history response, intentionally loose for protocol evolution. */
export interface ChatHistoryResponse {
  /** History messages supplied by OpenClaw. */
  messages?: unknown[];
  /** Additional OpenClaw fields are forwarded unchanged. */
  [key: string]: unknown;
}

/** Event callback registered through {@link GatewayClient.on}. */
export type EventCallback = (payload: Record<string, unknown>) => void;

/** No-op logger used when the caller does not inject one. */
export const noopLogger: Logger = {
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};
