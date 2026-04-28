const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BASE64URL_LOOKUP = new Map<string, number>(
  Array.from(BASE64URL_ALPHABET, (char, index) => [char, index])
);

/** Encodes bytes as unpadded base64url. */
export function encodeBase64Url(bytes: Uint8Array): string {
  let output = "";

  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset] ?? 0;
    const second = bytes[offset + 1] ?? 0;
    const third = bytes[offset + 2] ?? 0;
    const remaining = bytes.length - offset;
    const chunk = (first << 16) | (second << 8) | third;

    output += BASE64URL_ALPHABET[(chunk >> 18) & 0x3f];
    output += BASE64URL_ALPHABET[(chunk >> 12) & 0x3f];

    if (remaining > 1) {
      output += BASE64URL_ALPHABET[(chunk >> 6) & 0x3f];
    }

    if (remaining > 2) {
      output += BASE64URL_ALPHABET[chunk & 0x3f];
    }
  }

  return output;
}

/** Decodes unpadded base64url into bytes. */
export function decodeBase64Url(value: string): Uint8Array {
  if (value.length === 0 || value.length % 4 === 1) {
    throw new Error("invalid base64url");
  }

  let accumulator = 0;
  let bitCount = 0;
  const bytes: number[] = [];

  for (const char of value) {
    const digit = BASE64URL_LOOKUP.get(char);
    if (digit === undefined) {
      throw new Error("invalid base64url");
    }

    accumulator = (accumulator << 6) | digit;
    bitCount += 6;

    while (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((accumulator >> bitCount) & 0xff);
    }
  }

  const unusedMask = (1 << bitCount) - 1;
  if (bitCount > 0 && (accumulator & unusedMask) !== 0) {
    throw new Error("invalid base64url");
  }

  return Uint8Array.from(bytes);
}
