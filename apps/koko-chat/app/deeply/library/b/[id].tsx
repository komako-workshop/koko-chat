/**
 * Host route: `/deeply/library/b/[id]`
 *
 * 单本课程详情页(学术风:Deeply 品牌头 + 推荐文案 + 知识谱系)。
 */
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { StyleSheet } from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { LibraryBookScreen } from "../../../../../../miniapps/deeply/mobile/library/LibraryBookScreen";
import { getBookById } from "../../../../../../miniapps/deeply/mobile/library/libraryData";
import { LibraryBackButton } from "@/components/LibraryBackButton";

export default function DeeplyLibraryBookRoute(): React.ReactElement {
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const rawId = typeof params.id === "string" ? params.id : Array.isArray(params.id) ? params.id[0] : "";
  const bookId = useMemo(() => {
    try { return decodeURIComponent(rawId ?? ""); } catch { return rawId ?? ""; }
  }, [rawId]);
  // 异步从 library server 拿书名,仅用来在 navigation back stack 里显示
  // 一个短 label。详情页 body 由 LibraryBookScreen 自己处理 loading state。
  const [title, setTitle] = useState<string>("课程");
  useEffect(() => {
    let cancelled = false;
    void getBookById(bookId).then((book) => {
      if (cancelled) return;
      if (book?.t !== undefined && book.t.length > 0) setTitle(book.t);
    });
    return () => { cancelled = true; };
  }, [bookId]);

  useLayoutEffect(() => {
    // header title 留空字符串(详情页内自己渲染 Deeply 品牌头),避免顶部
    // 同时出现 "史记" + 大字 "Deeply" 视觉冗余。显式渲染 headerLeft,
    // 否则在 web 上默认 back chevron 不出现,用户找不到返回入口。
    navigation.setOptions({
      title: " ",
      headerBackTitle: title.slice(0, 8),
      headerLeft: () =>
        navigation.canGoBack() ? (
          <LibraryBackButton onPress={() => navigation.goBack()} />
        ) : null
    });
  }, [navigation, title]);

  return (
    <SafeAreaView style={styles.screen} edges={["left", "right", "bottom"]}>
      <LibraryBookScreen bookId={bookId} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F9F9F7" }
});
