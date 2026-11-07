import type { TavernColorPreset } from "@/drizzle/constants";
import { contrastingTextColor } from "@/utils/color";

type TavernColorStyle = {
  label: string;
  swatchClass: string;
  /** Strong preset color with separate light/dark stops so names stay readable on tavern surfaces. */
  usernameClass: string;
  /** Hex values of `usernameClass`'s stops, the input of the contrast test. */
  usernameLightHex: string;
  usernameDarkHex: string;
  titleClass: string;
  titleHex: string;
  titleForeground: "#000000" | "#FFFFFF";
};

const titleForegroundClass = (titleHex: string) =>
  contrastingTextColor(titleHex) === "#000000" ? "text-black" : "text-white";

const titleStyle = (
  preset: Omit<TavernColorStyle, "titleClass" | "titleForeground">,
): TavernColorStyle => ({
  ...preset,
  titleClass: `${preset.swatchClass} ${titleForegroundClass(preset.titleHex)} font-semibold`,
  titleForeground: contrastingTextColor(preset.titleHex),
});

/** Static classes keep every Tailwind candidate discoverable at build time. */
export const TAVERN_COLOR_STYLES: Record<TavernColorPreset, TavernColorStyle> = {
  DEFAULT: titleStyle({
    label: "Default",
    swatchClass: "bg-gray-500",
    usernameClass: "text-popover-foreground",
    usernameLightHex: "#0f172a",
    usernameDarkHex: "#f8fafc",
    titleHex: "#6b7280",
  }),
  MIDNIGHT: titleStyle({
    label: "Midnight",
    swatchClass: "bg-blue-900",
    usernameClass: "text-blue-800 dark:text-blue-300 font-bold",
    usernameLightHex: "#1e40af",
    usernameDarkHex: "#93c5fd",
    titleHex: "#1e3a8a",
  }),
  NAVY: titleStyle({
    label: "Navy",
    swatchClass: "bg-blue-600",
    usernameClass: "text-blue-700 dark:text-sky-300 font-bold",
    usernameLightHex: "#1d4ed8",
    usernameDarkHex: "#7dd3fc",
    titleHex: "#2563eb",
  }),
  COBALT: titleStyle({
    label: "Cobalt",
    swatchClass: "bg-cyan-500",
    usernameClass: "text-cyan-800 dark:text-cyan-300 font-bold",
    usernameLightHex: "#155e75",
    usernameDarkHex: "#67e8f9",
    titleHex: "#06b6d4",
  }),
  YELLOW: titleStyle({
    label: "Yellow",
    swatchClass: "bg-yellow-400",
    usernameClass: "text-yellow-800 dark:text-yellow-300 font-bold",
    usernameLightHex: "#854d0e",
    usernameDarkHex: "#fde047",
    titleHex: "#eab308",
  }),
  SLATE: titleStyle({
    label: "Slate",
    swatchClass: "bg-teal-500",
    usernameClass: "text-teal-800 dark:text-teal-300 font-bold",
    usernameLightHex: "#115e59",
    usernameDarkHex: "#5eead4",
    titleHex: "#14b8a6",
  }),
  CHARCOAL: titleStyle({
    label: "Charcoal",
    swatchClass: "bg-zinc-600",
    usernameClass: "text-zinc-700 dark:text-zinc-300 font-bold",
    usernameLightHex: "#3f3f46",
    usernameDarkHex: "#d4d4d8",
    titleHex: "#52525b",
  }),
  GOLD: titleStyle({
    label: "Gold",
    swatchClass: "bg-amber-500",
    usernameClass: "text-amber-800 dark:text-amber-300 font-bold",
    usernameLightHex: "#92400e",
    usernameDarkHex: "#fcd34d",
    titleHex: "#f59e0b",
  }),
  CRIMSON: titleStyle({
    label: "Crimson",
    swatchClass: "bg-red-600",
    usernameClass: "text-red-700 dark:text-red-300 font-bold",
    usernameLightHex: "#b91c1c",
    usernameDarkHex: "#fca5a5",
    titleHex: "#dc2626",
  }),
  FUCHSIA: titleStyle({
    label: "Fuchsia",
    swatchClass: "bg-pink-500",
    usernameClass: "text-pink-700 dark:text-pink-300 font-bold",
    usernameLightHex: "#be185d",
    usernameDarkHex: "#f9a8d4",
    titleHex: "#ec4899",
  }),
  MINT: titleStyle({
    label: "Mint",
    swatchClass: "bg-emerald-500",
    usernameClass: "text-emerald-800 dark:text-emerald-300 font-bold",
    usernameLightHex: "#065f46",
    usernameDarkHex: "#6ee7b7",
    titleHex: "#10b981",
  }),
  LIME: titleStyle({
    label: "Lime",
    swatchClass: "bg-lime-500",
    usernameClass: "text-lime-800 dark:text-lime-300 font-bold",
    usernameLightHex: "#3f6212",
    usernameDarkHex: "#bef264",
    titleHex: "#84cc16",
  }),
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
