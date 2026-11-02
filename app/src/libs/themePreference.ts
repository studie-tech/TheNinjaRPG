"use client";

import { safeLocalStorageGetItem } from "@/hooks/localstorage";
import { getGameLayout } from "@/libs/gameLayouts";
import type { EffectiveLayout } from "@/libs/layoutPreference";

export type ColorTheme = "light" | "dark";

/**
 * Resolve the color theme the document shows. With a layout, this mirrors
 * `applyGameLayout`: fixed-tone layouts use their tone and color-mode layouts the
 * saved preference, so it is correct before the layout's `dark` class is applied.
 * Without one, it reads the document's `dark` class.
 */
export const getEffectiveColorTheme = (activeLayout?: EffectiveLayout): ColorTheme => {
  if (activeLayout) {
    const layout = getGameLayout(activeLayout);
    if (!layout.supportsColorMode) return layout.tone;
    return safeLocalStorageGetItem("theme") === "dark" ? "dark" : "light";
  }
  return typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
    ? "dark"
    : "light";
};

export const getEffectiveThemeTextColor = (
  activeLayout?: EffectiveLayout,
): "#FFFFFF" | "#000000" => {
  return getEffectiveColorTheme(activeLayout) === "dark" ? "#FFFFFF" : "#000000";
};
