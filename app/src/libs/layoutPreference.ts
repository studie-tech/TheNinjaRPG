import type { AbVariant } from "@/hooks/useAbVariant";

export const AB_PIXEL_LAYOUT_COOKIE = "ab_pixel_layout_1";
export const LEGACY_AB_LAYOUT_COOKIE = "ab_lemu_replacement_2";
export const LAYOUT_PREFERENCE_COOKIE = "tnr_layout_preference";

/**
 * Font scale is mirrored into a cookie purely so the server can inline it on <html>.
 * Applying it from localStorage after hydration changes the root font-size, which
 * re-flows every rem-based measurement on the page in one frame.
 */
export const FONT_SCALE_COOKIE = "tnr_font_scale";
export const FONT_SCALE_VALUES = [0.9, 1, 1.15, 1.3] as const;
export type FontScaleValue = (typeof FONT_SCALE_VALUES)[number];
export const DEFAULT_FONT_SCALE: FontScaleValue = 1;

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

export const abVariantToLayout = (
  variant?: AbVariant | string | null,
): EffectiveLayout => {
  return variant === "treatment" ? "pixel" : "default";
};

export const cookieValueToLayout = (
  value?: string | null,
): EffectiveLayout | undefined => {
  if (value === "pixel" || value === "PIXEL") return "pixel";
  if (value === "default" || value === "DEFAULT") return "default";
  if (value === "treatment" || value === "control") return abVariantToLayout(value);
  return undefined;
};

export const layoutToAbVariant = (layout: EffectiveLayout): AbVariant => {
  return layout === "pixel" ? "treatment" : "control";
};

export const getLayoutExperimentAssignments = (variants: {
  abPixelLayoutVariant?: string | null;
  abLemuReplacementVariant?: string | null;
}): LayoutExperimentAssignment[] => {
  const assignments: LayoutExperimentAssignment[] = [];
  if (variants.abPixelLayoutVariant) {
    assignments.push({
      experiment: AB_PIXEL_LAYOUT_COOKIE,
      variant: variants.abPixelLayoutVariant,
    });
  }
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
      .catch((error: unknown) => {
        // Chrome rejects this mirror write with a malformed-cookie TypeError in some
        // profiles, and document.cookie above has already persisted the preference, so
        // that one is noise. Anything else is unexpected and is rethrown so it still
        // surfaces as an unhandled rejection.
        const isMalformedCookie =
          error instanceof TypeError && error.message.includes("Cookie was malformed");
        if (!isMalformedCookie) throw error;
      });
  }
};

/**
 * persistFontScaleCookie
 * - Mirrors the chosen font scale into a cookie so the next server render can inline it
 * @param scale - Validated font scale
 */
export const persistFontScaleCookie = (scale: FontScaleValue) => {
  if (typeof window === "undefined") return;
  const secureAttribute = window.location.protocol === "https:" ? "; secure" : "";
  // biome-ignore lint/suspicious/noDocumentCookie: mirrors persistLayoutPreferenceCookie above.
  document.cookie = `${FONT_SCALE_COOKIE}=${scale}; path=/; max-age=31536000; samesite=lax${secureAttribute}`;
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
