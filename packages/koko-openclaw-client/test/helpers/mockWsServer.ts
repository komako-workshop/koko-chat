import { Buffer } from "node:buffer";
import type { AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import {
  isRequestFrame,
  parseFrameText,
  type EventFrame,
  type JsonRecord,
  type RequestFrame,
  type ResponseFrame
} from "../../src/frames";

type RequestPredicate = (request: RequestFrame) => boolean;

type RequestWaiter = {
  predicate: RequestPredicate;
  resolve: (request: RequestFrame) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

/** Options for the mock OpenClaw WebSocket server. */
export interface MockWsServerOptions {
  /** Automatically send `connect.challenge` after every connection. Defaults to true. */
  autoChallenge?: boolean;
  /** Nonce value or nonce factory for auto challenges. */
  challengeNonce?: string | ((connectionIndex: number) => string);
  /** Optional hook invoked after a client connects. */
  onConnection?: (socket: WebSocket, server: MockWsServer) => void | Promise<void>;
  /** Optional hook invoked for every request frame. */
  onRequest?: (request: RequestFrame, socket: WebSocket, server: MockWsServer) => void | Promise<void>;
}

/** Real WebSocket mock server used by client tests. */
export class MockWsServer {
  /** Base WebSocket URL. */
  readonly url: string;
  /** Requests received from clients. */
  readonly requests: RequestFrame[] = [];

  private readonly sockets: WebSocket[] = [];
  private readonly requestWaiters: RequestWaiter[] = [];

  private constructor(
    private readonly server: WebSocketServer,
    private readonly options: Required<Pick<MockWsServerOptions, "autoChallenge">> & Omit<MockWsServerOptions, "autoChallenge">,
    port: number
  ) {
    this.url = `ws://127.0.0.1:${port}`;
    server.on("connection", (socket) => {
      this.sockets.push(socket);
      this.handleConnection(socket);
    });
  }

  /** Starts a mock server on a random loopback port. */
  static async start(options: MockWsServerOptions = {}): Promise<MockWsServer> {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    if (typeof address === "string" || address === null) {
      await closeServer(server);
      throw new Error("mock WebSocket server did not bind to a TCP port");
    }
    return new MockWsServer(server, { ...options, autoChallenge: options.autoChallenge ?? true }, (address as AddressInfo).port);
  }

  /** Number of accepted client connections. */
  get connectionCount(): number {
    return this.sockets.length;
  }

  /** Sends a raw frame to a connected client. */
  sendFrame(frame: EventFrame | ResponseFrame, socket = this.latestSocket()): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(frame));
    }
  }

  /** Sends an event frame to a connected client. */
  sendEvent(event: string, payload: JsonRecord, socket = this.latestSocket()): void {
    this.sendFrame({ type: "event", event, payload }, socket);
  }

  /** Sends an ok response for a request id. */
  sendOk(id: string, payload: JsonRecord, socket = this.latestSocket()): void {
    this.sendFrame({ type: "res", id, ok: true, payload }, socket);
  }

  /** Sends an error response for a request id. */
  sendError(id: string, code: string, message: string, socket = this.latestSocket()): void {
    this.sendFrame({ type: "res", id, ok: false, error: { code, message } }, socket);
  }

  /** Waits for the next request, optionally filtered by method. */
  waitForRequest(method?: string, timeoutMs = 500): Promise<RequestFrame> {
    const predicate: RequestPredicate = method === undefined ? () => true : (request) => request.method === method;
    const existingIndex = this.requests.findIndex(predicate);
    if (existingIndex >= 0) {
      const existing = this.requests.splice(existingIndex, 1)[0];
      if (existing !== undefined) {
        return Promise.resolve(existing);
      }
    }

    return new Promise<RequestFrame>((resolve, reject) => {
      const waiter: RequestWaiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.removeWaiter(waiter);
          reject(new Error("request wait timed out"));
        }, timeoutMs)
      };
      this.requestWaiters.push(waiter);
    });
  }

  /** Closes the newest connected client with a close frame. */
  closeLatest(code = 1000, reason = ""): void {
    const socket = this.latestSocket();
    if (socket.readyState === WebSocket.OPEN) {
      socket.close(code, reason);
    } else {
      socket.terminate();
    }
  }

  /** Terminates the newest connected client without a close frame. */
  terminateLatest(): void {
    this.latestSocket().terminate();
  }

  /** Closes clients and the server. */
  async close(): Promise<void> {
    for (const waiter of this.requestWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("mock server closed"));
    }
    this.requestWaiters.length = 0;
    for (const socket of this.sockets) {
      if (socket.readyState !== WebSocket.CLOSED) {
        socket.terminate();
      }
    }
    await closeServer(this.server);
  }

  private handleConnection(socket: WebSocket): void {
    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        return;
      }
      this.handleTextMessage(rawDataToText(data), socket);
    });

    if (this.options.autoChallenge) {
      const index = this.sockets.length;
      const nonce =
        typeof this.options.challengeNonce === "function"
          ? this.options.challengeNonce(index)
          : this.options.challengeNonce ?? `nonce-${index}`;
      this.sendEvent("connect.challenge", { nonce }, socket);
    }
    void this.options.onConnection?.(socket, this);
  }

  private handleTextMessage(text: string, socket: WebSocket): void {
    let frame;
    try {
      frame = parseFrameText(text);
    } catch {
      return;
    }
    if (!isRequestFrame(frame)) {
      return;
    }

    const waiterIndex = this.requestWaiters.findIndex((waiter) => waiter.predicate(frame));
    if (waiterIndex >= 0) {
      const waiter = this.requestWaiters.splice(waiterIndex, 1)[0];
      if (waiter !== undefined) {
        clearTimeout(waiter.timer);
        waiter.resolve(frame);
      }
    } else {
      this.requests.push(frame);
    }
    void this.options.onRequest?.(frame, socket, this);
  }

  private removeWaiter(waiter: RequestWaiter): void {
    const index = this.requestWaiters.indexOf(waiter);
    if (index >= 0) {
      this.requestWaiters.splice(index, 1);
    }
  }

  private latestSocket(): WebSocket {
    const socket = this.sockets.at(-1);
    if (socket === undefined) {
      throw new Error("mock server has no connected WebSocket clients");
    }
    return socket;
  }
}

/** Waits until a condition returns a non-nullish value. */
export async function waitFor<T>(fn: () => T | null | undefined | false, timeoutMs = 500): Promise<T> {
  const startedAt = Date.now();
  for (;;) {
    const value = fn();
    if (value !== null && value !== undefined && value !== false) {
      return value;
    }
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await delay(5);
  }
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

function closeServer(server: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
