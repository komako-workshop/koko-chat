import { registerExampleMiniApp } from "./example";
import { registerKokoMiniApp } from "./koko";
import { registerTavernMiniApp } from "../../../../miniapps/tavern/mobile";
import { registerTavernRoleplayMiniApp } from "../../../../miniapps/tavern-roleplay/mobile";

/**
 * Aggregate mini-app registration. `app/_layout.tsx` imports this module once
 * for its side effects so that block renderers and outbound builders exist
 * before any conversation renders. No dynamic loader is used; the mini-app
 * surface stays a static TypeScript boundary for v1 built-in mini-apps.
 */
export function registerMiniApps(): void {
  registerKokoMiniApp();
  registerExampleMiniApp();
  registerTavernMiniApp();
  registerTavernRoleplayMiniApp();
}
