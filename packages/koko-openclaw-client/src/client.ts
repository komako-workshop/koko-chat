import { Buffer } from "node:buffer";
import { WebSocket, type RawData } from "ws";
import {
  assertHelloOkPayload,
  buildConnectParams,
  DEFAULT_ROLE,
  DEFAULT_SCOPES,
  defaultClientMetadata,
  deviceTokenFromHelloOk,
  isConnectChallengeFrame,
  maxPayloadFromHelloOk,
  type ConnectChallengePayload
} from "./handshake";
import { generateDeviceSeed } from "./device";
import {
  FatalCloseError,
  GatewayError,
  HandshakeFailedError,
  HandshakeTimeoutError,
  NotConnectedError,
  RequestTimeoutError
} from "./errors";
import {
  isEventFrame,
  parseFrameText,
  serializeRequestFrame,
  type EventFrame,
  type JsonRecord,
  type RequestFrame,
  type ResponseFrame
} from "./frames";
import type { ConnectionStatus, EventCallback, GatewayClientMetadata, GatewayClientOptions, Logger } from "./types";
import { noopLogger } from "./types";

type PendingRequest = {
  resolve: (payload: JsonRecord) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type ChallengeWaiter = {
  resolve: (payload: ConnectChallengePayload) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type WelcomeWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

/** OpenClaw Gateway Protocol v3 WebSocket client. */
export class GatewayClient {
  private readonly url: string;
  private readonly token: string;
  private readonly deviceSeed: Uint8Array | undefined;
  private readonly clientMetadata: GatewayClientMetadata;
  private readonly backend: "openclaw" | "channel";
  private readonly role: string;
  private readonly scopes: string[];
  private readonly maxRetries: number;
  private readonly requestTimeoutMs: number;
  private readonly reconnectBaseDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly logger: Logger;
  private readonly subscriptions = new Map<string, Set<EventCallback>>();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly reconnectSockets = new WeakSet<WebSocket>();

  private websocket: WebSocket | undefined;
  private status: ConnectionStatus = "disconnected";
  private requestCounter = 0;
  private connectPromise: Promise<void> | undefined;
  private intentionalClose = false;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private challengeWaiter: ChallengeWaiter | undefined;
  private welcomeWaiter: WelcomeWaiter | undefined;
  private queuedChallenge: ConnectChallengePayload | undefined;
  private queuedWelcome = false;
  private maxPayload = 0;
  private deviceToken: string | undefined;

  /** Creates a Gateway client. */
  constructor(private readonly options: GatewayClientOptions) {
    this.url = options.url;
    this.token = options.token;
    this.deviceSeed = options.deviceSeed === undefined ? undefined : new Uint8Array(options.deviceSeed);
    this.clientMetadata = { ...defaultClientMetadata(), ...options.client };
    this.backend = options.backend ?? "openclaw";
    this.role = options.role ?? DEFAULT_ROLE;
    this.scopes = [...(options.scopes ?? DEFAULT_SCOPES)];
    this.maxRetries = options.maxRetries ?? 10;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 1_000;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 30_000;
    this.logger = options.logger ?? noopLogger;
    this.deviceToken = options.deviceToken;
  }

  /** Returns the current connection status. */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  /** Returns the latest `snapshot.policy.maxPayload` value received from `hello-ok`. */
  getMaxPayload(): number {
    return this.maxPayload;
  }

  /** Opens the WebSocket and resolves after the Gateway handshake completes. */
  connect(): Promise<void> {
    if (this.status === "connected") {
      return Promise.resolve();
    }
    if (this.connectPromise !== undefined) {
      return this.connectPromise;
    }

    this.intentionalClose = false;
    this.reconnectAttempts = 0;
    this.clearReconnectTimer();
    this.connectPromise = this.openConnection(false).finally(() => {
      this.connectPromise = undefined;
    });
    return this.connectPromise;
  }

  /** Closes the WebSocket and disables automatic reconnect. */
  async disconnect(): Promise<void> {
    this.intentionalClose = true;
    this.clearReconnectTimer();
    const closeError = new GatewayError("DISCONNECTED", "Gateway client disconnected");
    this.rejectHandshakeWaiters(closeError);
    this.rejectAllPending(closeError);

    const socket = this.websocket;
    if (socket === undefined || socket.readyState === WebSocket.CLOSED) {
      this.websocket = undefined;
      this.setStatus("disconnected");
      return;
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        socket.terminate();
        resolve();
      }, 200);
      socket.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      if (socket.readyState === WebSocket.OPEN) {
        socket.close(1000, "client disconnect");
      } else {
        socket.terminate();
      }
    });
    this.websocket = undefined;
    this.setStatus("disconnected");
  }

  /** Sends an RPC request and resolves with the response payload. */
  call(method: string, params?: JsonRecord): Promise<JsonRecord> {
    if (this.status !== "connected" && method !== "connect") {
      return Promise.reject(new NotConnectedError());
    }
    return this.sendRequest(method, params, (requestMethod) => {
      return new RequestTimeoutError(`Gateway request ${requestMethod} timed out`);
    });
  }

  /** Subscribes to a Gateway event and returns an unsubscribe function. */
  on(event: string, callback: EventCallback): () => void {
    const callbacks = this.subscriptions.get(event) ?? new Set<EventCallback>();
    callbacks.add(callback);
    this.subscriptions.set(event, callbacks);
    return () => this.off(event, callback);
  }

  /** Removes a previously registered event subscription. */
  off(event: string, callback: EventCallback): void {
    const callbacks = this.subscriptions.get(event);
    if (callbacks === undefined) {
      return;
    }
    callbacks.delete(callback);
    if (callbacks.size === 0) {
      this.subscriptions.delete(event);
    }
  }

  private async openConnection(isReconnectAttempt: boolean): Promise<void> {
    let socket: WebSocket | undefined;

    try {
      socket = new WebSocket(appendTokenToUrl(this.url, this.token));
      this.websocket = socket;
      if (isReconnectAttempt) {
        this.reconnectSockets.add(socket);
      }
      this.attachSocket(socket);
      this.setStatus("connecting");

      await this.waitForOpen(socket);
      this.setStatus("handshaking");
      if (this.backend === "channel") {
        await this.waitForWelcome();
      } else {
        await this.performOpenClawHandshake();
      }
      this.reconnectAttempts = 0;
      this.setStatus("connected");
      this.logger.info("gateway connected");
    } catch (error) {
      if (socket !== undefined && this.websocket === socket && socket.readyState !== WebSocket.CLOSED) {
        socket.terminate();
      }
      if (this.intentionalClose) {
        if (this.websocket === socket) {
          this.websocket = undefined;
        }
        this.setStatus("disconnected");
        return;
      }
      if (isReconnectAttempt) {
        this.logger.warn("gateway reconnect attempt failed", normalizeError(error));
        this.scheduleReconnect();
        return;
      }
      this.setStatus("error");
      throw normalizeError(error);
    }
  }

  private async performOpenClawHandshake(): Promise<void> {
    const challenge = await this.waitForChallenge();
    const seed = this.deviceSeed === undefined ? generateDeviceSeed() : new Uint8Array(this.deviceSeed);
    const connectArgs = {
      token: this.token,
      deviceSeed: seed,
      nonce: challenge.nonce,
      client: this.clientMetadata,
      role: this.role,
      scopes: this.scopes
    };
    const built = await buildConnectParams(
      this.deviceToken === undefined ? connectArgs : { ...connectArgs, deviceToken: this.deviceToken }
    );

    let response: JsonRecord;
    try {
      response = await this.sendRequest("connect", built.params, () => {
        return new HandshakeTimeoutError("Gateway handshake timed out waiting for connect response");
      });
    } catch (error) {
      if (error instanceof HandshakeTimeoutError) {
        throw error;
      }
      if (error instanceof GatewayError) {
        throw new HandshakeFailedError(error.message);
      }
      throw error;
    }

    const hello = assertHelloOkPayload(response);
    const maxPayload = maxPayloadFromHelloOk(hello);
    if (maxPayload !== undefined) {
      this.maxPayload = maxPayload;
    }
    const nextDeviceToken = deviceTokenFromHelloOk(hello);
    if (nextDeviceToken !== undefined) {
      this.deviceToken = nextDeviceToken;
      this.options.onDeviceToken?.(nextDeviceToken);
    }
  }

  private sendRequest(
    method: string,
    params: JsonRecord | undefined,
    timeoutError: (method: string, id: string) => GatewayError
  ): Promise<JsonRecord> {
    const socket = this.websocket;
    if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new NotConnectedError("Gateway WebSocket is not open"));
    }

    const id = this.nextRequestId();
    const frame: RequestFrame = params === undefined ? { type: "req", id, method } : { type: "req", id, method, params };
    const text = serializeRequestFrame(frame);

    return new Promise<JsonRecord>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(timeoutError(method, id));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });

      socket.send(text, (error?: Error | null) => {
        if (error === undefined || error === null) {
          return;
        }
        const pending = this.pending.get(id);
        if (pending !== undefined) {
          clearTimeout(pending.timer);
          this.pending.delete(id);
          pending.reject(error);
        }
      });
    });
  }

  private nextRequestId(): string {
    const id = `pd-${this.requestCounter}`;
    this.requestCounter += 1;
    return id;
  }

  private attachSocket(socket: WebSocket): void {
    socket.on("message", (data, isBinary) => this.handleMessage(data, isBinary));
    socket.on("close", (code, reason) => this.handleClose(socket, code, reason));
    socket.on("error", (error: Error | null | undefined) => {
      this.logger.warn("gateway websocket error", normalizeError(error, "Gateway WebSocket error"));
    });
  }

  private handleMessage(data: RawData, isBinary: boolean): void {
    if (isBinary) {
      return;
    }

    let frame;
    try {
      frame = parseFrameText(rawDataToText(data));
    } catch (error) {
      this.logger.warn("ignoring invalid gateway frame", error);
      return;
    }

    if (frame.type === "res") {
      this.handleResponse(frame);
      return;
    }
    if (isEventFrame(frame)) {
      this.handleEvent(frame);
    }
  }

  private handleResponse(frame: ResponseFrame): void {
    const pending = this.pending.get(frame.id);
    if (pending === undefined) {
      this.logger.trace("ignoring response for unknown request id", frame.id);
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(frame.id);
    if (frame.ok) {
      pending.resolve(frame.payload ?? {});
      return;
    }

    pending.reject(new GatewayError(frame.error?.code ?? "GATEWAY_ERROR", frame.error?.message ?? "Gateway request failed"));
  }

  private handleEvent(frame: EventFrame): void {
    if (frame.event === "connect.challenge") {
      if (isConnectChallengeFrame(frame)) {
        this.resolveChallenge(frame.payload);
      } else {
        this.rejectChallenge(new HandshakeFailedError("Gateway challenge did not include a nonce"));
      }
      return;
    }

    if (frame.event === "connect.welcome") {
      this.resolveWelcome();
      return;
    }

    const callbacks = this.subscriptions.get(frame.event);
    if (callbacks === undefined || callbacks.size === 0) {
      return;
    }

    for (const callback of [...callbacks]) {
      try {
        callback(frame.payload);
      } catch (error) {
        this.logger.error("gateway event callback failed", error);
      }
    }
  }

  private handleClose(socket: WebSocket, code: number, reasonBuffer: Buffer): void {
    if (this.websocket === socket) {
      this.websocket = undefined;
    }

    const statusAtClose = this.status;
    const reason = reasonBuffer.toString("utf8");
    const fatal = isFatalCloseCode(code);
    const error = fatal ? new FatalCloseError(code, reason) : new GatewayError("WEBSOCKET_CLOSED", "WebSocket closed");
    this.rejectHandshakeWaiters(error);
    this.rejectAllPending(error);

    if (this.intentionalClose) {
      this.setStatus("disconnected");
      return;
    }

    if (fatal) {
      this.logger.warn("gateway websocket closed with fatal code", code, reason);
      this.setStatus("error");
      return;
    }

    const shouldReconnect = statusAtClose === "connected" || this.reconnectSockets.has(socket);
    if (shouldReconnect) {
      this.logger.warn("gateway websocket closed; scheduling reconnect", code, reason);
      this.scheduleReconnect();
      return;
    }

    if (this.status !== "error") {
      this.setStatus("disconnected");
    }
  }

  private waitForOpen(socket: WebSocket): Promise<void> {
    if (socket.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: NodeJS.Timeout;
      const cleanup = (): void => {
        clearTimeout(timer);
        socket.off("open", onOpen);
        socket.off("close", onClose);
        socket.off("error", onError);
      };
      const settle = (error?: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (error === undefined) {
          resolve();
          return;
        }
        reject(error);
      };
      const onOpen = (): void => {
        settle();
      };
      const onClose = (code: number, reason: Buffer): void => {
        settle(isFatalCloseCode(code) ? new FatalCloseError(code, reason.toString("utf8")) : new GatewayError("WEBSOCKET_CLOSED", "WebSocket closed"));
      };
      const onError = (error: Error | null | undefined): void => {
        settle(normalizeError(error, "Gateway WebSocket error before open"));
      };
      timer = setTimeout(() => {
        settle(new HandshakeTimeoutError("Gateway socket open timed out"));
      }, this.requestTimeoutMs);

      socket.once("open", onOpen);
      socket.once("close", onClose);
      socket.once("error", onError);
    });
  }

  private waitForChallenge(): Promise<ConnectChallengePayload> {
    if (this.queuedChallenge !== undefined) {
      const challenge = this.queuedChallenge;
      this.queuedChallenge = undefined;
      return Promise.resolve(challenge);
    }

    return new Promise<ConnectChallengePayload>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.challengeWaiter?.timer === timer) {
          this.challengeWaiter = undefined;
        }
        reject(new HandshakeTimeoutError("Gateway handshake timed out waiting for connect.challenge"));
      }, this.requestTimeoutMs);
      this.challengeWaiter = { resolve, reject, timer };
    });
  }

  private waitForWelcome(): Promise<void> {
    if (this.queuedWelcome) {
      this.queuedWelcome = false;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.welcomeWaiter?.timer === timer) {
          this.welcomeWaiter = undefined;
        }
        reject(new HandshakeTimeoutError("Gateway handshake timed out waiting for connect.welcome"));
      }, this.requestTimeoutMs);
      this.welcomeWaiter = { resolve, reject, timer };
    });
  }

  private resolveChallenge(payload: ConnectChallengePayload): void {
    const waiter = this.challengeWaiter;
    if (waiter === undefined) {
      this.queuedChallenge = payload;
      return;
    }
    clearTimeout(waiter.timer);
    this.challengeWaiter = undefined;
    waiter.resolve(payload);
  }

  private rejectChallenge(error: Error): void {
    const waiter = this.challengeWaiter;
    if (waiter === undefined) {
      return;
    }
    clearTimeout(waiter.timer);
    this.challengeWaiter = undefined;
    waiter.reject(error);
  }

  private resolveWelcome(): void {
    const waiter = this.welcomeWaiter;
    if (waiter === undefined) {
      this.queuedWelcome = true;
      return;
    }
    clearTimeout(waiter.timer);
    this.welcomeWaiter = undefined;
    waiter.resolve();
  }

  private rejectHandshakeWaiters(error: Error): void {
    this.rejectChallenge(error);
    const waiter = this.welcomeWaiter;
    if (waiter !== undefined) {
      clearTimeout(waiter.timer);
      this.welcomeWaiter = undefined;
      waiter.reject(error);
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionalClose || this.reconnectTimer !== undefined) {
      return;
    }
    if (this.reconnectAttempts >= this.maxRetries) {
      this.logger.warn("gateway reconnect attempts exhausted");
      this.setStatus("error");
      return;
    }

    const attempt = this.reconnectAttempts + 1;
    this.reconnectAttempts = attempt;
    const delayMs = Math.min(this.reconnectBaseDelayMs * 2 ** (attempt - 1), this.reconnectMaxDelayMs);
    this.setStatus("connecting");
    this.logger.info("gateway reconnect scheduled", { attempt, delayMs });
    const timer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.openConnection(true).catch((error: unknown) => {
        if (this.intentionalClose) {
          return;
        }
        this.logger.warn("gateway reconnect attempt failed", normalizeError(error));
        this.scheduleReconnect();
      });
    }, delayMs);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
    this.reconnectTimer = timer;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private setStatus(next: ConnectionStatus): void {
    if (this.status === next) {
      return;
    }
    this.status = next;
    this.options.onStatusChange?.(next);
  }
}

/** Appends the operator token query param to a Gateway URL. */
export function appendTokenToUrl(url: string, token: string): string {
  const separator = url.includes("?") ? (url.endsWith("?") || url.endsWith("&") ? "" : "&") : "?";
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}

function isFatalCloseCode(code: number): boolean {
  return code === 1008 || (code >= 4000 && code <= 4999);
}

function normalizeError(error: unknown, fallback = "unknown gateway error"): Error {
  if (error instanceof Error) {
    return error;
  }
  if (error === null || error === undefined) {
    return new Error(fallback);
  }
  return new Error(String(error));
}

function rawDataToText(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  return data.toString("utf8");
}
