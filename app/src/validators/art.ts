import { z } from "zod";

export const sortOptions = ["Most Recent", "Most Liked"] as const;
export const timeFrame = ["Week", "Month", "Year", "All Time"] as const;
export const mediaTypes = ["image", "video"] as const;

export const conceptArtPromptSchema = z.object({
  prompt: z.string().min(0).default(""),
  seed: z
    .number()
    .int()
    .min(0)
    .max(4294967295)
    .default(() => Math.floor(Math.random() * 1000000)),
});
export type ConceptPromptType = z.infer<typeof conceptArtPromptSchema>;

export const conceptVideoPromptSchema = z.object({
  prompt: z.string().min(1, "Prompt is required"),
  negative_prompt: z.string().optional().default(""),
  seed: z
    .number()
    .int()
    .min(0)
    .max(4294967295)
    .default(() => Math.floor(Math.random() * 1000000)),
  start_image: z
    .string()
    .url()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  last_image: z
    .string()
    .url()
    .optional()
    .or(z.literal("").transform(() => undefined)),
});
export type ConceptVideoPromptType = z.infer<typeof conceptVideoPromptSchema>;

export const conceptArtFilterSchema = z.object({
  only_own: z.boolean().default(false),
  sort: z.enum(sortOptions).default("Most Recent"),
  time_frame: z.enum(timeFrame).default("Week"),
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
