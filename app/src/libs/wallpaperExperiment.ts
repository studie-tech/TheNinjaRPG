import {
  IMG_WALLPAPER_HORIZON,
  IMG_WALLPAPER_HYORIN,
  IMG_WALLPAPER_TSUKIMORI,
} from "@/drizzle/constants";
import { getRandomElement } from "@/utils/array";

// Freeze village artwork for the run instead of fetching mutable village settings at
// request time: the prerendered image, preload, and experiment label must agree.
// Version the cookie when changing the candidate set; assignments remain stable within a run.
export const WALLPAPER_EXPERIMENT = "ab_wallpaper_2";
export const WALLPAPER_VARIANTS = ["control", "hyorin", "tsukimori"] as const;
export type WallpaperVariant = (typeof WALLPAPER_VARIANTS)[number];
export const WALLPAPER_IMAGES: Record<WallpaperVariant, string> = {
  control: IMG_WALLPAPER_HORIZON,
  hyorin: IMG_WALLPAPER_HYORIN,
  tsukimori: IMG_WALLPAPER_TSUKIMORI,
};
export const parseWallpaperVariant = (
  value?: string | null,
): WallpaperVariant | undefined =>
  WALLPAPER_VARIANTS.find((variant) => variant === value);

/** Pick a configured wallpaper assignment, falling back to the control variant. */
export const drawWallpaperVariant = (): WallpaperVariant =>
  getRandomElement(WALLPAPER_VARIANTS) ?? "control";

export const WALLPAPER_LABELS: Record<WallpaperVariant, string> = {
  control: "Horizon (control)",
  hyorin: "Hyorin",
  tsukimori: "Tsukimori",
};
export const wallpaperLabel = (variant: string) => {
  const known = parseWallpaperVariant(variant);
  return known ? WALLPAPER_LABELS[known] : variant;
};
