/**
 * Tavern persona store.
 *
 * "Persona" is the SillyTavern term for "who the user is roleplaying as in
 * a chat" — i.e. what name a roleplay character should call them. Cards
 * are shipped with `{{user}}` placeholders peppered through their
 * description and first_mes; we substitute that placeholder with the
 * persona's name everywhere a card text is shown or sent to the agent.
 *
 * Scope: global across all Tavern roleplay conversations. A future
 * enhancement could allow per-conversation overrides; for v1 the
 * overwhelmingly common case is "the character should call me <name>"
 * once, set and forget.
 *
 * This store lives in the host workspace (rather than next to the rest of
 * the Tavern mini-app code) so that mini-apps that depend on it — both
 * `tavern/mobile` and `tavern-roleplay/mobile` — can import it through
 * the `@/state/tavernPersona` alias without taking a direct dependency
 * on `zustand`. Storage uses the host's per-mini-app MMKV namespace
 * (the same one `tavern-roleplay` uses for cached cards) keyed at
 * `persona`, so the on-disk shape is owned by the Tavern mini-app
 * conceptually but the React store is shared infrastructure.
 */
import { create } from "zustand";

import { getMiniAppStorage } from "@/runtime/miniAppStorage";

const STORAGE = getMiniAppStorage("tavern");
const KEY = "persona";

interface PersonaPayload {
  name?: string;
}

interface TavernPersonaState {
  name: string;
  /** True after `rehydrate()` has run at least once. */
  hydrated: boolean;
  rehydrate(): void;
  setName(name: string): void;
  clear(): void;
}

export const useTavernPersonaStore = create<TavernPersonaState>((set) => ({
  name: "",
  hydrated: false,
  rehydrate() {
    const stored = STORAGE.getJson<PersonaPayload>(KEY);
    const name = typeof stored?.name === "string" ? stored.name.trim() : "";
    set({ name, hydrated: true });
  },
  setName(name) {
    const trimmed = name.trim();
    STORAGE.setJson<PersonaPayload>(KEY, { name: trimmed });
    set({ name: trimmed });
  },
  clear() {
    STORAGE.delete(KEY);
    set({ name: "" });
  }
}));

/**
 * Synchronously read the persona name without subscribing — useful from
 * non-React code paths (outbound message builder, fast-path bootstrap).
 */
export function getTavernPersonaName(): string {
  return useTavernPersonaStore.getState().name;
}

/**
 * Resolve a persona name suitable for substituting into character text.
 * Falls back to a safe Chinese default so cards with `{{user}}` in their
 * first_mes never render the literal placeholder to the user.
 *
 * `forPrompt`:
 *   - `true`  → "用户" (used in agent prompts; LLMs respect a real noun
 *                better than "你", which it can mistake for second-person
 *                self-address)
 *   - `false` → "你" (used in user-facing previews; reads naturally as
 *                "you, walking up the steps…")
 */
export function resolvePersonaName(forPrompt = false): string {
  const stored = getTavernPersonaName();
  if (stored.length > 0) return stored;
  return forPrompt ? "用户" : "你";
}
