/**
 * Sync-API KV store for KokoChat, backed by AsyncStorage on native and
 * localStorage on web.
 *
 * Why sync API on top of async storage on native: our identityStorage.ts and
 * zustand persist both expect a synchronous read at module load. We:
 *   1. Expose synchronous getString / set / delete that operate on an
 *      in-memory map.
 *   2. Hydrate the in-memory map from AsyncStorage at app start (see
 *      `hydrateStorage()` called from the root layout).
 *   3. Writes fire-and-forget to AsyncStorage in the background.
 *
 * Tradeoffs:
 *   - If the app reads a value before hydrate completes, it returns
 *     undefined. For our current usage (seed + device token) that's fine —
 *     we only read when the user clicks Pair, which is well after startup.
 *   - Writes could be lost on crash before the async flush. Acceptable for
 *     seed/token because the user can always re-pair.
 *
 * On web we skip the in-memory layer and hit localStorage directly (sync).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const PREFIX = "koko-app:";

const memory = new Map<string, string>();
let hydrated = false;
let hydratePromise: Promise<void> | null = null;

function prefixed(name: string): string {
  return `${PREFIX}${name}`;
}

/** Load all keys with our prefix from AsyncStorage into memory. Call once at startup. */
export async function hydrateStorage(): Promise<void> {
  if (hydrated) return;
  if (hydratePromise !== null) {
    await hydratePromise;
    return;
  }
  hydratePromise = (async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const ours = keys.filter((k) => k.startsWith(PREFIX));
      if (ours.length > 0) {
        const pairs = await AsyncStorage.multiGet(ours);
        for (const [key, value] of pairs) {
          if (value !== null) {
            memory.set(key.slice(PREFIX.length), value);
          }
        }
      }
    } catch (error) {
      console.warn("[koko] AsyncStorage hydrate failed", error);
    } finally {
      hydrated = true;
    }
  })();
  await hydratePromise;
}

function getStringNative(name: string): string | undefined {
  return memory.get(name);
}

function setNative(name: string, value: string | boolean | number): void {
  const stringValue = String(value);
  memory.set(name, stringValue);
  void AsyncStorage.setItem(prefixed(name), stringValue).catch((error) => {
    console.warn("[koko] AsyncStorage setItem failed", name, error);
  });
}

function deleteNative(name: string): void {
  memory.delete(name);
  void AsyncStorage.removeItem(prefixed(name)).catch((error) => {
    console.warn("[koko] AsyncStorage removeItem failed", name, error);
  });
}

function getAllKeysNative(): string[] {
  return [...memory.keys()];
}

function getStringWeb(name: string): string | undefined {
  if (typeof localStorage === "undefined") return undefined;
  const value = localStorage.getItem(prefixed(name));
  return value === null ? undefined : value;
}

function setWeb(name: string, value: string | boolean | number): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(prefixed(name), String(value));
}

function deleteWeb(name: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(prefixed(name));
}

function getAllKeysWeb(): string[] {
  if (typeof localStorage === "undefined") return [];
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key !== null && key.startsWith(PREFIX)) {
      keys.push(key.slice(PREFIX.length));
    }
  }
  return keys;
}

const isWeb = Platform.OS === "web";

/**
 * Sync KV store. API subset matches react-native-mmkv so existing callers
 * keep working without branching.
 */
export const mmkv = {
  getString(name: string): string | undefined {
    return isWeb ? getStringWeb(name) : getStringNative(name);
  },
  set(name: string, value: string | boolean | number): void {
    if (isWeb) setWeb(name, value);
    else setNative(name, value);
  },
  delete(name: string): void {
    if (isWeb) deleteWeb(name);
    else deleteNative(name);
  },
  getAllKeys(): string[] {
    return isWeb ? getAllKeysWeb() : getAllKeysNative();
  }
};
