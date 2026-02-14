"use client";

import { useEffect } from "react";
import { useLocalStorage } from "@/hooks/localstorage";

export const FONT_SCALE_OPTIONS = [
  { value: 0.9, label: "Small" },
  { value: 1, label: "Default" },
  { value: 1.15, label: "Large" },
  { value: 1.3, label: "Extra Large" },
] as const;

export type FontScaleValue = (typeof FONT_SCALE_OPTIONS)[number]["value"];

export const FONT_SCALE_STORAGE_KEY = "fontScale";

const DEFAULT_FONT_SCALE: FontScaleValue = 1;
const VALID_FONT_SCALES = FONT_SCALE_OPTIONS.map((o) => o.value) as readonly number[];

export const useFontScale = () => {
  const [fontScale, setFontScale] = useLocalStorage<FontScaleValue>(
    FONT_SCALE_STORAGE_KEY,
    DEFAULT_FONT_SCALE,
  );

  const validatedScale = VALID_FONT_SCALES.includes(fontScale)
    ? fontScale
    : DEFAULT_FONT_SCALE;

  useEffect(() => {
    if (fontScale !== validatedScale) {
      setFontScale(validatedScale);
    }
  }, [fontScale, validatedScale, setFontScale]);

  useEffect(() => {
    document.documentElement.style.setProperty("--font-scale", String(validatedScale));
  }, [validatedScale]);

  return { fontScale: validatedScale, setFontScale };
};
