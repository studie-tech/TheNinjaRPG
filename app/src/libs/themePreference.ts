"use client";

import { type GameLayoutId, getGameLayout } from "@/libs/gameLayouts";
import { safeLocalStorageGetItem } from "@/utils/storage";

export type ColorTheme = "light" | "dark";

/**
 * Resolve the color theme the document shows. With a layout, this mirrors
 * `applyGameLayout`: fixed-tone layouts use their tone and color-mode layouts the
 * saved preference, so it is correct before the layout's `dark` class is applied.
 * Without one, it reads the document's `dark` class.
 */
export const getEffectiveColorTheme = (activeLayout?: GameLayoutId): ColorTheme => {
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

/** Choose a contrasting text color for the effective layout theme. */
export const getEffectiveThemeTextColor = (
  activeLayout?: GameLayoutId,
): "#FFFFFF" | "#000000" => {
  return getEffectiveColorTheme(activeLayout) === "dark" ? "#FFFFFF" : "#000000";
};
