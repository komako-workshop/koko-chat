import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
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
  LIBRARY_LINE,
  getCategoryCoverUrl,
  getCategoryStyle
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
      <CategoryHero
        name={cat.name}
        desc={desc}
        count={cat.count}
        onPress={onOpenCategory}
      />

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

/**
 * 类目 hero banner — 全宽 3:2 图,底部叠类目名 / 副标题 / 「查看全部」。
 * 图片来自 deeply.plus/library-assets/category-covers/<id>.jpg(Caddy 反代
 * 到 deeply-library-server/static/)。加载失败时 fallback 到 colorStart 纯色。
 */
function CategoryHero({
  name,
  desc,
  count,
  onPress
}: {
  name: string;
  desc: string;
  count: number;
  onPress: () => void;
}): React.ReactElement {
  const url = getCategoryCoverUrl(name);
  const style = getCategoryStyle(name);
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = url.length > 0 && !imageFailed;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.hero, pressed && styles.heroPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${name} 分类,查看全部 ${count} 本书`}
    >
      <View style={[styles.heroFill, { backgroundColor: style.colorStart }]}>
        {showImage ? (
          <Image
            source={{ uri: url }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            onError={() => setImageFailed(true)}
          />
        ) : null}
        <View style={styles.heroScrim} />
        <View style={styles.heroOverlay}>
          <View style={styles.heroTextCol}>
            <Text style={styles.heroName} numberOfLines={1}>
              {name}
            </Text>
            <Text style={styles.heroMeta} numberOfLines={1}>
              {count} 本{desc.length > 0 ? ` · ${desc}` : ""}
            </Text>
          </View>
          <Text style={styles.heroMore}>查看全部 ›</Text>
        </View>
      </View>
    </Pressable>
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
    marginBottom: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: LIBRARY_LINE,
    borderRadius: 16,
    overflow: "hidden"
  },
  hero: {
    width: "100%",
    aspectRatio: 3 / 2
  },
  heroPressed: {
    opacity: 0.92
  },
  heroFill: {
    flex: 1,
    overflow: "hidden",
    justifyContent: "flex-end"
  },
  // 底部 ~45% 高度的暗色渐变,让叠字总能读清,不依赖图本身底部够暗。
  // RN 没原生 LinearGradient,这里用一层半透明黑色取代;实际观感对编辑风
  // 调色板已经够好,不必为这点引一个 expo-linear-gradient 依赖。
  heroScrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "55%",
    backgroundColor: "rgba(0,0,0,0.42)"
  },
  heroOverlay: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 14,
    paddingTop: 32,
    gap: 12
  },
  heroTextCol: {
    flex: 1,
    minWidth: 0
  },
  heroName: {
    fontSize: 18,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: -0.2,
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3
  },
  heroMeta: {
    fontSize: 12,
    color: "rgba(255,255,255,0.86)",
    marginTop: 3,
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3
  },
  heroMore: {
    fontSize: 12,
    color: "rgba(255,255,255,0.92)",
    fontWeight: "600",
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3
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
