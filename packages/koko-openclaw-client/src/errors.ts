/** Base error type for Gateway client failures. */
export class GatewayError extends Error {
  /** Stable machine-readable error code. */
  readonly code: string;

  /** Creates a Gateway error. */
  constructor(code: string, message: string) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
  }
}

/** Error raised when the handshake times out. */
export class HandshakeTimeoutError extends GatewayError {
  /** Creates a handshake timeout error. */
  constructor(message = "Gateway handshake timed out") {
    super("HANDSHAKE_TIMEOUT", message);
    this.name = "HandshakeTimeoutError";
  }
}

/** Error raised when the Gateway rejects or returns an invalid handshake response. */
export class HandshakeFailedError extends GatewayError {
  /** Creates a handshake failure error. */
  constructor(message = "Gateway handshake failed") {
    super("HANDSHAKE_FAILED", message);
    this.name = "HandshakeFailedError";
  }
}

/** Error raised when an RPC request times out. */
export class RequestTimeoutError extends GatewayError {
  /** Creates a request timeout error. */
  constructor(message = "Gateway request timed out") {
    super("REQUEST_TIMEOUT", message);
    this.name = "RequestTimeoutError";
  }
}

/** Error raised when a request is attempted while disconnected. */
export class NotConnectedError extends GatewayError {
  /** Creates a not-connected error. */
  constructor(message = "Gateway client is not connected") {
    super("NOT_CONNECTED", message);
    this.name = "NotConnectedError";
  }
}

/** Error raised when the WebSocket closes with a fatal Gateway close code. */
export class FatalCloseError extends GatewayError {
  /** WebSocket close code. */
  readonly closeCode: number;

  /** Creates a fatal-close error. */
  constructor(closeCode: number, reason: string) {
    super("FATAL_CLOSE", `Gateway closed with fatal code ${closeCode}${reason.length > 0 ? `: ${reason}` : ""}`);
    this.name = "FatalCloseError";
    this.closeCode = closeCode;
  }
}
