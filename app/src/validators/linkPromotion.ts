import { z } from "zod";

export const linkPromotionSchema = z.object({
  url: z
    .url("Please enter a valid URL (with http/https protocol)")
    .min(1, "URL is required")
    .refine((url) => {
      try {
        new URL(url);
        return true;
      } catch {
        return false;
      }
    }, "Invalid URL format"),
});

export const linkPromotionReviewSchema = z.object({
  id: z.string().min(1, "Promotion ID is required"),
  points: z
    .int("Points must be a whole number")
    .min(0, "Points must be at least 0")
    .max(500, "Points cannot exceed 500"),
});

export type LinkPromotionInput = z.infer<typeof linkPromotionSchema>;
export type LinkPromotionReviewInput = z.infer<typeof linkPromotionReviewSchema>;
