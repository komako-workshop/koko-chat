import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { decodeEnvelope, encodeEnvelope, EnvelopeSchema, PROTOCOL_VERSION } from "@koko/protocol";
import type { Logger } from "pino";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { RoomEntry, RoomStore } from "./store";
import { HelloMessageSchema, oppositeRole, type ManagedWebSocket, type PeerLeftReason, type RoomRole } from "./types";

const closeBadRequest = 4400;
const closeGone = 4410;

type TextHandler = (text: string) => void;
type CloseHandler = (reason: PeerLeftReason) => void;

interface RoomSession {
  roomId: string;
  role: RoomRole;
}

/** Options for the WebSocket room handler. */
export interface RoomWebSocketHandlerOptions {
  /** Room state store. */
  roomStore: RoomStore;
  /** Structured logger. */
  logger: Logger;
  /** Ping interval in milliseconds. */
  heartbeatIntervalMs?: number;
  /** Maximum time since last pong before closing a socket. */
  heartbeatTimeoutMs?: number;
  /** Interval used to expire inactive rooms. */
  roomCleanupIntervalMs?: number;
}

class ManagedRoomSocket implements ManagedWebSocket {
  readonly id = randomUUID();
  private closed = false;
  private closeReason: PeerLeftReason = "closed";
  private lastPongAt = Date.now();
  private resolveClosed: () => void = () => undefined;
  private readonly closedPromise = new Promise<void>((resolve) => {
    this.resolveClosed = resolve;
  });
  private readonly textHandlers = new Set<TextHandler>();
  private readonly closeHandlers = new Set<CloseHandler>();

  constructor(
    private readonly websocket: WebSocket,
    private readonly logger: Logger
  ) {
    websocket.on("message", (data, isBinary) => this.handleMessage(data, isBinary));
    websocket.on("close", () => this.handleClosed());
    websocket.on("error", (error: Error) => {
      if (this.closeReason === "closed") {
        this.closeReason = "error";
      }
      this.logger.warn(error, "websocket socket error");
    });
    websocket.on("pong", () => {
      this.lastPongAt = Date.now();
    });
  }

  sendText(text: string): void {
    if (!this.isOpen()) {
      return;
    }
    this.websocket.send(text, (error) => {
      if (error !== undefined) {
        this.logger.warn(error, "failed to send websocket message");
      }
    });
  }

  ping(): void {
    if (this.isOpen()) {
      this.websocket.ping();
    }
  }

  close(code = 1000, reason = ""): void {
    if (this.closed || this.websocket.readyState === WebSocket.CLOSED) {
      return;
    }
    this.websocket.close(code, reason);
  }

  closeAsTimeout(): void {
    this.closeReason = "timeout";
    this.close(4000, "heartbeat timeout");
  }

  isOpen(): boolean {
    return this.websocket.readyState === WebSocket.OPEN;
  }

  getLastPongAt(): number {
    return this.lastPongAt;
  }

  waitClosed(): Promise<void> {
    return this.closedPromise;
  }

  onText(handler: TextHandler): void {
    this.textHandlers.add(handler);
  }

  onClose(handler: CloseHandler): void {
    this.closeHandlers.add(handler);
  }

  private handleMessage(data: RawData, isBinary: boolean): void {
    if (isBinary) {
      this.close(1003, "unsupported frame");
      return;
    }
    const text = rawDataToText(data);
    for (const handler of this.textHandlers) {
      handler(text);
    }
  }

