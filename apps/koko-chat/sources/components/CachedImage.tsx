/**
 * Cached image wrapper over expo-image.
 *
 * Why this exists:
 * - Stock RN `<Image source={{ uri: '...' }}>` honours `Cache-Control`
 *   but character-tavern.com's image CDN doesn't always set sensible
 *   caching headers, so the same tavern card thumbnail re-downloaded
 *   every time the user opened the browse / detail / chat surface.
 *   expo-image ships with disk + memory caching enabled by default,
 *   keyed by URL, so a card image is fetched at most once per install
 *   (until cache eviction).
 * - We funnel all images through this component so mini-apps don't
 *   need to depend on `expo-image` directly — they import it through
 *   the host's `@/components/CachedImage` alias instead. Keeping the
 *   wrapper here also gives us a single place to tune cachePolicy,
 *   placeholder behaviour, and accessibility later.
 *
 * API mirrors RN's Image just enough for drop-in replacement:
 *   - `source`: any ImageSourcePropType (remote `{ uri }` or `require`)
 *   - `style`: same as RN
 *   - `contentFit`: cover / contain / fill / scale-down / none (replaces
 *                   RN's `resizeMode`)
 *   - `accessibilityLabel`: forwarded
 */
import type { ImageSourcePropType, StyleProp, ImageStyle } from "react-native";
import { Image as ExpoImage } from "expo-image";

// We deliberately cast ExpoImage to a permissive component type so the
// host's `exactOptionalPropertyTypes: true` TS setting doesn't fight
// expo-image's own ImageProps shape (`source: ... | null`, no undefined).
// CachedImage's own props are still strict; only the forwarding is loose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ForwardImage = ExpoImage as unknown as React.ComponentType<any>;

export interface CachedImageProps {
  source: ImageSourcePropType;
  style?: StyleProp<ImageStyle>;
  contentFit?: "cover" | "contain" | "fill" | "scale-down" | "none";
  accessibilityLabel?: string;
  /** Default "memory-disk" — keep both disk and memory caching on. */
  cachePolicy?: "memory" | "disk" | "memory-disk" | "none";
}

export function CachedImage({
  source,
  style,
  contentFit = "cover",
  accessibilityLabel,
  cachePolicy = "memory-disk"
}: CachedImageProps): React.ReactElement {
  return (
    <ForwardImage
      source={source}
      style={style}
      contentFit={contentFit}
      cachePolicy={cachePolicy}
      accessibilityLabel={accessibilityLabel}
      transition={120}
    />
  );
}
