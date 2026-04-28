import type { ReactNode } from "react";
import { useEffect } from "react";
import { useAppColorScheme, useDeviceContext } from "twrnc";
import tw from "twrnc";

import { useSettingsStore } from "@/state/settings";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const darkMode = useSettingsStore((state) => state.darkMode);

  useDeviceContext(tw, {
    observeDeviceColorSchemeChanges: false,
    initialColorScheme: darkMode ? "dark" : "light"
  });

  const [, , setColorScheme] = useAppColorScheme(tw);

  useEffect(() => {
    setColorScheme(darkMode ? "dark" : "light");
  }, [darkMode, setColorScheme]);

  return <>{children}</>;
}
