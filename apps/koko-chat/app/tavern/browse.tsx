/**
 * Host route: `/tavern/browse`
 *
 * Thin shell over the Tavern mini-app's browse screen. The mini-app owns
 * the catalogue + grid UI; the host wraps it in a SafeAreaView so the
 * mini-app doesn't have to depend on safe-area-context itself, and also
 * installs the header's right-side settings shortcut.
 */
import { useLayoutEffect } from "react";
import { Pressable, StyleSheet } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigation } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { openTavernSettings } from "@/runtime/navigation";
import { KokoColors, KokoRadius } from "@/theme/koko";
import { TavernBrowseScreen } from "../../../../miniapps/tavern/mobile/BrowseScreen";

export default function TavernBrowseRoute(): React.ReactElement {
  const navigation = useNavigation();
  // The browse page hosts the entry point to Tavern-wide settings (persona
  // name today, NSFW toggles / model overrides tomorrow). The chat-page
  // header keeps its single-purpose grid button → browse; the gear lives
  // here so we never cram two icons into one stack header.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="酒馆设置"
          onPress={openTavernSettings}
          hitSlop={10}
          style={({ pressed }) => [styles.headerButton, pressed && styles.headerButtonPressed]}
        >
          <Ionicons name="settings-outline" size={20} color={KokoColors.primaryDeep} />
        </Pressable>
      )
    });
  }, [navigation]);

  return (
    <SafeAreaView style={styles.screen} edges={["left", "right", "bottom"]}>
      <TavernBrowseScreen />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: KokoColors.bg
  },
  headerButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: KokoRadius.pill,
    alignItems: "center",
    justifyContent: "center"
  },
  headerButtonPressed: {
    backgroundColor: KokoColors.surfaceSoft
  }
});
