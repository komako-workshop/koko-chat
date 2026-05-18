/**
 * Host route: `/tavern/settings`
 *
 * Thin shell over the Tavern mini-app's settings screen. The mini-app
 * owns the persona store + the form; the host owns route registration
 * and SafeAreaView chrome.
 */
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { KokoColors } from "@/theme/koko";
import { TavernSettingsScreen } from "../../../../miniapps/tavern/mobile/SettingsScreen";

export default function TavernSettingsRoute(): React.ReactElement {
  return (
    <SafeAreaView style={styles.screen} edges={["left", "right", "bottom"]}>
      <TavernSettingsScreen />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: KokoColors.bg
  }
});
