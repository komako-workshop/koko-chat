import { useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, Text, View } from "react-native";
import tw from "twrnc";

import type { BlockRenderer } from "@/runtime/messageBlocks";
import {
  type TavernRecommendations,
  type TavernRecommendationCard
} from "./parseRecommendations";
import { startTavernRoleplaySession } from "../../tavern-roleplay/mobile";

/**
 * Renderer for `koko.tavern.recommendations` message blocks. Receives the
 * already-validated payload that the Tavern mini-app produced from the agent's
 * fenced output and renders a vertical stack of character cards.
 *
 * Block data is validated by the host registry guard before this renderer is
 * called.
 *
 * Tap behaviour: hand off to the `tavern-roleplay` mini-app, which fetches the
 * full Character Tavern card, translates the opening line to Chinese, and
 * creates a new conversation bound to that character. The user is routed into
 * the new conversation automatically.
 */
export const TavernRecommendationsBlock: BlockRenderer<TavernRecommendations> = ({ block }) => {
  const recommendations = block.data;

  return (
    <View style={tw`gap-2`}>
      {recommendations.cards.map((card, index) => (
        <RecommendationRow key={`${card.pageUrl}:${index}`} card={card} />
      ))}
    </View>
  );
};

function RecommendationRow({ card }: { card: TavernRecommendationCard }): React.ReactElement {
  const [busy, setBusy] = useState(false);

  async function handlePress(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const path = pathFromPageUrl(card.pageUrl);
      if (path === null) {
        Alert.alert("无法打开", "这张卡缺少 Character Tavern 路径。");
        return;
      }
      await startTavernRoleplaySession({
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
      setBusy(false);
    }
  }

  return (
    <Pressable
      onPress={() => void handlePress()}
      disabled={busy}
      android_ripple={{ color: "#1f2937" }}
      style={tw.style(
        "flex-row gap-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900",
        busy && "opacity-70"
      )}
    >
      <View style={tw`relative h-20 w-20`}>
        <Image
          source={{ uri: card.imageUrl }}
          style={tw`h-20 w-20 rounded-xl bg-slate-200 dark:bg-slate-800`}
          resizeMode="cover"
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
        <Text
          style={tw`mt-2 text-xs leading-4 text-slate-500 dark:text-slate-400`}
          numberOfLines={3}
        >
          {card.reason}
        </Text>
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
