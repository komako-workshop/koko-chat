import type { Envelope } from "@koko/protocol";
import type { ManagedWebSocket, QueuedEnvelope, RoomRole } from "./types";

/** Mutable in-memory room entry. */
export interface RoomEntry {
  /** UUID room id. */
  roomId: string;
  /** Creation time in epoch milliseconds. */
  createdAt: number;
  /** Last room activity in epoch milliseconds. */
  lastActivityAt: number;
  /** Active sockets keyed by role. */
  connections: Map<RoomRole, ManagedWebSocket>;
  /** Offline queues keyed by target role. */
  offlineQueues: Record<RoomRole, QueuedEnvelope[]>;
}

/** Result returned when registering a role connection. */
export type RegisterConnectionResult =
  | { ok: true; room: RoomEntry }
  | { ok: false; error: "room_not_found" | "room_expired" | "role_conflict" };

/** Expired room with sockets that should be actively closed by the caller. */
export interface ExpiredRoom {
  /** Room id being removed. */
  roomId: string;
  /** Active sockets that were still connected when the room expired. */
  sockets: ManagedWebSocket[];
}

/** In-memory room store with inactive-room TTL and per-role offline queues. */
export class RoomStore {
  private readonly rooms = new Map<string, RoomEntry>();
  private order = 0;

  constructor(
    private readonly roomTtlMs: number,
    private readonly offlineQueueMax: number,
    private readonly offlineQueueTtlMs: number
  ) {}

  /** Creates a new empty room. */
  createRoom(roomId: string, now = Date.now()): RoomEntry {
    const room: RoomEntry = {
      roomId,
      createdAt: now,
      lastActivityAt: now,
      connections: new Map<RoomRole, ManagedWebSocket>(),
      offlineQueues: {
        cli: [],
        app: []
      }
    };
    this.rooms.set(roomId, room);
    return room;
  }

  /** Registers a role connection when the room exists and no same-role peer is online. */
  registerConnection(
    roomId: string,
    role: RoomRole,
    socket: ManagedWebSocket,
    now = Date.now()
  ): RegisterConnectionResult {
    const room = this.rooms.get(roomId);
    if (room === undefined) {
      return { ok: false, error: "room_not_found" };
    }
    if (this.isExpired(room, now)) {
      this.rooms.delete(roomId);
      return { ok: false, error: "room_expired" };
    }
    const existing = room.connections.get(role);
    if (existing !== undefined && existing.isOpen()) {
      return { ok: false, error: "role_conflict" };
    }
    if (existing !== undefined) {
      room.connections.delete(role);
    }
    room.connections.set(role, socket);
    this.touch(room, now);
    return { ok: true, room };
  }

  /** Removes a role connection if it still points at the given socket. */
  unregisterConnection(roomId: string, role: RoomRole, socket: ManagedWebSocket, now = Date.now()): void {
    const room = this.rooms.get(roomId);
    if (room === undefined) {
      return;
    }
    if (room.connections.get(role) === socket) {
      room.connections.delete(role);
      this.touch(room, now);
    }
  }

  /** Gets an unexpired room, deleting it when it has expired. */
  getRoom(roomId: string, now = Date.now()): RoomEntry | undefined {
    const room = this.rooms.get(roomId);
    if (room === undefined) {
      return undefined;
    }
    if (this.isExpired(room, now)) {
      this.rooms.delete(roomId);
      return undefined;
    }
    return room;
  }

  /** Gets the currently connected socket for a role, if any. */
  getConnection(room: RoomEntry, role: RoomRole): ManagedWebSocket | undefined {
    const socket = room.connections.get(role);
    if (socket === undefined || !socket.isOpen()) {
      room.connections.delete(role);
      return undefined;
    }
    return socket;
  }

  /** Queues an envelope for a target role, enforcing TTL and max length. */
  enqueue(roomId: string, targetRole: RoomRole, envelope: Envelope, now = Date.now()): void {
    const room = this.getRoom(roomId, now);
    if (room === undefined) {
      return;
    }
    this.cleanupQueue(room, targetRole, now);
    room.offlineQueues[targetRole].push({
      envelope,
      order: this.order,
      queuedAt: now,
      expiresAt: now + this.offlineQueueTtlMs
    });
    this.order += 1;
    while (room.offlineQueues[targetRole].length > this.offlineQueueMax) {
      room.offlineQueues[targetRole].shift();
    }
    this.touch(room, now);
  }

  /** Flushes and clears queued envelopes for a role in ascending sequence order. */
  flush(roleRoomId: string, targetRole: RoomRole, now = Date.now()): Envelope[] {
    const room = this.getRoom(roleRoomId, now);
    if (room === undefined) {
      return [];
    }
    this.cleanupQueue(room, targetRole, now);
    const queue = room.offlineQueues[targetRole].splice(0);
    this.touch(room, now);
    return queue
      .sort((left, right) => {
        const seqDelta = left.envelope.seq - right.envelope.seq;
        return seqDelta === 0 ? left.order - right.order : seqDelta;
      })
      .map((item) => item.envelope);
  }

  /** Expires inactive rooms and removes them from the store. */
  expireInactiveRooms(now = Date.now()): ExpiredRoom[] {
    const expired: ExpiredRoom[] = [];
    for (const [roomId, room] of this.rooms) {
      if (this.isExpired(room, now)) {
        expired.push({
          roomId,
          sockets: [...room.connections.values()]
        });
        this.rooms.delete(roomId);
      }
    }
    return expired;
  }

  /** Returns the number of live rooms after expiration cleanup. */
  size(now = Date.now()): number {
    this.expireInactiveRooms(now);
    return this.rooms.size;
  }

  /** Returns the active WebSocket connection count. */
  activeConnections(): number {
    let count = 0;
    for (const room of this.rooms.values()) {
      for (const socket of room.connections.values()) {
        if (socket.isOpen()) {
          count += 1;
        }
      }
    }
    return count;
  }

  /** Returns all active sockets across all rooms. */
  sockets(): ManagedWebSocket[] {
    const sockets: ManagedWebSocket[] = [];
    for (const room of this.rooms.values()) {
      for (const socket of room.connections.values()) {
        if (socket.isOpen()) {
          sockets.push(socket);
        }
      }
    }
    return sockets;
  }

  /** Clears all room state. */
  clear(): void {
    this.rooms.clear();
  }

  private isExpired(room: RoomEntry, now: number): boolean {
    return room.lastActivityAt + this.roomTtlMs <= now;
  }

  private touch(room: RoomEntry, now: number): void {
    room.lastActivityAt = now;
  }

  private cleanupQueue(room: RoomEntry, role: RoomRole, now: number): void {
    room.offlineQueues[role] = room.offlineQueues[role].filter((entry) => entry.expiresAt > now);
  }
}
