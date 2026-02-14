import { z } from "zod";

export const sortOptions = ["Most Recent", "Most Liked"] as const;
export type SortOption = (typeof sortOptions)[number];

export const timeFrame = ["Week", "Month", "Year", "All Time"] as const;
export type TimeFrame = (typeof timeFrame)[number];
export const mediaTypes = ["image", "video"] as const;

export const conceptArtPromptSchema = z.object({
  prompt: z.string().min(0).prefault(""),
  seed: z
    .int()
    .min(0)
    .max(4294967295)
    .prefault(() => Math.floor(Math.random() * 1000000)),
});
export type ConceptPromptType = z.infer<typeof conceptArtPromptSchema>;

export const conceptVideoPromptSchema = z.object({
  prompt: z.string().min(1, "Prompt is required"),
  negative_prompt: z.string().optional().prefault(""),
  seed: z
    .int()
    .min(0)
    .max(4294967295)
    .prefault(() => Math.floor(Math.random() * 1000000)),
  start_image: z
    .url()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  last_image: z
    .url()
    .optional()
    .or(z.literal("").transform(() => undefined)),
});
export type ConceptVideoPromptType = z.infer<typeof conceptVideoPromptSchema>;

export const conceptArtFilterSchema = z.object({
  only_own: z.boolean().prefault(false),
  sort: z.enum(sortOptions).prefault("Most Recent"),
  time_frame: z.enum(timeFrame).prefault("Week"),
});
export type ConceptFilterType = z.infer<typeof conceptArtFilterSchema>;

export const getTimeFrameinSeconds = (
  timeString: (typeof timeFrame)[number],
): number | null => {
  switch (timeString) {
    case "Week":
      return 7 * 24 * 60 * 60;
    case "Month":
      return 30 * 24 * 60 * 60;
    case "Year":
      return 365 * 24 * 60 * 60;
    case "All Time":
      return null;
    default:
      return null;
  }
};
