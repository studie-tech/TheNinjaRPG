import type { AbVariant } from "@/hooks/useAbVariant";

export const AB_PIXEL_LAYOUT_COOKIE = "ab_pixel_layout_1";
export const LEGACY_AB_LAYOUT_COOKIE = "ab_lemu_replacement_2";
export const LAYOUT_PREFERENCE_COOKIE = "tnr_layout_preference";

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
    void cookieStore.set({
      name: LAYOUT_PREFERENCE_COOKIE,
      value: layout,
      path: "/",
      expires,
      sameSite: "lax",
      secure,
    });
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
