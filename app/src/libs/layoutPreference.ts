export const LEGACY_AB_LAYOUT_COOKIE = "ab_lemu_replacement_2";
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

export type EffectiveLayout = "default" | "pixel";

export interface LayoutExperimentAssignment {
  experiment: string;
  variant: string;
}

export const cookieValueToLayout = (
  value?: string | null,
): EffectiveLayout | undefined => {
  if (value === "pixel" || value === "PIXEL") return "pixel";
  if (value === "default" || value === "DEFAULT") return "default";
  return undefined;
};

export const getLayoutExperimentAssignments = (variants: {
  abLemuReplacementVariant?: string | null;
}): LayoutExperimentAssignment[] => {
  const assignments: LayoutExperimentAssignment[] = [];
  if (variants.abLemuReplacementVariant) {
    assignments.push({
      experiment: LEGACY_AB_LAYOUT_COOKIE,
      variant: variants.abLemuReplacementVariant,
    });
  }
  return assignments;
};

type BrowserCookieStore = {
  set: (options: {
    name: string;
    value: string;
    path?: string;
    expires?: number;
    sameSite?: "lax" | "strict" | "none";
    secure?: boolean;
  }) => Promise<void>;
};

export const persistLayoutPreferenceCookie = (layout: EffectiveLayout) => {
  if (typeof window === "undefined") return;

  const expires = Date.now() + 365 * 24 * 60 * 60 * 1000;
  const secure = window.location.protocol === "https:";
  const secureAttribute = secure ? "; secure" : "";
  // Write document.cookie synchronously so a following reload sees the preference.
  // Chrome's Cookie Store API is asynchronous and can lose the race with reload().
  // biome-ignore lint/suspicious/noDocumentCookie: synchronous persistence is needed before layout reload.
  document.cookie = `${LAYOUT_PREFERENCE_COOKIE}=${layout}; path=/; max-age=31536000; samesite=lax${secureAttribute}`;

  const cookieStore = (window as Window & { cookieStore?: BrowserCookieStore })
    .cookieStore;
  if (cookieStore) {
    void cookieStore
      .set({
        name: LAYOUT_PREFERENCE_COOKIE,
        value: layout,
        path: "/",
        expires,
        sameSite: "lax",
        secure,
      })
      .catch(() => {
        // document.cookie above is what the next reload reads. Chrome's Cookie Store
        // mirror separately rejects with UnknownError, or a malformed-cookie TypeError,
        // on some profiles. The chosen layout is already stored, so the page continues.
      });
  }
};

/**
 * persistFontScaleCookie
 * - Mirrors the chosen font scale into a cookie so the next document applies it before
 *   first paint
 * @param scale - Validated font scale
 */
export const persistFontScaleCookie = (scale: FontScaleValue) => {
  if (typeof window === "undefined") return;
  const secureAttribute = window.location.protocol === "https:" ? "; secure" : "";
  // biome-ignore lint/suspicious/noDocumentCookie: mirrors persistLayoutPreferenceCookie above.
  document.cookie = `${FONT_SCALE_COOKIE}=${scale}; path=/; max-age=31536000; samesite=lax${secureAttribute}`;
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
  const direct = cookieValueToLayout(value);
  if (direct) return direct;
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "string" ? cookieValueToLayout(parsed) : undefined;
  } catch {
    return undefined;
  }
};
