"use client";

import { useEffect } from "react";
import { useLocalStorage } from "@/hooks/localstorage";
import {
  DEFAULT_FONT_SCALE,
  FONT_SCALE_VALUES,
  type FontScaleValue,
  persistFontScaleCookie,
  toFontScale,
} from "@/libs/layoutPreference";

const FONT_SCALE_LABELS: Record<FontScaleValue, string> = {
  0.9: "Small",
  1: "Default",
  1.15: "Large",
  1.3: "Extra Large",
};

export const FONT_SCALE_OPTIONS = FONT_SCALE_VALUES.map((value) => ({
  value,
  label: FONT_SCALE_LABELS[value],
}));

export const FONT_SCALE_STORAGE_KEY = "fontScale";

export const useFontScale = () => {
  const [fontScale, setFontScale] = useLocalStorage<FontScaleValue>(
    FONT_SCALE_STORAGE_KEY,
    DEFAULT_FONT_SCALE,
  );

  const validatedScale = toFontScale(fontScale) ?? DEFAULT_FONT_SCALE;

  useEffect(() => {
    if (fontScale !== validatedScale) {
      setFontScale(validatedScale);
    }
  }, [fontScale, validatedScale, setFontScale]);

  useEffect(() => {
    document.documentElement.style.setProperty("--font-scale", String(validatedScale));
    // Mirrored to a cookie so the root layout's <head> script can apply the scale before
    // first paint; without it the root font-size only changes after hydration and
    // re-flows the whole document.
    persistFontScaleCookie(validatedScale);
  }, [validatedScale]);

  return { fontScale: validatedScale, setFontScale };
};
