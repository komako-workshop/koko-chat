/**
 * KokoChat visual identity — derived from the Koko mascot:
 * round, warm-orange chick on a soft off-white background with star
 * accents. The palette is intentionally warm-leaning so the app feels
 * gentle and friendly rather than clinical.
 *
 * One source of truth. Screens should import from here instead of
 * hard-coding hex values, and should NOT use twrnc `dark:` variants —
 * KokoChat is single-theme (light) by design.
 */

export const KokoColors = {
  /** Page background — pure white. The brand stays bright; orange is accent only. */
  bg: "#FFFFFF",
  /** Card / bubble / row surface — same as bg, cards rely on border + radius. */
  surface: "#FFFFFF",
  /** Lightly tinted surface for pressed states and small callouts. */
  surfaceSoft: "#FFF3DC",
  /** Muted ground for input areas and other quietly-recessed zones. */
  surfaceMuted: "#F7F4ED",

  /** Koko's signature warm orange. Used for user bubbles, primary buttons, tab active. */
  primary: "#F5A742",
  /** Slightly deeper orange for pressed / important emphasis. */
  primaryDeep: "#E69228",
  /** Pale orange used for disabled buttons and avatar fallbacks. */
  primarySoft: "#FFE9C7",
  /** Subtle orange tint for the pinned home row — visible but not loud. */
  primaryWash: "#FFF6E8",

  /** Primary text — warm dark brown rather than cool slate-950. */
  ink: "#2E1E10",
  /** Secondary text — warm taupe. */
  inkSecondary: "#7A6248",
  /** Muted text — disabled labels, captions. */
  inkMuted: "#A89274",
  /** Placeholder text inside inputs. */
  inkPlaceholder: "#C3B299",

  /** Hairline separators between list rows. */
  hairline: "#ECE5D2",
  /** Card / input border on the white surface. */
  border: "#E3D8BF",

  /** Destructive / forget / disconnect tone (warm red-orange). */
  danger: "#E27143",
  /** Tinted background for destructive callouts. */
  dangerSoft: "#FFE5D3",

  /** Positive state tone — soft gentle green that doesn't clash with orange. */
  success: "#56B07C",
  /** Tab bar inactive icon / label. */
  inactive: "#A89274"
} as const;

export type KokoColor = (typeof KokoColors)[keyof typeof KokoColors];

export const KokoRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999
} as const;

export const KokoSpacing = {
  /** Standard outer padding for grouped panels and screen edges. */
  edge: 16,
  /** Comfortable in-card padding. */
  card: 16
} as const;
