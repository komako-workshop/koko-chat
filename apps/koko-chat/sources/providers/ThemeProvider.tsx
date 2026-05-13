import type { ReactNode } from "react";
import { useDeviceContext } from "twrnc";
import tw from "twrnc";

/**
 * Forces twrnc into a single light scheme. KokoChat does not currently
 * expose a dark mode — the brand identity is built around the warm
 * off-white Koko palette in `theme/koko.ts`.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  useDeviceContext(tw, {
    observeDeviceColorSchemeChanges: false,
    initialColorScheme: "light"
  });

  return <>{children}</>;
}
