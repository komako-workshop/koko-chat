/** Concatenates byte arrays without relying on Buffer. */
export function concatBytes(...chunks: readonly Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}

/** Returns a defensive copy of a byte slice. */
export function sliceBytes(bytes: Uint8Array, start: number, end?: number): Uint8Array {
  return bytes.slice(start, end);
}

/** Asserts that a value is exactly the byte length required by a primitive. */
export function assertByteLength(name: string, bytes: Uint8Array, expectedLength: number): void {
  if (bytes.length !== expectedLength) {
    throw new RangeError(`${name} must be ${expectedLength} bytes`);
  }
}
