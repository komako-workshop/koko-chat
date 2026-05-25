import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View
} from "react-native";

import { openDeeplyLibraryBook } from "@/runtime/navigation";

import { BookCoverImage } from "./BookCoverImage";
import { listBooksByCategory, type LibraryBook } from "./libraryData";
import {
  CATEGORY_DESC,
  LIBRARY_BG,
  LIBRARY_INK,
  LIBRARY_INK_2,
  LIBRARY_INK_3,
  LIBRARY_INK_4,
  LIBRARY_LINE_SOFT,
  LIBRARY_WARM_100,
  getCategoryCoverUrl,
  getCategoryStyle
} from "./libraryTheme";

interface Props {
  categoryName: string;
}

/**
 * 分类全部页:顶部 hero 色块条 + 排序条 + 列表全部书。
 * 数据 fetch 后 memo;同一分类再次进入 instant。
 */
export function LibraryCategoryScreen({ categoryName }: Props): React.ReactElement {
  const [books, setBooks] = useState<LibraryBook[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setBooks(null);
    setError(null);
    (async () => {
      try {
        const data = await listBooksByCategory(categoryName);
        if (!cancelled) setBooks(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [categoryName, reloadKey]);

  const style = getCategoryStyle(categoryName);
  const desc = CATEGORY_DESC[categoryName] ?? "";

  if (error !== null) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>这个分类暂时打不开</Text>
        <Text style={styles.errorBody}>{error}</Text>
        <Pressable
          onPress={() => setReloadKey((k) => k + 1)}
          style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
        >
          <Text style={styles.retryText}>重试</Text>
        </Pressable>
      </View>
    );
  }

  if (books === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={LIBRARY_INK_3} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.root}
      contentContainerStyle={styles.scrollContent}
      data={books}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={
        <>
          <CategoryHero
            categoryName={categoryName}
            desc={desc}
            count={books.length}
            fallbackColor={style.colorStart}
          />

          <View style={styles.sortBar}>
            <Text style={styles.sortBarLeft}>共 {books.length} 本</Text>
            <View style={styles.sortBarRight}>
              <View style={styles.pill}>
                <Text style={styles.pillText}>经典度 ↓</Text>
              </View>
            </View>
          </View>
        </>
      }
      renderItem={({ item }) => (
        <BookRow book={item} onPress={() => openDeeplyLibraryBook(item.id)} />
      )}
      ItemSeparatorComponent={() => <View style={styles.divider} />}
    />
  );
}

/**
 * 分类详情页 hero。3:2 比例 banner,图来自 deeply.plus/library-assets/
 * category-covers/<id>.jpg。加载失败 fallback 到 colorStart 色块,保持原有
 * "面包屑 + 类目名 + 副标题 + 共 N 本" 版式。
 */
function CategoryHero({
  categoryName,
  desc,
  count,
  fallbackColor
}: {
  categoryName: string;
  desc: string;
  count: number;
  fallbackColor: string;
}): React.ReactElement {
  const url = getCategoryCoverUrl(categoryName);
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = url.length > 0 && !imageFailed;
  return (
    <View style={[styles.hero, { backgroundColor: fallbackColor }]}>
      {showImage ? (
        <Image
          source={{ uri: url }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onError={() => setImageFailed(true)}
        />
      ) : null}
      <View style={styles.heroScrim} />
      <View style={styles.heroBody}>
        <Text style={styles.heroCrumb}>课程库 / {shortenName(categoryName)}</Text>
        <Text style={styles.heroName}>{categoryName}</Text>
        {desc.length > 0 ? <Text style={styles.heroDesc}>{desc}</Text> : null}
        <Text style={styles.heroMeta}>共 {count} 本</Text>
      </View>
    </View>
  );
}

function BookRow({
  book,
  onPress
}: {
  book: LibraryBook;
  onPress: () => void;
}): React.ReactElement {
  return (
    <Pressable onPress={onPress} style={styles.row}>
      <BookCoverImage imgUrl={book.img} title={book.t} category={book.c} size="xs" />
      <View style={styles.rowInfo}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {book.t}
        </Text>
        <Text style={styles.rowAuthor} numberOfLines={1}>
          {book.a}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {book.d.length > 0 ? book.d : book.c}
        </Text>
      </View>
      <Text style={styles.rowChevron}>›</Text>
    </Pressable>
  );
}

function shortenName(name: string): string {
  return name.replace(/(的镜像|的逻辑|理论|的深渊|与表达|经典|的边界|群星)/, "");
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: LIBRARY_BG
  },
  scrollContent: {
    paddingBottom: 32
  },
  center: {
    flex: 1,
    backgroundColor: LIBRARY_BG,
    justifyContent: "center",
    alignItems: "center",
    padding: 32
  },
  errorTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: LIBRARY_INK,
    marginBottom: 6
  },
  errorBody: {
    fontSize: 12,
    color: LIBRARY_INK_2,
    textAlign: "center",
    marginBottom: 16
  },
  retry: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: LIBRARY_INK,
    borderRadius: 999
  },
  retryPressed: { opacity: 0.6 },
  retryText: { color: "#FFFFFF", fontWeight: "700" },
  hero: {
    width: "100%",
    aspectRatio: 3 / 2,
    overflow: "hidden",
    justifyContent: "flex-end"
  },
  // 底部 60% 暗色 scrim,保证白字可读;Library Home hero 用 55%,这里
  // 文字多一档(crumb + name + desc + meta)所以暗一些更保险。
  heroScrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "60%",
    backgroundColor: "rgba(0,0,0,0.45)"
  },
  heroBody: {
    paddingHorizontal: 22,
    paddingTop: 36,
    paddingBottom: 20
  },
  heroCrumb: {
    fontSize: 11,
    color: "rgba(255,255,255,0.78)",
    marginBottom: 8,
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3
  },
  heroName: {
    fontSize: 26,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.4,
    marginBottom: 6,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4
  },
  heroDesc: {
    fontSize: 13,
    color: "rgba(255,255,255,0.9)",
    lineHeight: 20,
    maxWidth: 280,
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3
  },
  heroMeta: {
    fontSize: 12,
    color: "rgba(255,255,255,0.8)",
    marginTop: 12,
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3
  },
  sortBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6
  },
  sortBarLeft: {
    fontSize: 12,
    color: LIBRARY_INK_3
  },
  sortBarRight: {
    flexDirection: "row",
    gap: 6
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: LIBRARY_WARM_100,
    borderRadius: 999
  },
  pillText: {
    fontSize: 11,
    color: LIBRARY_INK_2,
    fontWeight: "600"
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14
  },
  rowInfo: {
    flex: 1,
    minWidth: 0
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: LIBRARY_INK,
    marginBottom: 3
  },
  rowAuthor: {
    fontSize: 12,
    color: LIBRARY_INK_2,
    marginBottom: 4
  },
  rowMeta: {
    fontSize: 11,
    color: LIBRARY_INK_3
  },
  rowChevron: {
    fontSize: 18,
    color: LIBRARY_INK_4,
    fontWeight: "300"
  },
  divider: {
    height: 1,
    backgroundColor: LIBRARY_LINE_SOFT,
    marginLeft: 16
  }
});
