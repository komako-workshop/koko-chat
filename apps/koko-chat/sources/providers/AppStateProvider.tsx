import type { ReactNode } from "react";
import { useEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { useGatewayStore } from "@/state/gateway";

export function AppStateProvider({ children }: { children: ReactNode }) {
  const reconnectIfPossible = useGatewayStore((s) => s.reconnectIfPossible);
  const syncPendingConversations = useGatewayStore((s) => s.syncPendingConversations);

  useEffect(() => {
    let cancelled = false;
    async function recoverGatewayState(): Promise<void> {
      const connected = await reconnectIfPossible();
      if (cancelled || !connected) return;
      await syncPendingConversations();
    }

    void recoverGatewayState();

    const subscription = AppState.addEventListener("change", (status: AppStateStatus) => {
      if (status === "active") {
        void recoverGatewayState();
      }
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [reconnectIfPossible, syncPendingConversations]);

  return <>{children}</>;
}
