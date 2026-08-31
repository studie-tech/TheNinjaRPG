import type { TavernColorPreset } from "@/drizzle/constants";
import { contrastingTextColor } from "@/utils/color";

type TavernColorStyle = {
  label: string;
  swatchClass: string;
  /** Strong preset color with separate light/dark stops so names stay readable on tavern surfaces. */
  usernameClass: string;
  usernameLightHex: string;
  usernameDarkHex: string;
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
  usernameLightHex: string,
  usernameDarkHex: string,
  titleBgClass: string,
  titleHex: string,
): TavernColorStyle => ({
  label,
  swatchClass,
  usernameClass,
  usernameLightHex,
  usernameDarkHex,
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
    "#0f172a",
    "#f8fafc",
    "bg-gray-500",
    "#6b7280",
  ),
  MIDNIGHT: titleStyle(
    "Midnight",
    "bg-blue-900",
    "text-blue-800 dark:text-blue-300 font-bold",
    "#1e40af",
    "#93c5fd",
    "bg-blue-900",
    "#1e3a8a",
  ),
  NAVY: titleStyle(
    "Navy",
    "bg-blue-600",
    "text-blue-700 dark:text-sky-300 font-bold",
    "#1d4ed8",
    "#7dd3fc",
    "bg-blue-600",
    "#2563eb",
  ),
  COBALT: titleStyle(
    "Cobalt",
    "bg-cyan-500",
    "text-cyan-800 dark:text-cyan-300 font-bold",
    "#155e75",
    "#67e8f9",
    "bg-cyan-500",
    "#06b6d4",
  ),
  YELLOW: titleStyle(
    "Yellow",
    "bg-yellow-400",
    "text-yellow-800 dark:text-yellow-300 font-bold",
    "#854d0e",
    "#fde047",
    "bg-yellow-400",
    "#eab308",
  ),
  SLATE: titleStyle(
    "Slate",
    "bg-teal-500",
    "text-teal-800 dark:text-teal-300 font-bold",
    "#115e59",
    "#5eead4",
    "bg-teal-500",
    "#14b8a6",
  ),
  CHARCOAL: titleStyle(
    "Charcoal",
    "bg-zinc-600",
    "text-zinc-700 dark:text-zinc-300 font-bold",
    "#3f3f46",
    "#d4d4d8",
    "bg-zinc-600",
    "#52525b",
  ),
  GOLD: titleStyle(
    "Gold",
    "bg-amber-500",
    "text-amber-800 dark:text-amber-300 font-bold",
    "#92400e",
    "#fcd34d",
    "bg-amber-500",
    "#f59e0b",
  ),
  CRIMSON: titleStyle(
    "Crimson",
    "bg-red-600",
    "text-red-700 dark:text-red-300 font-bold",
    "#b91c1c",
    "#fca5a5",
    "bg-red-600",
    "#dc2626",
  ),
  FUCHSIA: titleStyle(
    "Fuchsia",
    "bg-pink-500",
    "text-pink-700 dark:text-pink-300 font-bold",
    "#be185d",
    "#f9a8d4",
    "bg-pink-500",
    "#ec4899",
  ),
  MINT: titleStyle(
    "Mint",
    "bg-emerald-500",
    "text-emerald-800 dark:text-emerald-300 font-bold",
    "#065f46",
    "#6ee7b7",
    "bg-emerald-500",
    "#10b981",
  ),
  LIME: titleStyle(
    "Lime",
    "bg-lime-500",
    "text-lime-800 dark:text-lime-300 font-bold",
    "#3f6212",
    "#bef264",
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
