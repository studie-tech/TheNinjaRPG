"use client";

import { useEffect } from "react";
import { useLocalStorage } from "@/hooks/localstorage";
import {
  DEFAULT_FONT_SCALE,
  type FontScaleValue,
  persistFontScaleCookie,
  toFontScale,
} from "@/libs/layoutPreference";

export const FONT_SCALE_OPTIONS = [
  { value: 0.9, label: "Small" },
  { value: 1, label: "Default" },
  { value: 1.15, label: "Large" },
  { value: 1.3, label: "Extra Large" },
] as const;

export type { FontScaleValue };

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
    // Mirrored to a cookie so the server can inline the scale on <html>; without it the
    // root font-size only changes after hydration and re-flows the whole document.
    persistFontScaleCookie(validatedScale);
  }, [validatedScale]);

  return { fontScale: validatedScale, setFontScale };
};
