import type { TavernColorPreset } from "@/drizzle/constants";
import { contrastingTextColor } from "@/utils/color";

type TavernColorStyle = {
  label: string;
  swatchClass: string;
  /** Strong preset color with separate light/dark stops so names stay readable on tavern surfaces. */
  usernameClass: string;
  titleClass: string;
  titleHex: string;
  titleForeground: "#000000" | "#FFFFFF";
};

const titleForegroundClass = (titleHex: string) =>
  contrastingTextColor(titleHex) === "#000000" ? "text-black" : "text-white";

const titleStyle = (
  label: string,
  swatchClass: string,
  usernameClass: string,
  titleBgClass: string,
  titleHex: string,
): TavernColorStyle => ({
  label,
  swatchClass,
  usernameClass,
  titleClass: `${titleBgClass} ${titleForegroundClass(titleHex)} font-semibold`,
  titleHex,
  titleForeground: contrastingTextColor(titleHex),
});

/** Static classes keep every Tailwind candidate discoverable at build time. */
export const TAVERN_COLOR_STYLES: Record<TavernColorPreset, TavernColorStyle> = {
  DEFAULT: titleStyle(
    "Default",
    "bg-gray-500",
    "text-popover-foreground",
    "bg-gray-500",
    "#6b7280",
  ),
  MIDNIGHT: titleStyle(
    "Midnight",
    "bg-blue-900",
    "text-blue-600 dark:text-blue-400 font-bold",
    "bg-blue-900",
    "#1e3a8a",
  ),
  NAVY: titleStyle(
    "Navy",
    "bg-blue-600",
    "text-blue-500 dark:text-sky-400 font-bold",
    "bg-blue-600",
    "#2563eb",
  ),
  COBALT: titleStyle(
    "Cobalt",
    "bg-cyan-500",
    "text-cyan-500 dark:text-cyan-400 font-bold",
    "bg-cyan-500",
    "#06b6d4",
  ),
  YELLOW: titleStyle(
    "Yellow",
    "bg-yellow-400",
    "text-yellow-500 dark:text-yellow-400 font-bold",
    "bg-yellow-400",
    "#eab308",
  ),
  SLATE: titleStyle(
    "Slate",
    "bg-teal-500",
    "text-teal-500 dark:text-teal-400 font-bold",
    "bg-teal-500",
    "#14b8a6",
  ),
  CHARCOAL: titleStyle(
    "Charcoal",
    "bg-zinc-600",
    "text-zinc-700 dark:text-zinc-300 font-bold",
    "bg-zinc-600",
    "#52525b",
  ),
  GOLD: titleStyle(
    "Gold",
    "bg-amber-500",
    "text-amber-500 dark:text-amber-400 font-bold",
    "bg-amber-500",
    "#f59e0b",
  ),
  CRIMSON: titleStyle(
    "Crimson",
    "bg-red-600",
    "text-red-600 dark:text-red-400 font-bold",
    "bg-red-600",
    "#dc2626",
  ),
  FUCHSIA: titleStyle(
    "Fuchsia",
    "bg-pink-500",
    "text-pink-500 dark:text-pink-400 font-bold",
    "bg-pink-500",
    "#ec4899",
  ),
  MINT: titleStyle(
    "Mint",
    "bg-emerald-500",
    "text-emerald-500 dark:text-emerald-300 font-bold",
    "bg-emerald-500",
    "#10b981",
  ),
  LIME: titleStyle(
    "Lime",
    "bg-lime-500",
    "text-lime-500 dark:text-lime-400 font-bold",
    "bg-lime-500",
    "#84cc16",
  ),
};

export const getTavernUsernameClass = (preset: TavernColorPreset) =>
  TAVERN_COLOR_STYLES[preset].usernameClass;

export const getTavernTitleClass = (preset: TavernColorPreset) =>
  TAVERN_COLOR_STYLES[preset].titleClass;

export const resolveTavernColorClasses = (input: {
  tavernStyling: boolean;
  role: string;
  usernamePreset: TavernColorPreset;
  titlePreset: TavernColorPreset;
  baseUsernameClass: string;
  baseTitleClass: string;
}) => ({
  usernameClass:
    input.tavernStyling && input.role === "USER" && input.usernamePreset !== "DEFAULT"
      ? getTavernUsernameClass(input.usernamePreset)
      : input.baseUsernameClass,
  titleClass:
    input.tavernStyling && input.titlePreset !== "DEFAULT"
      ? getTavernTitleClass(input.titlePreset)
      : input.baseTitleClass,
});
