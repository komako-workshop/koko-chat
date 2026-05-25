import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";

import {
  openDeeplyLibraryBook,
  openDeeplyLibraryCategory
} from "@/runtime/navigation";

import { BookCoverImage } from "./BookCoverImage";
import {
  getTotalBookCount,
  listCategories,
  type LibraryBook,
  type LibraryCategorySummary
} from "./libraryData";
import {
  CATEGORY_DESC,
  LIBRARY_BG,
  LIBRARY_INK,
  LIBRARY_INK_2,
  LIBRARY_INK_3,
  LIBRARY_LINE
} from "./libraryTheme";

/**
 * Deeply 课程库首页(从主页右上角 📚 入口进入)。
 *
 * 数据走 server(`@koko/deeply-library-server` /library/home)。第一次
 * fetch 后内存 memo,后续重新进入直接 instant。
 */
export function LibraryHomeScreen(): React.ReactElement {
  const [categories, setCategories] = useState<LibraryCategorySummary[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cats, tot] = await Promise.all([listCategories(), getTotalBookCount()]);
        if (cancelled) return;
        setCategories(cats);
        setTotal(tot);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  if (error !== null) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>课程库暂时打不开</Text>
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

  if (categories === null || total === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={LIBRARY_INK_3} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.intro}>
        <Text style={styles.introTitle}>{total} 本经过策划的书</Text>
        <Text style={styles.introSub}>
          分成 {categories.length} 个主题。选一个进去,或在任何卡片里直接挑一本。
        </Text>
      </View>

      {categories.map((cat) => (
        <CategoryCard
          key={cat.name}
          cat={cat}
          onOpenCategory={() => openDeeplyLibraryCategory(cat.name)}
          onOpenBook={openDeeplyLibraryBook}
        />
      ))}

      <View style={styles.footerRoom} />
    </ScrollView>
  );
}

function CategoryCard({
  cat,
  onOpenCategory,
  onOpenBook
}: {
  cat: LibraryCategorySummary;
  onOpenCategory: () => void;
  onOpenBook: (id: string) => void;
}): React.ReactElement {
  const desc = CATEGORY_DESC[cat.name] ?? "";
  return (
    <View style={styles.catCard}>
      <Pressable onPress={onOpenCategory} style={styles.catHead}>
        <View style={styles.catHeadText}>
          <Text style={styles.catName}>{cat.name}</Text>
          <Text style={styles.catMeta}>
            {cat.count} 本{desc.length > 0 ? ` · ${desc}` : ""}
          </Text>
        </View>
        <Text style={styles.catMore}>查看全部 ›</Text>
      </Pressable>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.bookRow}
      >
        {cat.topBooks.map((b) => (
          <BookThumb key={b.id} book={b} onPress={() => onOpenBook(b.id)} />
        ))}
      </ScrollView>
    </View>
  );
}

function BookThumb({
  book,
  onPress
}: {
  book: LibraryBook;
  onPress: () => void;
}): React.ReactElement {
  return (
    <Pressable onPress={onPress} style={styles.bookThumb}>
      <BookCoverImage imgUrl={book.img} title={book.t} category={book.c} size="m" />
      <Text style={styles.bookThumbMeta} numberOfLines={1}>
        {book.a}
      </Text>
    </Pressable>
  );
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
  intro: {
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 12
  },
  introTitle: {
    fontSize: 19,
    fontWeight: "700",
    color: LIBRARY_INK,
    letterSpacing: -0.2,
    lineHeight: 26
  },
  introSub: {
    fontSize: 13,
    color: LIBRARY_INK_2,
    marginTop: 6,
    lineHeight: 20
  },
  catCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: LIBRARY_LINE,
    borderRadius: 16,
    overflow: "hidden"
  },
  catHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10
  },
  catHeadText: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8
  },
  catName: {
    fontSize: 15,
    fontWeight: "700",
    color: LIBRARY_INK
  },
  catMeta: {
    fontSize: 11,
    color: LIBRARY_INK_3,
    marginTop: 3
  },
  catMore: {
    fontSize: 12,
    color: LIBRARY_INK_2,
    fontWeight: "600"
  },
  bookRow: {
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 14
  },
  bookThumb: {
    width: 88
  },
  bookThumbMeta: {
    fontSize: 10,
    color: LIBRARY_INK_3,
    marginTop: 5,
    paddingHorizontal: 1
  },
  footerRoom: {
    height: 12
  }
});
