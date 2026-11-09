import { z } from "zod";
import { MAX_LINK_PROMOTION_POINTS } from "@/drizzle/constants";

export const linkPromotionSchema = z.object({
  url: z.url("Please enter a valid URL (with http/https protocol)"),
});

export const linkPromotionReviewSchema = z.object({
  id: z.string().min(1, "Promotion ID is required"),
  points: z
    .int("Points must be a whole number")
    .min(0, "Points must be at least 0")
    .max(
      MAX_LINK_PROMOTION_POINTS,
      `Points cannot exceed ${MAX_LINK_PROMOTION_POINTS}`,
    ),
});

export type LinkPromotionInput = z.infer<typeof linkPromotionSchema>;
export type LinkPromotionReviewInput = z.infer<typeof linkPromotionReviewSchema>;
