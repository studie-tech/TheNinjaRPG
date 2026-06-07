"use client";

import { safeLocalStorageGetItem } from "@/hooks/localstorage";
import type { EffectiveLayout } from "@/libs/layoutPreference";

export type ColorTheme = "light" | "dark";

export const getEffectiveColorTheme = (activeLayout?: EffectiveLayout): ColorTheme => {
  if (activeLayout === "pixel") return "dark";

  const savedTheme = safeLocalStorageGetItem("theme");
  if (savedTheme === "dark" || savedTheme === "light") return savedTheme;

  if (
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
  ) {
    return "dark";
  }

  return "light";
};

export const getEffectiveThemeTextColor = (
  activeLayout?: EffectiveLayout,
): "#FFFFFF" | "#000000" => {
  return getEffectiveColorTheme(activeLayout) === "dark" ? "#FFFFFF" : "#000000";
};
