import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  View,
  useWindowDimensions
} from "react-native";
import tw from "twrnc";

import { CachedImage } from "@/components/CachedImage";
import type { BlockRenderer } from "@/runtime/messageBlocks";

import { type TavernRecommendationCard } from "./parseRecommendations";
import { startTavernRoleplaySession } from "../../tavern-roleplay/mobile";

/**
 * The card renders inside a `blockOnlyBubble` (transparent, no padding) sitting
 * in an `agentRow` with `maxWidth: 88%` and a 36px avatar slot. The chat
 * bubble has no explicit width — it grows to its intrinsic content size.
 *
 * Inside the card we use a `flex-row` Pressable with an 80px image + a
 * `flex-1` text column. Without an explicit width on the Pressable, the
 * `flex-1` column collapses to 0 because grow has nothing to grow into.
 * That's why the previous build looked "squashed": chips and text were
 * fighting for ~0px of usable space.
 *
 * We give the Pressable an explicit width based on the window width so the
 * text column has a real number to flex against. Clamped to leave room for
 * the avatar slot and stay readable on iPad / large displays.
 */
const CARD_WIDTH_RATIO = 0.78;
const CARD_WIDTH_MAX = 380;

/**
 * Single-card block. The Tavern mini-app emits one of these per recommended
 * character, interleaved with `kind: "text"` prose bubbles. The data shape
 * is exactly `TavernRecommendationCard` — there's no `reason` field; the
 * "why" lives in the preceding text bubble, in the agent's own voice.
 *
 * Tap behaviour: hand off to the `tavern-roleplay` mini-app, which fetches
 * the full Character Tavern card, translates the opening line to Chinese,
 * and creates a new conversation bound to that character. The user is
 * routed into the new conversation automatically.
 */
export const TavernCardBlock: BlockRenderer<TavernRecommendationCard> = ({ block }) => {
  return <RecommendationRow card={block.data} />;
};

function RecommendationRow({ card }: { card: TavernRecommendationCard }): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const { width: windowWidth } = useWindowDimensions();
  const cardWidth = Math.min(windowWidth * CARD_WIDTH_RATIO, CARD_WIDTH_MAX);

  function handlePress(): void {
    if (busy) return;
    // The press is a fire-and-forget: startTavernRoleplaySession creates
    // the conversation + navigates synchronously, then kicks off the
    // remote fetch + LLM translate in the background. The chat page
    // itself shows a loading banner until the card + first_mes are
    // ready.
    //
    // We gate with `busy` for one frame so a double-tap can't trigger
    // two duplicate conversations.
    setBusy(true);
    try {
      const path = pathFromPageUrl(card.pageUrl);
      if (path === null) {
        Alert.alert("无法打开", "这张卡缺少 Character Tavern 路径。");
        return;
      }
      startTavernRoleplaySession({
        path,
        pageUrl: card.pageUrl,
        imageUrl: card.imageUrl,
        name: card.name,
        nameZh: card.nameZh,
        tagline: card.tagline,
        taglineZh: card.taglineZh
      });
    } catch (error) {
      Alert.alert("无法打开角色", error instanceof Error ? error.message : String(error));
    } finally {
      // Release the press lock on the next macrotask so the conversation
      // route is already pushed before this component re-renders.
      setTimeout(() => setBusy(false), 0);
    }
  }

  return (
    <Pressable
      onPress={handlePress}
      disabled={busy}
      android_ripple={{ color: "#1f2937" }}
      style={[
        tw.style(
          "flex-row gap-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900",
          busy && "opacity-70"
        ),
        { width: cardWidth }
      ]}
    >
      <View style={tw`relative h-20 w-20`}>
        <CachedImage
          source={{ uri: card.imageUrl }}
          style={tw`h-20 w-20 rounded-xl bg-slate-200 dark:bg-slate-800`}
          contentFit="cover"
        />
        {busy ? (
          <View
            style={tw`absolute inset-0 items-center justify-center rounded-xl bg-black/40`}
          >
            <ActivityIndicator color="#ffffff" />
          </View>
        ) : null}
      </View>
      <View style={tw`flex-1`}>
        <View style={tw`flex-row items-center justify-between`}>
          <Text
            style={tw`flex-1 pr-2 text-base font-semibold text-slate-950 dark:text-slate-50`}
            numberOfLines={1}
          >
            {card.nameZh}
          </Text>
          {card.safety === "nsfw" ? (
            <View style={tw`rounded-full bg-rose-500/20 px-2 py-0.5`}>
              <Text style={tw`text-[10px] font-semibold text-rose-500`}>NSFW</Text>
            </View>
          ) : null}
        </View>
        <Text
          style={tw`mt-0.5 text-xs text-slate-500 dark:text-slate-400`}
          numberOfLines={1}
        >
          {card.name}
        </Text>
        <Text
          style={tw`mt-1.5 text-sm leading-5 text-slate-700 dark:text-slate-200`}
          numberOfLines={2}
        >
          {card.taglineZh}
        </Text>
        {card.matchTags.length > 0 ? (
          <View style={tw`mt-2 flex-row flex-wrap gap-1`}>
            {card.matchTags.map((tag, idx) => (
              <View
                key={`${tag}:${idx}`}
                style={tw`rounded-full bg-cyan-50 px-2 py-0.5 dark:bg-cyan-900/30`}
              >
                <Text style={tw`text-[11px] text-cyan-700 dark:text-cyan-200`}>{tag}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function pathFromPageUrl(pageUrl: string): string | null {
  if (typeof pageUrl !== "string") return null;
  const match = /character-tavern\.com\/character\/([^?#]+)/.exec(pageUrl);
  if (!match || !match[1]) return null;
  return match[1].replace(/^\/+|\/+$/g, "");
}

/**
 * Guard for the single-card block payload.
 */
export function isTavernRecommendationCard(data: unknown): data is TavernRecommendationCard {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.pageUrl === "string" &&
    typeof d.imageUrl === "string" &&
    typeof d.name === "string" &&
    typeof d.nameZh === "string" &&
    typeof d.tagline === "string" &&
    typeof d.taglineZh === "string" &&
    Array.isArray(d.tags) &&
    d.tags.every((tag) => typeof tag === "string") &&
    Array.isArray(d.matchTags) &&
    d.matchTags.every((tag) => typeof tag === "string") &&
    (d.safety === "sfw" || d.safety === "nsfw" || d.safety === "unknown")
  );
}
