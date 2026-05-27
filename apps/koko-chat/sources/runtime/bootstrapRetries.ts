type BootstrapRetryHandler = (conversationId: string) => void | Promise<void>;

const retryHandlers: Record<string, BootstrapRetryHandler | undefined> = {};

export function registerBootstrapRetryHandler(
  mode: string,
  handler: BootstrapRetryHandler
): void {
  retryHandlers[mode] = handler;
}

export function getBootstrapRetryHandler(mode: string): BootstrapRetryHandler | undefined {
  return retryHandlers[mode];
}
