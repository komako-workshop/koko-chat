/**
 * Web shim for MMKV on Expo Web.
 * Metro's resolver picks `.web.ts` over `.ts` for platform 'web', so this
 * replaces sources/storage/mmkv.ts automatically in the web bundle.
 *
 * React Native Mmkv is a JSI native module — it doesn't exist in the
 * browser bundle. We back the same API with localStorage so everything
 * downstream (zustand persist, identityStorage.ts, settings store) keeps
 * working without branching.
 */

class LocalStorageShim {
  private readonly prefix: string;

  constructor(id: string) {
    this.prefix = `${id}:`;
  }

  private key(name: string): string {
    return `${this.prefix}${name}`;
  }

  getString(name: string): string | undefined {
    const value = typeof localStorage !== "undefined" ? localStorage.getItem(this.key(name)) : null;
    return value === null ? undefined : value;
  }

  set(name: string, value: string | boolean | number): void {
    if (typeof localStorage === "undefined") {
      return;
    }
    localStorage.setItem(this.key(name), String(value));
  }

  delete(name: string): void {
    if (typeof localStorage === "undefined") {
      return;
    }
    localStorage.removeItem(this.key(name));
  }

  getBoolean(name: string): boolean | undefined {
    const raw = this.getString(name);
    if (raw === undefined) return undefined;
    return raw === "true";
  }

  getNumber(name: string): number | undefined {
    const raw = this.getString(name);
    if (raw === undefined) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  contains(name: string): boolean {
    return this.getString(name) !== undefined;
  }

  getAllKeys(): string[] {
    if (typeof localStorage === "undefined") return [];
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key !== null && key.startsWith(this.prefix)) {
        keys.push(key.slice(this.prefix.length));
      }
    }
    return keys;
  }

  clearAll(): void {
    if (typeof localStorage === "undefined") return;
    for (const key of this.getAllKeys()) {
      this.delete(key);
    }
  }
}

export const mmkv = new LocalStorageShim("koko-app");
