/** Pairing request stored by the relay until the CLI polls authorization. */
export interface PairingRequestEntry {
  /** CLI ephemeral box public key, base64url encoded. */
  publicKey: string;
  /** Creation time in epoch milliseconds. */
  createdAt: number;
  /** Expiration time in epoch milliseconds. */
  expiresAt: number;
  /** App encrypted response bundle, stored opaquely. */
  response?: string;
  /** Room created once the app authorizes the request. */
  roomId?: string;
}

/** Result of adding an app response to a pairing request. */
export type AuthorizePairingResult =
  | { ok: true; entry: PairingRequestEntry }
  | { ok: false; error: "request_not_found" | "already_authorized" };

/** In-memory pairing request store with TTL cleanup. */
export class PairingStore {
  private readonly entries = new Map<string, PairingRequestEntry>();
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(private readonly ttlMs: number) {
    const intervalMs = Math.max(1_000, Math.min(ttlMs, 60_000));
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), intervalMs);
    this.cleanupTimer.unref();
  }

  /** Returns an existing unexpired request or creates a fresh pending one. */
  getOrCreate(publicKey: string, now = Date.now()): PairingRequestEntry {
    const existing = this.entries.get(publicKey);
    if (existing !== undefined && existing.expiresAt > now) {
      return existing;
    }
    if (existing !== undefined) {
      this.entries.delete(publicKey);
    }
    const entry: PairingRequestEntry = {
      publicKey,
      createdAt: now,
      expiresAt: now + this.ttlMs
    };
    this.entries.set(publicKey, entry);
    return entry;
  }

  /** Adds the app encrypted response and room id to an existing request. */
  authorize(publicKey: string, response: string, roomId: string, now = Date.now()): AuthorizePairingResult {
    const entry = this.entries.get(publicKey);
    if (entry === undefined || entry.expiresAt <= now) {
      this.entries.delete(publicKey);
      return { ok: false, error: "request_not_found" };
    }
    if (entry.response !== undefined || entry.roomId !== undefined) {
      return { ok: false, error: "already_authorized" };
    }
    entry.response = response;
    entry.roomId = roomId;
    return { ok: true, entry };
  }

  /** Deletes a pairing request by public key. */
  delete(publicKey: string): void {
    this.entries.delete(publicKey);
  }

  /** Returns the number of currently stored pairing requests after cleanup. */
  size(now = Date.now()): number {
    this.cleanupExpired(now);
    return this.entries.size;
  }

  /** Deletes all expired requests. */
  cleanupExpired(now = Date.now()): void {
    for (const [publicKey, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(publicKey);
      }
    }
  }

  /** Stops background cleanup and clears the store. */
  close(): void {
    clearInterval(this.cleanupTimer);
    this.entries.clear();
  }
}
