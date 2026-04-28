/** Error thrown when an encrypted bundle cannot be authenticated or decoded. */
export class DecryptionError extends Error {
  /** Creates a decryption error with a stable name for callers and tests. */
  constructor(message: string) {
    super(message);
    this.name = "DecryptionError";
  }
}
