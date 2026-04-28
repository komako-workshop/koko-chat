import { WebSocket, type RawData } from "ws";

type MessageWaiter = {
  resolve(text: string): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
};

type CloseWaiter = {
  resolve(): void;
  timer: NodeJS.Timeout;
};

/** Minimal WebSocket client for relay integration tests. */
export class TestWsClient {
  private messages: string[] = [];
  private messageWaiters: MessageWaiter[] = [];
  private closeWaiters: CloseWaiter[] = [];
  private closed = false;

  private constructor(private readonly websocket: WebSocket) {
    websocket.on("message", (data, isBinary) => this.handleMessage(data, isBinary));
    websocket.on("close", () => this.handleClose());
    websocket.on("error", (error: Error) => this.rejectPending(error));
  }

  /** Connects to a WebSocket URL. */
  static connect(url: string): Promise<TestWsClient> {
    return new Promise((resolve, reject) => {
      const websocket = new WebSocket(url);
      const timeout = setTimeout(() => {
        websocket.terminate();
        reject(new Error("websocket connect timed out"));
      }, 500);

      const rejectOnce = (error: Error): void => {
        clearTimeout(timeout);
        websocket.terminate();
        reject(error);
      };

      websocket.once("error", rejectOnce);
      websocket.once("unexpected-response", (_request, response) => {
        rejectOnce(new Error(`websocket upgrade failed: HTTP/${response.httpVersion} ${response.statusCode}`));
      });
      websocket.once("open", () => {
        clearTimeout(timeout);
        websocket.off("error", rejectOnce);
        resolve(new TestWsClient(websocket));
      });
    });
  }

  /** Sends a raw text message. */
  sendText(text: string): void {
    if (this.websocket.readyState === WebSocket.OPEN) {
      this.websocket.send(text);
    }
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
    this.websocket.close(1000);
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

  private handleMessage(data: RawData, isBinary: boolean): void {
    if (isBinary) {
      return;
    }
    const waiter = this.messageWaiters.shift();
    const text = rawDataToText(data);
    if (waiter !== undefined) {
      clearTimeout(waiter.timer);
      waiter.resolve(text);
    } else {
      this.messages.push(text);
    }
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
