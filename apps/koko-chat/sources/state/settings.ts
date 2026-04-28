import { create } from "zustand";
import { persist } from "zustand/middleware";

import { createMmkvStorage } from "@/storage/persist";

export interface SettingsState {
  darkMode: boolean;
  tapCount: number;
  toggleDarkMode: () => void;
  incrementTap: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      darkMode: false,
      tapCount: 0,
      toggleDarkMode: () => set((state) => ({ darkMode: !state.darkMode })),
      incrementTap: () => set((state) => ({ tapCount: state.tapCount + 1 }))
    }),
    { name: "koko-settings", storage: createMmkvStorage<SettingsState>() }
  )
);
