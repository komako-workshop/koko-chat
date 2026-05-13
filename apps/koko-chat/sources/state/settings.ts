import { create } from "zustand";
import { persist } from "zustand/middleware";

import { createMmkvStorage } from "@/storage/persist";

/**
 * Minimal settings state. KokoChat is single-theme (light) and does not
 * expose appearance toggles, so the store is intentionally tiny. New
 * persisted settings should go here.
 */
export interface SettingsState {
  /** Internal counter retained for future onboarding tap-to-reveal hooks. */
  internalNoop: number;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    () => ({
      internalNoop: 0
    }),
    { name: "koko-settings", storage: createMmkvStorage<SettingsState>() }
  )
);
