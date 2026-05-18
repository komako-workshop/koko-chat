import type { ReactNode } from "react";
import { useEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { useGatewayStore } from "@/state/gateway";

export function AppStateProvider({ children }: { children: ReactNode }) {
  const reconnectIfPossible = useGatewayStore((s) => s.reconnectIfPossible);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status: AppStateStatus) => {
      if (status === "active") {
        void reconnectIfPossible();
      }
    });

    return () => subscription.remove();
  }, [reconnectIfPossible]);

  return <>{children}</>;
}
