import type { ReactNode } from "react";
import { useEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { useGatewayStore } from "@/state/gateway";

export function AppStateProvider({ children }: { children: ReactNode }) {
  const status = useGatewayStore((s) => s.status);
  const reconnectIfPossible = useGatewayStore((s) => s.reconnectIfPossible);
  const syncPendingConversations = useGatewayStore((s) => s.syncPendingConversations);

  useEffect(() => {
    let cancelled = false;
    async function recoverGatewayState(options?: { force?: boolean }): Promise<void> {
      const connected = await reconnectIfPossible(options);
      if (cancelled || !connected) return;
      await syncPendingConversations();
    }

    void recoverGatewayState();

    let previousState: AppStateStatus = AppState.currentState;
    const subscription = AppState.addEventListener("change", (status: AppStateStatus) => {
      const wasBackground = previousState === "background";
      previousState = status;
      if (status === "active") {
        void recoverGatewayState({ force: wasBackground });
      }
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [reconnectIfPossible, syncPendingConversations]);

  useEffect(() => {
    if (status !== "disconnected" && status !== "error") return;
    if (AppState.currentState !== "active") return;

    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      void (async () => {
        const connected = await reconnectIfPossible();
        if (cancelled || !connected) return;
        await syncPendingConversations();
      })();
    }, 750);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [status, reconnectIfPossible, syncPendingConversations]);

  return <>{children}</>;
}
