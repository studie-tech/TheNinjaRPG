"use client";

import {
  IMG_LAYOUT_HANDSIGN,
  IMG_LAYOUT_HANDSIGN_HALLOWEEN,
  IMG_LAYOUT_NAVBAR,
  IMG_LAYOUT_NAVBAR_HALLOWEEN,
  IMG_PIXEL_HERO_POSTER,
  IMG_WALLPAPER_FALL,
  IMG_WALLPAPER_SPRING,
  IMG_WALLPAPER_SUMMER,
  IMG_WALLPAPER_WINTER,
} from "@/drizzle/constants";
import type { UserWithRelations } from "@/routers/profile";
import { getCurrentSeason } from "@/utils/time";

export type LayoutVariant = "beta" | "pixel";

export const PIXEL_FALLBACK_WALLPAPER = IMG_PIXEL_HERO_POSTER;

export const ANONYMOUS_PIXEL_NAV_LINKS = [
  { href: "/#world", name: "World" },
  { href: "/#features", name: "Features" },
  { href: "/#gameplay", name: "Gameplay" },
  { href: "/#community", name: "Community" },
];

export const BETA_YELLOW_BUTTON_STYLE =
  "h-14 w-14 sm:h-15 sm:w-15 md:h-16 md:w-16 bg-yellow-500 hover:bg-yellow-300 transition-colors text-orange-100 rounded-full p-3 shadow-md shadow-black border-2 stroke-3";

export const PIXEL_YELLOW_BUTTON_STYLE =
  "h-14 w-14 rounded-md border-2 bg-yellow-500 stroke-3 p-3 text-orange-100 shadow-black shadow-md transition-colors hover:bg-yellow-300 sm:h-15 sm:w-15 md:h-16 md:w-16";

export const MOBILE_NAVBAR_BUTTON_STYLE =
  "h-16 w-16  hover:text-red-300 transition-colors text-orange-100 bg-opacity-50 p-2";

export const PIXEL_MOBILE_HEADER_BUTTON_STYLE = "tnr-ink-mobile-icon-btn";
export const PIXEL_MOBILE_HEADER_ICON_STYLE = "h-5 w-5";

export const PIXEL_SIGNED_IN_SHELL_SURFACE =
  "tnr-pixel-clip border border-sky-200/15 bg-black/50 shadow-2xl shadow-black/30 backdrop-blur-sm";

export const layoutVariantClasses = {
  beta: {
    yellowButton: BETA_YELLOW_BUTTON_STYLE,
    mobileNavbarButton: MOBILE_NAVBAR_BUTTON_STYLE,
    mainMenuButton: "w-full hover:bg-orange-200",
    mainMenuDecoration: "gold" as const,
    rightMenuButton: "relative w-full",
    rightMenuDecoration: "gold" as const,
  },
  pixel: {
    yellowButton: PIXEL_YELLOW_BUTTON_STYLE,
    mobileNavbarButton: MOBILE_NAVBAR_BUTTON_STYLE,
    mainMenuButton: "w-full tnr-pixel-menu-btn",
    mainMenuDecoration: "none" as const,
    rightMenuButton: "relative w-full tnr-pixel-menu-btn",
    rightMenuDecoration: "none" as const,
  },
};

// Note: getCurrentSeason uses UTC to ensure consistent results between server and client.
export const getImageSet = (userData?: UserWithRelations | null) => {
  const base = {
    navbar: IMG_LAYOUT_NAVBAR,
    handsign: IMG_LAYOUT_HANDSIGN,
    wallpaper: IMG_WALLPAPER_SUMMER,
  };

  switch (getCurrentSeason()) {
    case "winter":
      base.wallpaper = IMG_WALLPAPER_WINTER;
      break;
    case "spring":
      base.wallpaper = IMG_WALLPAPER_SPRING;
      break;
    case "summer":
      base.wallpaper = IMG_WALLPAPER_SUMMER;
      break;
    case "fall":
      base.wallpaper = IMG_WALLPAPER_FALL;
      break;
    case "halloween":
      base.wallpaper = IMG_WALLPAPER_FALL;
      base.navbar = IMG_LAYOUT_NAVBAR_HALLOWEEN;
      base.handsign = IMG_LAYOUT_HANDSIGN_HALLOWEEN;
      break;
  }

  if (userData?.village?.wallpaperOverwrite) {
    base.wallpaper = userData.village.wallpaperOverwrite;
  }

  return base;
};

export const getPixelWallpaper = (userData?: UserWithRelations | null) => {
  let wallpaper = IMG_WALLPAPER_SUMMER;

  switch (getCurrentSeason()) {
    case "winter":
      wallpaper = IMG_WALLPAPER_WINTER;
      break;
    case "spring":
      wallpaper = IMG_WALLPAPER_SPRING;
      break;
    case "summer":
      wallpaper = IMG_WALLPAPER_SUMMER;
      break;
    case "fall":
    case "halloween":
      wallpaper = IMG_WALLPAPER_FALL;
      break;
  }

  if (userData?.village?.wallpaperOverwrite) {
    wallpaper = userData.village.wallpaperOverwrite;
  }

  return wallpaper;
};
