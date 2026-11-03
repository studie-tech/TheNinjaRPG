import { type GameLayoutId, toGameLayoutId } from "@/libs/gameLayouts";
import { LEMU_EXPERIMENT, normalizeLemuVariant } from "@/libs/lemuExperiment";
import {
  parseWallpaperVariant,
  WALLPAPER_EXPERIMENT,
} from "@/libs/wallpaperExperiment";
export const LAYOUT_PREFERENCE_COOKIE = "tnr_layout_preference";

/**
 * Font scale is mirrored into a cookie purely so the root layout's <head> script can
 * apply it before first paint. Applying it from localStorage after hydration changes the
 * root font-size, which re-flows every rem-based measurement on the page in one frame.
 */
export const FONT_SCALE_COOKIE = "tnr_font_scale";
export const FONT_SCALE_VALUES = [0.9, 1, 1.15, 1.3] as const;
export type FontScaleValue = (typeof FONT_SCALE_VALUES)[number];
export const DEFAULT_FONT_SCALE: FontScaleValue = 1;

/**
 * The light layout preference lives in localStorage under this key; the root layout's
 * <head> script mirrors it onto <html> as this attribute before first paint.
 */
export const LIGHT_LAYOUT_STORAGE_KEY = "lightLayout";
export const LIGHT_LAYOUT_ATTRIBUTE = "data-light-layout";

/**
 * Swapping the sidebars exchanges the sides of the player and world columns in every
 * layout. The preference lives in localStorage under this key; the root layout's <head>
 * script mirrors it onto <html> as this attribute before first paint, and the layout
 * stylesheets place the columns from it, so no layout renders with the wrong sides first.
 */
export const SWAP_SIDEBARS_STORAGE_KEY = "swapSidebars";
export const SWAP_SIDEBARS_ATTRIBUTE = "data-swap-sidebars";

/**
 * toFontScale
 * - Validates an unknown stored value against the supported scales
 * @param value - Raw cookie or localStorage value
 */
export const toFontScale = (value?: unknown): FontScaleValue | undefined => {
  // Narrowed before coercion: callers pass unchecked JSON.parse output, and Number()
  // happily turns `true` into 1 and `[1.15]` into 1.15, both of which would match a
  // supported scale.
  if (typeof value === "number") {
    return FONT_SCALE_VALUES.find((scale) => scale === value);
  }
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return FONT_SCALE_VALUES.find((scale) => scale === parsed);
};

export type EffectiveLayout = GameLayoutId;

export interface LayoutExperimentAssignment {
  experiment: string;
  variant: string;
}

export const getLayoutExperimentAssignments = (variants: {
  abLemuReplacementVariant?: string | null;
  wallpaperVariant?: string | null;
}): LayoutExperimentAssignment[] => {
  const assignments: LayoutExperimentAssignment[] = [];
  const variant = normalizeLemuVariant(variants.abLemuReplacementVariant);
  if (variant) {
    assignments.push({
      experiment: LEMU_EXPERIMENT,
      variant,
    });
  }
  const wallpaper = parseWallpaperVariant(variants.wallpaperVariant);
  if (wallpaper)
    assignments.push({ experiment: WALLPAPER_EXPERIMENT, variant: wallpaper });
  return assignments;
};

export const persistLayoutPreferenceCookie = (layout: EffectiveLayout) => {
  writeYearCookie(LAYOUT_PREFERENCE_COOKIE, layout);
};

/**
 * persistFontScaleCookie
 * - Mirrors the chosen font scale into a cookie so the next document applies it before
 *   first paint
 * @param scale - Validated font scale
 */
export const persistFontScaleCookie = (scale: FontScaleValue) => {
  writeYearCookie(FONT_SCALE_COOKIE, String(scale));
};

/**
 * applyFontScaleCookie
 * - Sets --font-scale on <html> from the cookie, or clears it at the default. The head
 *   script does the same before first paint; this is for after a remount of the shell,
 *   which strips every attribute React did not render on <html>.
 */
export const applyFontScaleCookie = () => {
  if (typeof document === "undefined") return;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${FONT_SCALE_COOKIE}=([^;]*)`),
  );
  const scale = toFontScale(match ? decodeURIComponent(match[1] ?? "") : undefined);
  if (scale === undefined || scale === DEFAULT_FONT_SCALE) {
    document.documentElement.style.removeProperty("--font-scale");
  } else {
    document.documentElement.style.setProperty("--font-scale", String(scale));
  }
};

export const storedValueToLayout = (
  value?: string | null,
): EffectiveLayout | undefined => {
  const direct = toGameLayoutId(value);
  if (direct) return direct;
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "string" ? toGameLayoutId(parsed) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Write a site-wide preference cookie for one year. document.cookie is synchronous,
 * so a reload that follows immediately already sees the value.
 */
const writeYearCookie = (name: string, value: string) => {
  if (typeof window === "undefined") return;
  const secureAttribute = window.location.protocol === "https:" ? "; secure" : "";
  // biome-ignore lint/suspicious/noDocumentCookie: synchronous persistence is needed before a reload.
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax${secureAttribute}`;
};
