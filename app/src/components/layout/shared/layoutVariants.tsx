"use client";

import {
  IMG_LAYOUT_HANDSIGN,
  IMG_LAYOUT_HANDSIGN_HALLOWEEN,
  IMG_LAYOUT_NAVBAR,
  IMG_LAYOUT_NAVBAR_HALLOWEEN,
  IMG_WALLPAPER_FALL,
  IMG_WALLPAPER_SPRING,
  IMG_WALLPAPER_SUMMER,
  IMG_WALLPAPER_WINTER,
} from "@/drizzle/constants";
import { getCurrentSeason } from "@/utils/time";

export const ANONYMOUS_PIXEL_NAV_LINKS = [
  { href: "/#world", name: "World" },
  { href: "/#features", name: "Features" },
  { href: "/#gameplay", name: "Gameplay" },
  { href: "/#community", name: "Community" },
];

const CLASSIC_YELLOW_BUTTON_STYLE =
  "h-14 w-14 sm:h-15 sm:w-15 md:h-16 md:w-16 bg-yellow-500 hover:bg-yellow-300 transition-colors text-orange-100 rounded-full p-3 shadow-md shadow-black border-2 stroke-3";

const PIXEL_YELLOW_BUTTON_STYLE =
  "h-14 w-14 rounded-md border-2 bg-yellow-500 stroke-3 p-3 text-orange-100 shadow-black shadow-md transition-colors hover:bg-yellow-300 sm:h-15 sm:w-15 md:h-16 md:w-16";

const MOBILE_NAVBAR_BUTTON_STYLE =
  "h-16 w-16  hover:text-red-300 transition-colors text-orange-100 bg-opacity-50 p-2";

export const PIXEL_MOBILE_HEADER_BUTTON_STYLE = "tnr-ink-mobile-icon-btn";
export const PIXEL_MOBILE_HEADER_ICON_STYLE = "h-5 w-5";

export const PIXEL_SIGNED_IN_SHELL_SURFACE =
  "tnr-pixel-clip border border-sky-200/15 bg-black/50 shadow-2xl shadow-black/30 backdrop-blur-sm";

const PANEL_MENU_CLASSES = {
  yellowButton: "theme-action-icon",
  mobileNavbarButton: "theme-mobile-nav-button",
  mainMenuButton: "w-full theme-menu-button",
  mainMenuDecoration: "none" as const,
  rightMenuButton: "relative w-full theme-menu-button",
  rightMenuDecoration: "none" as const,
  rightMenuEnabled: "",
  rightMenuDisabled: "opacity-40",
  leftSidebarReservation: undefined,
  rightSidebarReservation: undefined,
};

export const layoutVariantClasses = {
  "20-eclipse-observatory": PANEL_MENU_CLASSES,
  "17-obsidian-council": PANEL_MENU_CLASSES,
  "3-sakura-courtyard": PANEL_MENU_CLASSES,
  default: {
    yellowButton: CLASSIC_YELLOW_BUTTON_STYLE,
    mobileNavbarButton: MOBILE_NAVBAR_BUTTON_STYLE,
    mainMenuButton: "w-full hover:bg-orange-200",
    mainMenuDecoration: "gold" as const,
    rightMenuButton: "relative w-full",
    rightMenuDecoration: "gold" as const,
    rightMenuEnabled: "hover:bg-orange-200",
    rightMenuDisabled: "opacity-30",
    leftSidebarReservation: "md:min-h-[48.5rem]",
    rightSidebarReservation: "md:min-h-[29rem]",
  },
  pixel: {
    yellowButton: PIXEL_YELLOW_BUTTON_STYLE,
    mobileNavbarButton: MOBILE_NAVBAR_BUTTON_STYLE,
    mainMenuButton: "w-full tnr-pixel-menu-btn",
    mainMenuDecoration: "none" as const,
    rightMenuButton: "relative w-full tnr-pixel-menu-btn",
    rightMenuDecoration: "none" as const,
    rightMenuEnabled: "",
    rightMenuDisabled: "opacity-35",
    leftSidebarReservation: undefined,
    rightSidebarReservation: undefined,
  },
};

const SEASON_WALLPAPERS: Record<Season, string> = {
  winter: IMG_WALLPAPER_WINTER,
  spring: IMG_WALLPAPER_SPRING,
  summer: IMG_WALLPAPER_SUMMER,
  fall: IMG_WALLPAPER_FALL,
  halloween: IMG_WALLPAPER_FALL,
};

/** Resolve seasonal frame artwork, allowing a selected wallpaper to override the season. */
export const getImageSet = (
  wallpaperOverwrite?: string | null,
  season: Season = getCurrentSeason(),
) => {
  const isHalloween = season === "halloween";
  return {
    navbar: isHalloween ? IMG_LAYOUT_NAVBAR_HALLOWEEN : IMG_LAYOUT_NAVBAR,
    handsign: isHalloween ? IMG_LAYOUT_HANDSIGN_HALLOWEEN : IMG_LAYOUT_HANDSIGN,
    wallpaper: wallpaperOverwrite || SEASON_WALLPAPERS[season],
  };
};

type Season = ReturnType<typeof getCurrentSeason>;
