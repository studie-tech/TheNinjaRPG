import {
  IMG_WALLPAPER_AKASUMI,
  IMG_WALLPAPER_AKIKAZE,
  IMG_WALLPAPER_FALL,
  IMG_WALLPAPER_HALLOWEEN,
  IMG_WALLPAPER_HORIZON,
  IMG_WALLPAPER_HYORIN,
  IMG_WALLPAPER_SHIROHANA,
  IMG_WALLPAPER_SPRING,
  IMG_WALLPAPER_SUMMER,
  IMG_WALLPAPER_TSUKIMORI,
  IMG_WALLPAPER_WINTER,
} from "@/drizzle/constants";

// Freeze village artwork for the run instead of fetching mutable village settings at
// request time: the prerendered image, preload, and experiment label must agree.
// Version the cookie when changing the candidate set; assignments remain stable within a run.
export const WALLPAPER_EXPERIMENT = "ab_wallpaper_1";
export const WALLPAPER_VARIANTS = [
  "control",
  "spring",
  "summer",
  "winter",
  "halloween",
  "akikaze",
  "hyorin",
  "tsukimori",
  "akasumi",
  "shirohana",
  "horizon",
] as const;
export type WallpaperVariant = (typeof WALLPAPER_VARIANTS)[number];
export const WALLPAPER_IMAGES: Record<WallpaperVariant, string> = {
  control: IMG_WALLPAPER_FALL,
  spring: IMG_WALLPAPER_SPRING,
  summer: IMG_WALLPAPER_SUMMER,
  winter: IMG_WALLPAPER_WINTER,
  halloween: IMG_WALLPAPER_HALLOWEEN,
  akikaze: IMG_WALLPAPER_AKIKAZE,
  hyorin: IMG_WALLPAPER_HYORIN,
  tsukimori: IMG_WALLPAPER_TSUKIMORI,
  akasumi: IMG_WALLPAPER_AKASUMI,
  shirohana: IMG_WALLPAPER_SHIROHANA,
  horizon: IMG_WALLPAPER_HORIZON,
};
export const parseWallpaperVariant = (
  value?: string | null,
): WallpaperVariant | undefined =>
  WALLPAPER_VARIANTS.find((variant) => variant === value);

export const WALLPAPER_LABELS: Record<WallpaperVariant, string> = {
  control: "Fall (control)",
  spring: "Spring",
  summer: "Summer",
  winter: "Winter",
  halloween: "Halloween",
  akikaze: "Akikaze",
  hyorin: "Hyorin",
  tsukimori: "Tsukimori",
  akasumi: "Akasumi",
  shirohana: "Shirohana",
  horizon: "Horizon",
};
export const wallpaperLabel = (variant: string) => {
  const known = parseWallpaperVariant(variant);
  return known ? WALLPAPER_LABELS[known] : variant;
};
