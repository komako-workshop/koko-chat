import type { ReactNode } from "react";
import { useEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";

export function AppStateProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status: AppStateStatus) => {
      // Task 04b will reconnect relay here if status === "active".
      // Task 04a only exposes the hook; no actual side effects yet.
      if (status === "active") {
        // Placeholder for future: check if paired, reconnect WS, re-fetch state.
      }
    });

    return () => subscription.remove();
  }, []);

  return <>{children}</>;
}
