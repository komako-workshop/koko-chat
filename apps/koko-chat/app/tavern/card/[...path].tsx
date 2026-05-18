/**
 * Host route: `/tavern/card/<author>/<slug>`
 *
 * Catch-all (`[...path]`) so character-tavern paths like `boner/ember`
 * arrive intact as `["boner","ember"]` and we can rejoin them into the
 * original "author/slug" string the mini-app uses as its card key.
 */
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useLayoutEffect } from "react";

import { KokoColors } from "@/theme/koko";
import { TavernCardDetailScreen } from "../../../../../miniapps/tavern/mobile/CardDetailScreen";

export default function TavernCardRoute(): React.ReactElement {
  const { path } = useLocalSearchParams<{ path: string | string[] }>();
  const navigation = useNavigation();
  const joined = Array.isArray(path) ? path.join("/") : path ?? "";

  // Show a generic-but-on-brand title until the screen itself can do
  // better. The screen renders its own large name header so we keep the
  // stack title intentionally short.
  useLayoutEffect(() => {
    navigation.setOptions({ title: "角色详情" });
  }, [navigation]);

  return (
    <SafeAreaView style={styles.screen} edges={["left", "right", "bottom"]}>
      <TavernCardDetailScreen path={joined} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: KokoColors.bg
  }
});
