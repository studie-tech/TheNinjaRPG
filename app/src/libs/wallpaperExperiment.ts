import {
  IMG_WALLPAPER_FALL,
  IMG_WALLPAPER_HALLOWEEN,
  IMG_WALLPAPER_SPRING,
  IMG_WALLPAPER_SUMMER,
  IMG_WALLPAPER_WINTER,
} from "@/drizzle/constants";

// Version the cookie when changing the candidate set; assignments remain stable within a run.
export const WALLPAPER_EXPERIMENT = "ab_wallpaper_1";
export const WALLPAPER_VARIANTS = [
  "control",
  "spring",
  "summer",
  "winter",
  "halloween",
] as const;
export type WallpaperVariant = (typeof WALLPAPER_VARIANTS)[number];
export const WALLPAPER_IMAGES: Record<WallpaperVariant, string> = {
  control: IMG_WALLPAPER_FALL,
  spring: IMG_WALLPAPER_SPRING,
  summer: IMG_WALLPAPER_SUMMER,
  winter: IMG_WALLPAPER_WINTER,
  halloween: IMG_WALLPAPER_HALLOWEEN,
};
export const parseWallpaperVariant = (
  value?: string | null,
): WallpaperVariant | undefined =>
  WALLPAPER_VARIANTS.find((variant) => variant === value);
