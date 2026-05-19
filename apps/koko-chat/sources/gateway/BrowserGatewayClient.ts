/**
 * Browser / React Native WebSocket Gateway client for KokoChat APP.
 *
 * Why not use @koko/openclaw-client directly?
 * That package uses the `ws` npm library (Node-only) and Node's `Buffer`
 * and EventEmitter API. Those don't work in RN or in the browser. Here we
 * reuse the protocol layer (handshake / frames / device / errors / types)
 * from @koko/openclaw-client but swap the transport to `globalThis.WebSocket`.
 *
 * This is intentionally minimal for tonight's demo:
 * - No reconnect, no offline queue, no heartbeat.
 * - Just: open socket, handshake, call(), on('chat'), disconnect.
 */

import {
  type ConnectionStatus,
  type EventCallback,
  type GatewayClientMetadata,
  type Logger,
  DEFAULT_ROLE,
  DEFAULT_SCOPES,
  assertHelloOkPayload,
  deviceTokenFromHelloOk,
  maxPayloadFromHelloOk,
  type EventFrame,
  type JsonRecord,
  type ResponseFrame,
  parseFrameText,
  buildConnectParams
} from "@koko/openclaw-client/protocol";

import { kokoGatewayClientMetadata } from "@/gateway/clientMetadata";

/** Options accepted by {@link BrowserGatewayClient}. */
export interface BrowserGatewayClientOptions {
  /** Full ws:// or wss:// URL. */
  url: string;
  /** Gateway shared token, used by trusted local clients. */
  token?: string;
  /** Bootstrap token from the setup code (for first-time device pairing). */
  bootstrapToken?: string;
  /** Optional persisted device token from a previous successful handshake. */
  deviceToken?: string;
  /** Persistent 32-byte Ed25519 device seed. */
  deviceSeed: Uint8Array;
  /** Client metadata sent in `connect`. */
  client?: Partial<GatewayClientMetadata>;
  /** Scopes to request. Defaults to DEFAULT_SCOPES. */
  scopes?: readonly string[];
  /** Logger. Defaults to noop. */
  logger?: Logger;
  /** Called when connection status changes. */
  onStatusChange?: (status: ConnectionStatus) => void;
  /** Called when hello-ok returns a new deviceToken. */
  onDeviceToken?: (deviceToken: string) => void;
  /**
   * Connect / call timeout in ms. Default 3600000 (1 hour).
   *
   * Long-form Gateway methods such as `agent.wait` may legitimately keep a
   * single RPC open for the duration of an agent run that includes tool calls,
   * planning steps, or external API hops. Setting this below the longest
   * legitimate agent turn produces spurious "request <method> timed out"
   * errors at the client even though the server is still working. One hour is
   * intentionally generous for mobile use: long OpenClaw runs should finish
   * naturally instead of being killed by the host app first.
   */
  requestTimeoutMs?: number;
}

