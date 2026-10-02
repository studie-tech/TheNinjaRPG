import { z } from "zod";
import { WALLPAPER_VARIANTS } from "@/libs/wallpaperExperiment";

export const abTestFilterSchema = z.object({
  startDate: z.union([z.iso.date(), z.iso.datetime()]).optional(),
  endDate: z.union([z.iso.date(), z.iso.datetime()]).optional(),
  utmSource: z.string().max(191).optional(),
  deviceType: z.array(z.enum(["mobile", "desktop", "unknown"])).optional(),
});
export const trackVisitorSchema = z.object({
  ref: z.string().max(191).optional(),
  utmSource: z.string().max(191).optional(),
  wallpaperVariant: z.enum(WALLPAPER_VARIANTS).optional(),
});
