import { z } from "zod";
import { PROTOCOL_VERSION, type Envelope } from "@koko/protocol";

/** The only two roles allowed in an MVP room. */
export type RoomRole = "cli" | "app";

/** Runtime schema for room roles. */
export const RoomRoleSchema = z.enum(["cli", "app"]);

/** First client message required on a room WebSocket. */
export const HelloMessageSchema = z.object({
  type: z.literal("hello"),
  role: RoomRoleSchema,
  roomId: z.string().min(1),
  protocolVersion: z.literal(PROTOCOL_VERSION)
});

/** Parsed room hello message. */
export type HelloMessage = z.infer<typeof HelloMessageSchema>;

/** WebSocket envelope wrapper accepted after hello succeeds. */
export interface EnvelopeMessage {
  /** Message discriminator. */
  type: "envelope";
  /** Protocol envelope forwarded opaquely by relay. */
  envelope: Envelope;
}

/** Application-level close reason sent to a connected peer. */
export type PeerLeftReason = "closed" | "error" | "timeout";

/** Minimal WebSocket abstraction used by room storage and handler code. */
export interface ManagedWebSocket {
  /** Stable connection id used for diagnostics and conflict checks. */
  id: string;
  /** Sends a text frame if the socket is still open. */
  sendText(text: string): void;
  /** Sends a ping frame if the socket is still open. */
  ping(): void;
  /** Closes the socket with an application close code and reason. */
  close(code?: number, reason?: string): void;
  /** Whether the socket can still accept outgoing frames. */
  isOpen(): boolean;
}

/** Stored envelope waiting for the target role to reconnect. */
export interface QueuedEnvelope {
  /** Envelope payload to deliver. */
  envelope: Envelope;
  /** Insertion order used as a stable seq tie-breaker. */
  order: number;
  /** Queue insertion time in epoch milliseconds. */
  queuedAt: number;
  /** Expiration time in epoch milliseconds. */
  expiresAt: number;
}

/** Opposite side of a two-party room. */
export function oppositeRole(role: RoomRole): RoomRole {
  return role === "cli" ? "app" : "cli";
}
