import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

interface KokoBackgroundTaskNativeModule {
  begin(name: string): Promise<string | null>;
  end(token: string): Promise<void>;
  getBackgroundTimeRemaining(): Promise<number>;
}

const NativeBackgroundTask = Platform.OS === "ios"
  ? requireOptionalNativeModule<KokoBackgroundTaskNativeModule>("KokoBackgroundTask")
  : null;

export function isBackgroundTaskAvailable(): boolean {
  return NativeBackgroundTask !== null;
}

export async function getBackgroundTimeRemaining(): Promise<number | null> {
  if (NativeBackgroundTask === null) return null;
  return NativeBackgroundTask.getBackgroundTimeRemaining();
}

export async function runWithBackgroundTask<T>(
  name: string,
  operation: () => Promise<T>
): Promise<T> {
  const token = await beginBackgroundTask(name);
  try {
    return await operation();
  } finally {
    if (token !== null) {
      await endBackgroundTask(token);
    }
  }
}

export function startBackgroundTask(name: string): () => void {
  let ended = false;
  let token: string | null = null;
  const tokenPromise = beginBackgroundTask(name);

  tokenPromise.then((resolvedToken) => {
    if (resolvedToken === null) return;
    if (ended) {
      void endBackgroundTask(resolvedToken);
      return;
    }
    token = resolvedToken;
  });

  return () => {
    if (ended) return;
    ended = true;
    if (token !== null) {
      void endBackgroundTask(token);
      token = null;
    }
  };
}

async function beginBackgroundTask(name: string): Promise<string | null> {
  if (NativeBackgroundTask === null) return null;
  try {
    return await NativeBackgroundTask.begin(name);
  } catch (error) {
    if (__DEV__) {
      console.warn(
        "[koko] failed to begin iOS background task:",
        error instanceof Error ? error.message : String(error)
      );
    }
    return null;
  }
}

async function endBackgroundTask(token: string): Promise<void> {
  if (NativeBackgroundTask === null) return;
  try {
    await NativeBackgroundTask.end(token);
  } catch (error) {
    if (__DEV__) {
      console.warn(
        "[koko] failed to end iOS background task:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}
