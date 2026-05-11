import { mmkv } from "@/storage/mmkv";

export interface MiniAppStorage {
  getString(key: string): string | undefined;
  getJson<T = unknown>(key: string): T | undefined;
  set(key: string, value: string | boolean | number): void;
  setJson<T = unknown>(key: string, value: T): void;
  delete(key: string): void;
  keys(): string[];
  clear(): void;
}

export function getMiniAppStorage(miniAppId: string): MiniAppStorage {
  const prefix = `miniapp.${normalizeMiniAppId(miniAppId)}.`;

  function namespaced(key: string): string {
    const normalized = key.trim();
    if (normalized.length === 0) throw new Error("mini-app storage key is empty");
    return `${prefix}${normalized}`;
  }

  return {
    getString(key) {
      return mmkv.getString(namespaced(key));
    },
    getJson<T = unknown>(key: string): T | undefined {
      const raw = mmkv.getString(namespaced(key));
      if (raw === undefined) return undefined;
      return JSON.parse(raw) as T;
    },
    set(key, value) {
      mmkv.set(namespaced(key), value);
    },
    setJson<T = unknown>(key: string, value: T): void {
      mmkv.set(namespaced(key), JSON.stringify(value));
    },
    delete(key) {
      mmkv.delete(namespaced(key));
    },
    keys() {
      return mmkv
        .getAllKeys()
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length));
    },
    clear() {
      for (const key of mmkv.getAllKeys()) {
        if (key.startsWith(prefix)) mmkv.delete(key);
      }
    }
  };
}

function normalizeMiniAppId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) throw new Error("mini-app id is empty");
  return normalized;
}
