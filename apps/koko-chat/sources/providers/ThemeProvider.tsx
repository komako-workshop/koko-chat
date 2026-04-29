import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useAppColorScheme, useDeviceContext } from "twrnc";
import tw from "twrnc";

import { useSettingsStore } from "@/state/settings";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const darkMode = useSettingsStore((state) => state.darkMode);

  // One-shot device context registration. twrnc's hook mutates tw in place;
  // calling it once at mount with the initial scheme is enough.
  useDeviceContext(tw, {
    observeDeviceColorSchemeChanges: false,
    initialColorScheme: darkMode ? "dark" : "light"
  });

  const [, , setColorScheme] = useAppColorScheme(tw);

  // Pull setColorScheme through a ref so its identity changes don't retrigger
  // the effect. (twrnc returns a new setter on every render, which used to
  // create an infinite update loop: effect fires -> setState -> rerender ->
  // new setter -> effect fires again.)
  const setColorSchemeRef = useRef(setColorScheme);
  setColorSchemeRef.current = setColorScheme;

  useEffect(() => {
    setColorSchemeRef.current(darkMode ? "dark" : "light");
  }, [darkMode]);

  return <>{children}</>;
}
