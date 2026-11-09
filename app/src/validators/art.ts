import { z } from "zod";
import { MONTH_S, WEEK_S, YEAR_S } from "@/utils/time";

export const sortOptions = ["Most Recent", "Most Liked"] as const;
export type SortOption = (typeof sortOptions)[number];

export const timeFrame = ["Week", "Month", "Year", "All Time"] as const;
export type TimeFrame = (typeof timeFrame)[number];

export const conceptArtPromptSchema = z.object({
  prompt: z.string().max(5000, "Prompt cannot exceed 5000 characters").prefault(""),
  seed: z
    .int()
    .min(0)
    .max(2147483647, "Seed cannot exceed 2147483647")
    .prefault(() => Math.floor(Math.random() * 1000000)),
});

export const conceptVideoPromptSchema = z.object({
  prompt: z
    .string()
    .min(1, "Prompt is required")
    .max(5000, "Prompt cannot exceed 5000 characters"),
  negative_prompt: z
    .string()
    .max(5000, "Negative prompt cannot exceed 5000 characters")
    .optional()
    .prefault(""),
  seed: z
    .int()
    .min(0)
    .max(2147483647, "Seed cannot exceed 2147483647")
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

export const conceptArtFilterSchema = z.object({
  only_own: z.boolean().prefault(false),
  sort: z.enum(sortOptions).prefault("Most Recent"),
  time_frame: z.enum(timeFrame).prefault("Month"),
});

/** Convert an artwork ranking period to seconds, with null denoting all time. */
export const getTimeFrameinSeconds = (
  timeString: (typeof timeFrame)[number],
): number | null => {
  switch (timeString) {
    case "Week":
      return WEEK_S;
    case "Month":
      return MONTH_S;
    case "Year":
      return YEAR_S;
    case "All Time":
      return null;
  }
};
