// qrcode-terminal is a CommonJS package without proper ESM named exports,
// so we import the default and pull `generate` off of it at runtime.
import qrcodeTerminal from "qrcode-terminal";

/** Render a pairing URL as a small terminal QR code. */
export function renderQrToStdout(url: string): void {
  qrcodeTerminal.generate(url, { small: true });
}
