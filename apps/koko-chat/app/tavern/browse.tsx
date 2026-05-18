/**
 * Host route: `/tavern/browse`
 *
 * Thin shell over the Tavern mini-app's browse screen. The mini-app owns
 * the catalogue + grid UI; the host wraps it in a SafeAreaView so the
 * mini-app doesn't have to depend on safe-area-context itself. Keeping
 * the host concerns (header, safe area, route registration) here lets
 * the mini-app stay portable.
 */
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { KokoColors } from "@/theme/koko";
import { TavernBrowseScreen } from "../../../../miniapps/tavern/mobile/BrowseScreen";

export default function TavernBrowseRoute(): React.ReactElement {
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
  }
});
