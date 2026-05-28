/**
 * Host route: `/deeply/library`
 *
 * Deeply 预置课程库首页。从 deeply 主页右上角 📚 入口进入。
 */
import { useLayoutEffect } from "react";
import { StyleSheet } from "react-native";
import { useNavigation } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { LibraryHomeScreen } from "../../../../../miniapps/deeply/mobile/library/LibraryHomeScreen";
import { LibraryBackButton } from "@/components/LibraryBackButton";

export default function DeeplyLibraryHomeRoute(): React.ReactElement {
  const navigation = useNavigation();
  useLayoutEffect(() => {
    navigation.setOptions({
      title: "课程库",
      headerLeft: () =>
        navigation.canGoBack() ? (
          <LibraryBackButton onPress={() => navigation.goBack()} />
        ) : null
    });
  }, [navigation]);

  return (
    <SafeAreaView style={styles.screen} edges={["left", "right", "bottom"]}>
      <LibraryHomeScreen />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F9F9F7" }
});
