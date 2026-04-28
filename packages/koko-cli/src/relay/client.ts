import { decodeEnvelope, encodeEnvelope, EnvelopeSchema, PROTOCOL_VERSION, type Envelope } from "@koko/protocol";
import type { Logger } from "pino";
import { WebSocket, type RawData } from "ws";

/** Peer lifecycle events emitted by the relay. */
export type PeerEvent = {
  /** Event type reported by relay. */
  type: "peer-joined" | "peer-left";
  /** Role that joined or left. */
  role: "app" | "cli";
  /** Close reason for peer-left events. */
  reason?: string;
};

/** Options for opening a CLI room WebSocket. */
export interface RoomConnectionOptions {
  /** Base ws:// or wss:// relay URL. */
  wsBaseUrl: string;
  /** Room ID assigned by pairing. */
  roomId: string;
  /** CLI role for Task 03b. */
  role: "cli";
  /** Structured logger. */
  logger: Logger;
  /** Called for each non-internal envelope received. */
  onEnvelope: (envelope: Envelope) => void | Promise<void>;
  /** Called on peer-joined and peer-left relay events. */
  onPeerEvent?: (event: PeerEvent) => void;
  /** Called on hello-error or fatal close. */
  onFatal: (reason: string) => void;
  /** Optional abort signal for Ctrl+C and tests. */
  signal?: AbortSignal;
}

/** Active relay room WebSocket connection. */
export interface RoomConnection {
  /** Send a validated envelope to the peer. Throws if the socket is not open. */
  sendEnvelope(envelope: Envelope): void;
  /** Close the WebSocket cleanly and wait for close. */
  close(): Promise<void>;
  /** Resolves when the WebSocket is fully closed. */
  readonly closed: Promise<void>;
}

function abortError(): DOMException {
  return new DOMException("Operation aborted", "AbortError");
}

function roomUrl(wsBaseUrl: string, roomId: string): string {
  return `${wsBaseUrl.replace(/\/$/, "")}/v1/room/${encodeURIComponent(roomId)}`;
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

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function reasonText(reason: Buffer): string {
  return reason.toString("utf8");
}

function isRole(value: unknown): value is "app" | "cli" {
  return value === "app" || value === "cli";
}

function isPeerEventMessage(value: Record<string, unknown>): value is PeerEvent {
  return (value.type === "peer-joined" || value.type === "peer-left") && isRole(value.role);
}

/** Open a ws room connection with hello handshake. Rejects on hello-error. */
export async function connectRoom(options: RoomConnectionOptions): Promise<RoomConnection> {
  if (options.signal?.aborted === true) {
    throw abortError();
  }

  const logger = options.logger.child({ module: "relay.client", roomId: options.roomId });
  const websocket = new WebSocket(roomUrl(options.wsBaseUrl, options.roomId));
  let helloComplete = false;
  let settled = false;
  let closeRequested = false;
  let openTimer: NodeJS.Timeout | undefined = undefined;
  let resolveClosed: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const connection: RoomConnection = {
    sendEnvelope(envelope: Envelope): void {
      if (websocket.readyState !== WebSocket.OPEN || !helloComplete) {
        throw new Error("room websocket is not connected");
      }
      const validatedEnvelope = EnvelopeSchema.parse(JSON.parse(encodeEnvelope(envelope)) as unknown);
      websocket.send(JSON.stringify({ type: "envelope", envelope: validatedEnvelope }));
    },

    close(): Promise<void> {
      closeRequested = true;
      if (websocket.readyState === WebSocket.CLOSED) {
        return closed;
      }
      if (websocket.readyState === WebSocket.CONNECTING) {
        websocket.terminate();
        return closed;
      }
      websocket.close(1000, "client closing");
      return closed;
    },

    closed
  };

  return await new Promise<RoomConnection>((resolve, reject) => {
    const cleanupBeforeSettle = (): void => {
      if (openTimer !== undefined) {
        clearTimeout(openTimer);
        openTimer = undefined;
      }
      options.signal?.removeEventListener("abort", onAbort);
    };

    const rejectOnce = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanupBeforeSettle();
      closeRequested = true;
      if (websocket.readyState === WebSocket.CONNECTING || websocket.readyState === WebSocket.OPEN) {
        websocket.close(1000, "connect failed");
      }
      reject(error);
    };

    const resolveOnce = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanupBeforeSettle();
      resolve(connection);
    };

    const handleRoomMessage = async (message: Record<string, unknown>): Promise<void> => {
      if (message.type === "envelope") {
        try {
          const envelope = decodeEnvelope(JSON.stringify(message.envelope));
          await options.onEnvelope(envelope);
        } catch (error) {
          logger.warn(error instanceof Error ? error : { error }, "failed to handle relay envelope");
        }
        return;
      }
      if (isPeerEventMessage(message)) {
        options.onPeerEvent?.(message);
        return;
      }
      if (message.type === "hello-error") {
        const reason = typeof message.error === "string" ? message.error : "hello_error";
        options.onFatal(reason);
        return;
      }
      if (message.type === "envelope-error") {
        logger.warn({ reason: message.reason }, "relay rejected envelope");
        return;
      }
      logger.warn({ type: message.type }, "ignoring unsupported relay message");
    };

    const onAbort = (): void => {
      closeRequested = true;
      if (!settled) {
        rejectOnce(abortError());
      }
      void connection.close();
    };

    websocket.on("open", () => {
      websocket.send(JSON.stringify({
        type: "hello",
        role: options.role,
        roomId: options.roomId,
        protocolVersion: PROTOCOL_VERSION
      }));
    });

    websocket.on("message", (data, isBinary) => {
      if (isBinary) {
        logger.warn("ignoring binary websocket message");
        return;
      }
      const message = parseJsonObject(rawDataToText(data));
      if (message === null) {
        logger.warn("ignoring invalid relay JSON message");
        return;
      }
      if (!helloComplete) {
        if (message.type === "hello-ok") {
          helloComplete = true;
          resolveOnce();
          return;
        }
        if (message.type === "hello-error") {
          const reason = typeof message.error === "string" ? message.error : "hello_error";
          options.onFatal(reason);
          rejectOnce(new Error(`relay hello failed: ${reason}`));
          return;
        }
        logger.warn({ type: message.type }, "ignoring message before hello-ok");
        return;
      }
      queueMicrotask(() => {
        void handleRoomMessage(message);
      });
    });

    websocket.on("close", (code, reason) => {
      if (openTimer !== undefined) {
        clearTimeout(openTimer);
        openTimer = undefined;
      }
      options.signal?.removeEventListener("abort", onAbort);
      resolveClosed();
      if (!settled) {
        rejectOnce(new Error(`websocket closed before hello: ${code} ${reasonText(reason)}`));
        return;
      }
      if (!closeRequested && code !== 1000 && code !== 1001) {
        options.onFatal(`websocket closed: ${code} ${reasonText(reason)}`.trim());
      }
    });

    websocket.on("error", (error: Error) => {
      if (!settled) {
        rejectOnce(error);
        return;
      }
      logger.warn(error, "room websocket error");
    });

    openTimer = setTimeout(() => {
      rejectOnce(new Error("websocket hello timed out"));
    }, 5_000);

    options.signal?.addEventListener("abort", onAbort, { once: true });
  });
}
