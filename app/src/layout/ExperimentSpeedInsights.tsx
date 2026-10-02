"use client";

import { SpeedInsights } from "@vercel/speed-insights/next";
import type { WallpaperVariant } from "@/libs/wallpaperExperiment";
import { usePublicPathname } from "@/utils/routing";

export const ExperimentSpeedInsights = ({
  wallpaper,
}: {
  wallpaper?: WallpaperVariant;
}) => {
  const pathname = usePublicPathname();
  // Keep the existing sample rate and automatic grouping on game routes. On the
  // landing page, bounded route labels expose LCP/CLS/INP per assigned wallpaper.
  const route = pathname === "/" && wallpaper ? `/wallpaper/${wallpaper}` : undefined;
  return <SpeedInsights sampleRate={0.03} {...(route ? { route } : {})} />;
};
