/**
 * Host-side navigation helpers for mini-apps.
 *
 * Why this module exists: mini-apps must NOT `import` from `expo-router`
 * directly. They live in their own pnpm workspace packages, and pnpm's
 * peer-dependency-graph resolution can land each workspace on a different
 * resolved copy of expo-router than the host app — same version number,
 * different module identity. Module-level singletons inside expo-router
 * (notably `storeRef.current.navigationRef`) only get initialised on the
 * copy the host app's `<Stack>` actually rendered, so a mini-app trying to
 * call `router.push(...)` from the *other* copy throws "Cannot read
 * property 'isReady' of undefined".
 *
 * Funnelling navigation through this module — which is part of the host
 * app and imports `expo-router` from the same physical copy as
 * `app/_layout.tsx` — guarantees a single navigation source of truth no
 * matter how many mini-apps the project gains.
 */

import { router } from "expo-router";

import { getConversationModeSurface } from "@/runtime/conversationModes";
import { useConversationStore } from "@/state/conversations";

/**
 * Open the registered surface for a specific conversation. Most modes use the
 * host's standard chat screen, but a mini-app can route its own conversations
 * to a custom surface by registering a route-backed conversation mode.
 */
export function openConversation(conversationId: string): void {
  const conversation = useConversationStore
    .getState()
    .list.find((item) => item.id === conversationId);
  if (conversation === undefined) {
    router.push({ pathname: "/chat/[id]", params: { id: conversationId } });
    return;
  }
  const surface = getConversationModeSurface(conversation.mode);
  if (surface.kind === "route") {
    router.push({
      pathname: surface.pathname as never,
      params: { id: conversationId }
    });
    return;
  }
  router.push({ pathname: "/chat/[id]", params: { id: conversationId } });
}

/**
 * Push the Tavern card detail screen for a given character-tavern path
 * (shape: "author/slug"). The catch-all route splits the slashes back
 * into segments automatically.
 */
export function openTavernCardDetail(path: string): void {
  const segments = path
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length === 0) return;
  router.push({ pathname: "/tavern/card/[...path]", params: { path: segments } });
}

/**
 * Push the Tavern settings screen. Used by both the browse-page header
 * gear and the first-time persona prompt in CardDetailScreen.
 */
export function openTavernSettings(): void {
  router.push("/tavern/settings");
}