  private handleClosed(): void {
    if (!this.closed) {
      this.closed = true;
    }
    for (const handler of this.closeHandlers) {
      handler(this.closeReason);
    }
    this.textHandlers.clear();
    this.closeHandlers.clear();
    this.resolveClosed();
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

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sendHelloError(socket: ManagedRoomSocket, error: string, message: string): void {
  socket.sendText(
    JSON.stringify({
      type: "hello-error",
      error,
      message
    })
  );
  socket.close(closeBadRequest, error);
}

function closeWebSocketServer(wss: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    wss.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

/** Handles WebSocket upgrades and room message routing. */
export class RoomWebSocketHandler {
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly sockets = new Set<ManagedRoomSocket>();
  private readonly sessions = new Map<ManagedRoomSocket, RoomSession>();
  private readonly logger: Logger;
  private readonly heartbeatTimer: NodeJS.Timeout;
  private readonly roomCleanupTimer: NodeJS.Timeout;
  private readonly heartbeatTimeoutMs: number;

  constructor(private readonly options: RoomWebSocketHandlerOptions) {
    this.logger = options.logger.child({ module: "room.handler" });
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 90_000;
    this.heartbeatTimer = setInterval(() => this.heartbeat(), options.heartbeatIntervalMs ?? 30_000);
    this.roomCleanupTimer = setInterval(() => this.expireRooms(), options.roomCleanupIntervalMs ?? 1_000);
    this.heartbeatTimer.unref();
    this.roomCleanupTimer.unref();
  }

  /** Accepts a WebSocket upgrade for /v1/room/:roomId. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, roomId: string): void {
    this.wss.handleUpgrade(req, socket, head, (websocket) => {
      this.handleConnection(websocket, roomId);
    });
  }

  /** Closes all active sockets and stops timers. */
  async close(): Promise<void> {
    clearInterval(this.heartbeatTimer);
    clearInterval(this.roomCleanupTimer);
    const sockets = [...this.sockets];
    for (const socket of sockets) {
      socket.close(1001, "server closing");
    }
    await Promise.all(sockets.map((socket) => socket.waitClosed()));
    await closeWebSocketServer(this.wss);
    this.sockets.clear();
    this.sessions.clear();
  }

  private handleConnection(websocket: WebSocket, roomId: string): void {
    const roomSocket = new ManagedRoomSocket(websocket, this.logger.child({ connectionId: randomUUID() }));
    this.sockets.add(roomSocket);
    roomSocket.onText((text) => this.handleText(roomSocket, roomId, text));
    roomSocket.onClose((reason) => this.handleClose(roomSocket, reason));
  }

  private handleText(socket: ManagedRoomSocket, urlRoomId: string, text: string): void {
    const session = this.sessions.get(socket);
    if (session === undefined) {
      this.handleHello(socket, urlRoomId, text);
      return;
    }
    this.handleEnvelope(socket, session, text);
  }

  private handleHello(socket: ManagedRoomSocket, urlRoomId: string, text: string): void {
    const raw = parseJsonObject(text);
    if (raw === null) {
      this.logger.warn({ roomId: urlRoomId }, "ignoring invalid JSON before hello");
      return;
    }
    if (raw.protocolVersion !== PROTOCOL_VERSION) {
      sendHelloError(socket, "protocol_mismatch", `protocolVersion must be ${PROTOCOL_VERSION}`);
      return;
    }
    const parsed = HelloMessageSchema.safeParse(raw);
    if (!parsed.success || parsed.data.roomId !== urlRoomId) {
      sendHelloError(socket, "room_not_found", "room was not found");
      return;
    }

    const result = this.options.roomStore.registerConnection(urlRoomId, parsed.data.role, socket);
    if (!result.ok) {
      const messageByError = {
        room_not_found: "room was not found",
        room_expired: "room has expired",
        role_conflict: "role is already connected"
      } satisfies Record<typeof result.error, string>;
      sendHelloError(socket, result.error, messageByError[result.error]);
      return;
    }

    this.sessions.set(socket, { roomId: urlRoomId, role: parsed.data.role });
    socket.sendText(JSON.stringify({ type: "hello-ok", roomId: urlRoomId }));
    this.notifyPeerJoined(result.room, parsed.data.role);
    this.flushOfflineQueue(socket, urlRoomId, parsed.data.role);
  }

  private handleEnvelope(socket: ManagedRoomSocket, session: RoomSession, text: string): void {
    const raw = parseJsonObject(text);
    if (raw === null) {
      this.logger.warn({ roomId: session.roomId, role: session.role }, "ignoring invalid JSON message");
      return;
    }
    if (raw.type !== "envelope") {
      this.logger.warn({ roomId: session.roomId, role: session.role }, "ignoring unsupported room message");
      return;
    }
    const envelopeResult = EnvelopeSchema.safeParse(raw.envelope);
    if (!envelopeResult.success) {
      socket.sendText(JSON.stringify({ type: "envelope-error", reason: "invalid_envelope" }));
      return;
    }
    const envelope = decodeEnvelope(encodeEnvelope(envelopeResult.data));
    if (envelope.roomId !== session.roomId) {
      socket.sendText(JSON.stringify({ type: "envelope-error", reason: "room_mismatch" }));
      return;
    }

    const targetRole = oppositeRole(session.role);
    const room = this.options.roomStore.getRoom(session.roomId);
    if (room === undefined) {
      socket.close(closeGone, "room expired");
      return;
    }
    const peer = this.options.roomStore.getConnection(room, targetRole);
    if (peer !== undefined) {
      peer.sendText(JSON.stringify({ type: "envelope", envelope }));
      return;
    }
    this.options.roomStore.enqueue(session.roomId, targetRole, envelope);
  }

  private handleClose(socket: ManagedRoomSocket, reason: PeerLeftReason): void {
    this.sockets.delete(socket);
    const session = this.sessions.get(socket);
    if (session === undefined) {
      return;
    }
    this.sessions.delete(socket);
    this.options.roomStore.unregisterConnection(session.roomId, session.role, socket);
    const room = this.options.roomStore.getRoom(session.roomId);
    if (room === undefined) {
      return;
    }
    const peer = this.options.roomStore.getConnection(room, oppositeRole(session.role));
    if (peer !== undefined) {
      peer.sendText(
        JSON.stringify({
          type: "peer-left",
          role: session.role,
          reason
        })
      );
    }
  }

  private notifyPeerJoined(room: RoomEntry, joinedRole: RoomRole): void {
    const peer = this.options.roomStore.getConnection(room, oppositeRole(joinedRole));
    if (peer !== undefined) {
      peer.sendText(JSON.stringify({ type: "peer-joined", role: joinedRole }));
    }
  }

  private flushOfflineQueue(socket: ManagedWebSocket, roomId: string, role: RoomRole): void {
    for (const envelope of this.options.roomStore.flush(roomId, role)) {
      socket.sendText(JSON.stringify({ type: "envelope", envelope }));
    }
  }

  private heartbeat(): void {
    const now = Date.now();
    for (const socket of this.sockets) {
      if (now - socket.getLastPongAt() > this.heartbeatTimeoutMs) {
        socket.closeAsTimeout();
        continue;
      }
      socket.ping();
    }
  }

  private expireRooms(): void {
    for (const expired of this.options.roomStore.expireInactiveRooms()) {
      this.logger.info({ roomId: expired.roomId }, "room expired");
      for (const socket of expired.sockets) {
        socket.close(closeGone, "room expired");
      }
    }
  }
}
