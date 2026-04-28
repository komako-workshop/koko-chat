import { createJSONStorage, type PersistStorage, type StateStorage } from "zustand/middleware";

import { mmkv } from "./mmkv";

const storage: StateStorage<void> = {
  getItem: (name) => mmkv.getString(name) ?? null,
  setItem: (name, value) => mmkv.set(name, value),
  removeItem: (name) => mmkv.delete(name)
};

export function createMmkvStorage<State>(): PersistStorage<State> | undefined {
  return createJSONStorage<State>(() => storage);
}

export const mmkvStorage = createMmkvStorage<unknown>();
