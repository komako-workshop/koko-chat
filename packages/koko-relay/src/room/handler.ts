import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { decodeEnvelope, encodeEnvelope, EnvelopeSchema, PROTOCOL_VERSION } from "@koko/protocol";
import type { pino } from "../logger";
import type { RoomEntry, RoomStore } from "./store";
import { HelloMessageSchema, oppositeRole, type ManagedWebSocket, type PeerLeftReason, type RoomRole } from "./types";

const websocketGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const closeBadRequest = 4400;
const closeGone = 4410;

type TextHandler = (text: string) => void;
type CloseHandler = (reason: PeerLeftReason) => void;
type Frame = { opcode: number; payload: Buffer };

interface RoomSession {
  roomId: string;
  role: RoomRole;
}

/** Options for the WebSocket room handler. */
export interface RoomWebSocketHandlerOptions {
  /** Room state store. */
  roomStore: RoomStore;
  /** Structured logger. */
  logger: pino.Logger;
  /** Ping interval in milliseconds. */
  heartbeatIntervalMs?: number;
  /** Maximum time since last pong before closing a socket. */
  heartbeatTimeoutMs?: number;
  /** Interval used to expire inactive rooms. */
  roomCleanupIntervalMs?: number;
}

class RoomSocket implements ManagedWebSocket {
  readonly id = randomUUID();
  private buffer = Buffer.alloc(0);
  private closed = false;
  private closeReason: PeerLeftReason = "closed";
  private resolveClosed: () => void = () => undefined;
  private readonly closedPromise = new Promise<void>((resolve) => {
    this.resolveClosed = resolve;
  });
  private readonly textHandlers = new Set<TextHandler>();
  private readonly closeHandlers = new Set<CloseHandler>();
  private lastPongAt = Date.now();

  constructor(
    private readonly socket: Socket,
    private readonly logger: pino.Logger
  ) {
    socket.on("data", (chunk: Buffer) => this.handleData(chunk));
    socket.on("close", () => this.handleClosed());
    socket.on("error", (error: Error) => {
      this.closeReason = "error";
      this.logger.warn(error, "websocket socket error");
    });
  }

  sendText(text: string): void {
    this.sendFrame(0x1, Buffer.from(text, "utf8"));
  }

  ping(): void {
    this.sendFrame(0x9, Buffer.alloc(0));
  }

  close(code = 1000, reason = ""): void {
    if (this.closed) {
      return;
    }
    const reasonBytes = Buffer.from(reason, "utf8");
    const payload = Buffer.alloc(2 + reasonBytes.byteLength);
    payload.writeUInt16BE(code, 0);
    reasonBytes.copy(payload, 2);
    this.sendFrame(0x8, payload);
    this.closed = true;
    this.socket.end();
  }

  closeAsTimeout(): void {
    this.closeReason = "timeout";
    this.close(4000, "heartbeat timeout");
  }

  isOpen(): boolean {
    return !this.closed && this.socket.writable;
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

  pushHead(head: Buffer): void {
    if (head.byteLength > 0) {
      this.handleData(head);
    }
  }

  private handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    try {
      for (;;) {
        const frame = this.readFrame();
        if (frame === null) {
          return;
        }
        this.handleFrame(frame);
      }
    } catch (error) {
      this.logger.warn(error instanceof Error ? error : { error }, "invalid websocket frame");
      this.close(1002, "protocol error");
    }
  }

  private handleFrame(frame: Frame): void {
    if (frame.opcode === 0x1) {
      const text = frame.payload.toString("utf8");
      for (const handler of this.textHandlers) {
        handler(text);
      }
      return;
    }
    if (frame.opcode === 0x8) {
      this.closed = true;
      this.socket.end();
      return;
    }
    if (frame.opcode === 0x9) {
      this.sendFrame(0xa, frame.payload);
      return;
    }
    if (frame.opcode === 0xa) {
      this.lastPongAt = Date.now();
      return;
    }
    this.close(1003, "unsupported frame");
  }

