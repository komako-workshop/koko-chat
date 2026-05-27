import type { ReactNode } from "react";
import { useEffect } from "react";
import { AppState } from "react-native";

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

    let sawInactive = AppState.currentState !== "active";
    const subscription = AppState.addEventListener("change", (status) => {
      if (status !== "active") {
        sawInactive = true;
      }
      if (status === "active") {
        const wasInactive = sawInactive;
        sawInactive = false;
        void recoverGatewayState({ force: wasInactive });
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
    let reconnecting = false;

    const recover = (): void => {
      if (cancelled) return;
      if (reconnecting) return;
      reconnecting = true;
      void (async () => {
        try {
          const connected = await reconnectIfPossible();
          if (cancelled || !connected) return;
          await syncPendingConversations();
        } finally {
          reconnecting = false;
        }
      })();
    };

    const timer = setTimeout(recover, 750);
    const interval = setInterval(recover, 2_500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [status, reconnectIfPossible, syncPendingConversations]);

  return <>{children}</>;
}
