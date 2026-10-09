import { z } from "zod";
import { BanStates } from "@/drizzle/constants";

export const moderationDecisionSchema = z.object({
  createReport: z.enum(BanStates),
  reasoning: z.string(),
});

export const nsfwClassificationSchema = z.object({
  isNsfw: z.boolean(),
  reason: z.string(),
});

export const updateReasonValidationSchema = z.object({
  allowUpdate: z.boolean(),
  comment: z.string(),
});
