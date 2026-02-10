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

const FONT_SCALE_STORAGE_KEY = "fontScale";

export const useFontScale = () => {
  const [fontScale, setFontScale] = useLocalStorage<FontScaleValue>(
    FONT_SCALE_STORAGE_KEY,
    1,
  );

  useEffect(() => {
    document.documentElement.style.setProperty("--font-scale", String(fontScale));
  }, [fontScale]);

  return { fontScale, setFontScale };
};

export { FONT_SCALE_STORAGE_KEY };