  private readFrame(): Frame | null {
    if (this.buffer.byteLength < 2) {
      return null;
    }
    const first = this.buffer[0];
    const second = this.buffer[1];
    if (first === undefined || second === undefined) {
      return null;
    }
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let payloadLength = second & 0x7f;
    let offset = 2;

    if (payloadLength === 126) {
      if (this.buffer.byteLength < offset + 2) {
        return null;
      }
      payloadLength = this.buffer.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLength === 127) {
      if (this.buffer.byteLength < offset + 8) {
        return null;
      }
      const largeLength = this.buffer.readBigUInt64BE(offset);
      if (largeLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("websocket frame too large");
      }
      payloadLength = Number(largeLength);
      offset += 8;
    }

    const maskLength = masked ? 4 : 0;
    const frameLength = offset + maskLength + payloadLength;
    if (this.buffer.byteLength < frameLength) {
      return null;
    }

    const mask = masked ? this.buffer.subarray(offset, offset + 4) : null;
    offset += maskLength;
    const payload = Buffer.from(this.buffer.subarray(offset, offset + payloadLength));
    this.buffer = this.buffer.subarray(frameLength);

    if (mask !== null) {
      for (let index = 0; index < payload.byteLength; index += 1) {
        const maskByte = mask[index % 4];
        if (maskByte !== undefined) {
          payload[index] = (payload[index] ?? 0) ^ maskByte;
        }
      }
    }

    return { opcode, payload };
  }

  private sendFrame(opcode: number, payload: Buffer): void {
    if (!this.isOpen() && opcode !== 0x8) {
      return;
    }
    const length = payload.byteLength;
    let header: Buffer;
    if (length < 126) {
      header = Buffer.from([0x80 | opcode, length]);
    } else if (length <= 0xffff) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    this.socket.write(Buffer.concat([header, payload]));
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

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sendHelloError(socket: RoomSocket, error: string, message: string): void {
  socket.sendText(
    JSON.stringify({
      type: "hello-error",
      error,
      message
    })
  );
  socket.close(closeBadRequest, error);
}

function acceptKey(key: string): string {
  return createHash("sha1").update(`${key}${websocketGuid}`).digest("base64");
}

function isValidWebSocketKey(key: string): boolean {
  return Buffer.from(key, "base64").byteLength === 16;
}

/** Handles WebSocket upgrades and room message routing. */
export class RoomWebSocketHandler {
  private readonly sockets = new Set<RoomSocket>();
  private readonly sessions = new Map<RoomSocket, RoomSession>();
  private readonly logger: pino.Logger;
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
  handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer, roomId: string): void {
    const keyHeader = req.headers["sec-websocket-key"];
    const versionHeader = req.headers["sec-websocket-version"];
    const key = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;
    const version = Array.isArray(versionHeader) ? versionHeader[0] : versionHeader;

    if (key === undefined || version !== "13" || !isValidWebSocketKey(key)) {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${acceptKey(key)}`,
        "\r\n"
      ].join("\r\n")
    );

    const roomSocket = new RoomSocket(socket, this.logger.child({ connectionId: randomUUID() }));
    this.sockets.add(roomSocket);
    roomSocket.onText((text) => this.handleText(roomSocket, roomId, text));
    roomSocket.onClose((reason) => this.handleClose(roomSocket, reason));
    roomSocket.pushHead(head);
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
    this.sockets.clear();
    this.sessions.clear();
  }

  private handleText(socket: RoomSocket, urlRoomId: string, text: string): void {
    const session = this.sessions.get(socket);
    if (session === undefined) {
      this.handleHello(socket, urlRoomId, text);
      return;
    }
    this.handleEnvelope(socket, session, text);
  }

  private handleHello(socket: RoomSocket, urlRoomId: string, text: string): void {
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

  private handleEnvelope(socket: RoomSocket, session: RoomSession, text: string): void {
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

  private handleClose(socket: RoomSocket, reason: PeerLeftReason): void {
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