interface PendingRequest {
  resolve: (payload: JsonRecord) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const noopLogger: Logger = {
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

/** Browser/RN-compatible Gateway client. Minimal: open, handshake, call, on. */
export class BrowserGatewayClient {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = "disconnected";
  private pendingRequests = new Map<string, PendingRequest>();
  private eventHandlers = new Map<string, Set<EventCallback>>();
  private nextId = 1;
  private connectNonce: string | null = null;
  private maxPayload = 1_048_576;

  private readonly options: BrowserGatewayClientOptions;
  private readonly logger: Logger;

  constructor(options: BrowserGatewayClientOptions) {
    this.options = options;
    this.logger = options.logger ?? noopLogger;
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getMaxPayload(): number {
    return this.maxPayload;
  }

  async connect(): Promise<void> {
    if (this.status === "connected" || this.status === "connecting") {
      return;
    }
    this.setStatus("connecting");

    const ws = new WebSocket(this.options.url);
    this.ws = ws;
    ws.onmessage = (event) => this.handleMessage(event.data);
    ws.onerror = (event) => {
      this.logger.warn("ws error", event);
    };
    ws.onclose = (event) => {
      this.logger.info("ws closed", { code: event.code, reason: event.reason });
      this.setStatus("disconnected");
      this.ws = null;
      this.rejectAllPending(new Error(`websocket closed: ${event.code}`));
    };

    await new Promise<void>((resolve, reject) => {
      const onOpen = (): void => {
        ws.removeEventListener("open", onOpen);
        ws.removeEventListener("error", onErrorEvent);
        resolve();
      };
      const onErrorEvent = (): void => {
        ws.removeEventListener("open", onOpen);
        ws.removeEventListener("error", onErrorEvent);
        reject(new Error("websocket failed to open"));
      };
      ws.addEventListener("open", onOpen);
      ws.addEventListener("error", onErrorEvent);
    });

    this.setStatus("handshaking");
    await this.performHandshake();
    this.setStatus("connected");
  }

  async disconnect(): Promise<void> {
    this.rejectAllPending(new Error("disconnect"));
    const ws = this.ws;
    if (ws !== null && ws.readyState === WebSocket.OPEN) {
      ws.close(1000, "client disconnect");
    }
    this.ws = null;
    this.setStatus("disconnected");
  }

  async call(method: string, params?: JsonRecord): Promise<JsonRecord> {
    if (this.status !== "connected" || this.ws === null) {
      throw new Error(`not connected (status=${this.status})`);
    }
    return this.sendRequest(method, params);
  }

  on(event: string, callback: EventCallback): () => void {
    let set = this.eventHandlers.get(event);
    if (set === undefined) {
      set = new Set();
      this.eventHandlers.set(event, set);
    }
    set.add(callback);
    return () => {
      set?.delete(callback);
    };
  }

  private async performHandshake(): Promise<void> {
    // Wait for connect.challenge event
    const challenge = await this.waitForChallenge();
    this.connectNonce = challenge.nonce;

    const clientMeta: GatewayClientMetadata = {
      ...kokoGatewayClientMetadata(),
      ...this.options.client
    };

    const params = await this.buildConnectRequestParams({
      nonce: challenge.nonce,
      client: clientMeta
    });

    const response = await this.sendRequest("connect", params);
    const hello = assertHelloOkPayload(response);

    const maxPayload = maxPayloadFromHelloOk(hello);
    if (maxPayload !== undefined) {
      this.maxPayload = maxPayload;
    }

    const deviceToken = deviceTokenFromHelloOk(hello);
    if (deviceToken !== undefined) {
      this.options.onDeviceToken?.(deviceToken);
    }

    this.logger.info("gateway handshake complete");
  }

  private async buildConnectRequestParams({
    nonce,
    client
  }: {
    nonce: string;
    client: GatewayClientMetadata;
  }): Promise<JsonRecord> {
    const role = DEFAULT_ROLE;
    const scopes = [...(this.options.scopes ?? DEFAULT_SCOPES)];

    const { params } = await buildConnectParams({
      ...(this.options.token !== undefined ? { token: this.options.token } : {}),
      ...(this.options.bootstrapToken !== undefined ? { bootstrapToken: this.options.bootstrapToken } : {}),
      ...(this.options.deviceToken !== undefined ? { deviceToken: this.options.deviceToken } : {}),
      deviceSeed: this.options.deviceSeed,
      nonce,
      client,
      role,
      scopes
    });
    return params;
  }

  private waitForChallenge(): Promise<{ nonce: string }> {
    return new Promise((resolve, reject) => {
      // Connection handshake is short by nature (a single nonce round-trip),
      // so it deliberately keeps the original 30s ceiling instead of
      // following the long requestTimeoutMs used for agent runs.
      const timer = setTimeout(() => {
        reject(new Error("timed out waiting for connect.challenge"));
      }, 30_000);

      const listener = (payload: JsonRecord): void => {
        if (typeof payload.nonce !== "string") {
          return;
        }
        clearTimeout(timer);
        this.eventHandlers.get("connect.challenge")?.delete(listener);
        resolve({ nonce: payload.nonce });
      };
      let set = this.eventHandlers.get("connect.challenge");
      if (set === undefined) {
        set = new Set();
        this.eventHandlers.set("connect.challenge", set);
      }
      set.add(listener);
    });
  }

  private sendRequest(method: string, params?: JsonRecord): Promise<JsonRecord> {
    if (this.ws === null || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("ws not open"));
    }
    const id = `koko-${this.nextId++}`;
    const frame = params === undefined ? { type: "req", id, method } : { type: "req", id, method, params };

    return new Promise<JsonRecord>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`request ${method} timed out`));
      }, this.options.requestTimeoutMs ?? 3_600_000);
      this.pendingRequests.set(id, { resolve, reject, timer });
      this.ws!.send(JSON.stringify(frame));
    });
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") {
      this.logger.warn("ignoring non-string message");
      return;
    }
    let frame;
    try {
      frame = parseFrameText(data);
    } catch (error) {
      this.logger.warn("invalid frame", error);
      return;
    }

    if (frame.type === "res") {
      this.handleResponse(frame);
      return;
    }
    if (frame.type === "event") {
      this.handleEvent(frame);
    }
  }

  private handleResponse(frame: ResponseFrame): void {
    const pending = this.pendingRequests.get(frame.id);
    if (pending === undefined) {
      return;
    }
    clearTimeout(pending.timer);
    this.pendingRequests.delete(frame.id);
    if (frame.ok) {
      pending.resolve(frame.payload ?? {});
    } else {
      const message = frame.error?.message ?? "gateway error";
      pending.reject(new Error(message));
    }
  }

  private handleEvent(frame: EventFrame): void {
    const set = this.eventHandlers.get(frame.event);
    if (set === undefined) {
      return;
    }
    for (const callback of set) {
      try {
        callback(frame.payload);
      } catch (error) {
        this.logger.error("event callback threw", error);
      }
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) {
      return;
    }
    this.status = status;
    this.options.onStatusChange?.(status);
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pendingRequests.delete(id);
    }
  }
}
