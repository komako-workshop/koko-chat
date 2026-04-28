import { randomBytes } from "node:crypto";
import { createConnection, type Socket } from "node:net";

type MessageWaiter = {
  resolve(text: string): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
};

type CloseWaiter = {
  resolve(): void;
  timer: NodeJS.Timeout;
};

type Frame = {
  opcode: number;
  payload: Buffer;
};

/** Minimal WebSocket client for relay integration tests. */
export class TestWsClient {
  private buffer = Buffer.alloc(0);
  private messages: string[] = [];
  private messageWaiters: MessageWaiter[] = [];
  private closeWaiters: CloseWaiter[] = [];
  private closed = false;

  private constructor(private readonly socket: Socket) {
    socket.on("data", (chunk: Buffer) => this.handleData(chunk));
    socket.on("close", () => this.handleClose());
    socket.on("error", (error: Error) => this.rejectPending(error));
  }

  /** Connects to a WebSocket URL. */
  static connect(url: string): Promise<TestWsClient> {
    const parsed = new URL(url);
    const port = Number(parsed.port || (parsed.protocol === "wss:" ? 443 : 80));
    const key = randomBytes(16).toString("base64");

    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: parsed.hostname, port });
      let handshakeBuffer = Buffer.alloc(0);
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("websocket connect timed out"));
      }, 500);

      const rejectOnce = (error: Error): void => {
        clearTimeout(timeout);
        socket.destroy();
        reject(error);
      };

      socket.once("error", rejectOnce);
      socket.on("connect", () => {
        const path = `${parsed.pathname}${parsed.search}`;
        socket.write(
          [
            `GET ${path} HTTP/1.1`,
            `Host: ${parsed.host}`,
            "Upgrade: websocket",
            "Connection: Upgrade",
            `Sec-WebSocket-Key: ${key}`,
            "Sec-WebSocket-Version: 13",
            "\r\n"
          ].join("\r\n")
        );
      });

      const onData = (chunk: Buffer): void => {
        handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
        const headerEnd = handshakeBuffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) {
          return;
        }
        clearTimeout(timeout);
        socket.off("data", onData);
        socket.off("error", rejectOnce);
        const header = handshakeBuffer.subarray(0, headerEnd).toString("utf8");
        if (!header.startsWith("HTTP/1.1 101")) {
          socket.destroy();
          reject(new Error(`websocket upgrade failed: ${header.split("\r\n")[0] ?? header}`));
          return;
        }
        const client = new TestWsClient(socket);
        const rest = handshakeBuffer.subarray(headerEnd + 4);
        if (rest.byteLength > 0) {
          client.handleData(rest);
        }
        resolve(client);
      };
      socket.on("data", onData);
    });
  }

  /** Sends a raw text message. */
  sendText(text: string): void {
    this.sendFrame(0x1, Buffer.from(text, "utf8"));
  }

  /** Sends a JSON text message. */
  sendJson(value: unknown): void {
    this.sendText(JSON.stringify(value));
  }

  /** Receives and parses the next JSON message. */
  async receiveJson(timeoutMs = 500): Promise<unknown> {
    const text = await this.receiveText(timeoutMs);
    return JSON.parse(text);
  }

  /** Receives the next text message. */
  receiveText(timeoutMs = 500): Promise<string> {
    const existing = this.messages.shift();
    if (existing !== undefined) {
      return Promise.resolve(existing);
    }
    if (this.closed) {
      return Promise.reject(new Error("websocket is closed"));
    }
    return new Promise((resolve, reject) => {
      const waiter: MessageWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.messageWaiters = this.messageWaiters.filter((item) => item !== waiter);
          reject(new Error("receive timed out"));
        }, timeoutMs)
      };
      this.messageWaiters.push(waiter);
    });
  }

  /** Closes the WebSocket and waits for the local socket to close. */
  close(): Promise<void> {
    if (this.closed) {
      return Promise.resolve();
    }
    this.sendFrame(0x8, Buffer.from([0x03, 0xe8]));
    return this.waitClosed();
  }

  /** Waits for the socket close event. */
  waitClosed(timeoutMs = 500): Promise<void> {
    if (this.closed) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const waiter: CloseWaiter = {
        resolve,
        timer: setTimeout(() => {
          this.closeWaiters = this.closeWaiters.filter((item) => item !== waiter);
          reject(new Error("close timed out"));
        }, timeoutMs)
      };
      this.closeWaiters.push(waiter);
    });
  }

  private handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const frame = this.readFrame();
      if (frame === null) {
        return;
      }
      this.handleFrame(frame);
    }
  }

  private handleFrame(frame: Frame): void {
    if (frame.opcode === 0x1) {
      const waiter = this.messageWaiters.shift();
      const text = frame.payload.toString("utf8");
      if (waiter !== undefined) {
        clearTimeout(waiter.timer);
        waiter.resolve(text);
      } else {
        this.messages.push(text);
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
    }
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
      payloadLength = Number(this.buffer.readBigUInt64BE(offset));
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
    if (this.closed) {
      return;
    }
    const mask = randomBytes(4);
    const length = payload.byteLength;
    let header: Buffer;
    if (length < 126) {
      header = Buffer.from([0x80 | opcode, 0x80 | length]);
    } else if (length <= 0xffff) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    const maskedPayload = Buffer.from(payload);
    for (let index = 0; index < maskedPayload.byteLength; index += 1) {
      const maskByte = mask[index % 4];
      if (maskByte !== undefined) {
        maskedPayload[index] = (maskedPayload[index] ?? 0) ^ maskByte;
      }
    }
    this.socket.write(Buffer.concat([header, mask, maskedPayload]));
  }

  private handleClose(): void {
    this.closed = true;
    for (const waiter of this.messageWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("websocket closed"));
    }
    this.messageWaiters = [];
    for (const waiter of this.closeWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
    this.closeWaiters = [];
  }

  private rejectPending(error: Error): void {
    for (const waiter of this.messageWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.messageWaiters = [];
  }
}
