/**
 * Host route: `/deeply/library/c/[cat]`
 *
 * 某个分类的全部书目浏览页。cat = 分类中文名(URL-encoded)。
 */
import { useLayoutEffect, useMemo } from "react";
import { StyleSheet } from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { LibraryCategoryScreen } from "../../../../../../miniapps/deeply/mobile/library/LibraryCategoryScreen";
import { LibraryBackButton } from "../_backButton";

export default function DeeplyLibraryCategoryRoute(): React.ReactElement {
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ cat?: string | string[] }>();
  const rawCat = typeof params.cat === "string" ? params.cat : Array.isArray(params.cat) ? params.cat[0] : "";
  const categoryName = useMemo(() => {
    try { return decodeURIComponent(rawCat ?? ""); } catch { return rawCat ?? ""; }
  }, [rawCat]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: categoryName.length > 0 ? categoryName : "分类",
      headerLeft: () =>
        navigation.canGoBack() ? (
          <LibraryBackButton onPress={() => navigation.goBack()} />
        ) : null
    });
  }, [navigation, categoryName]);

  return (
    <SafeAreaView style={styles.screen} edges={["left", "right", "bottom"]}>
      <LibraryCategoryScreen categoryName={categoryName} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F9F9F7" }
});
