import { z } from "zod";
import { ObjectiveReward } from "@/validators/rewards";
import { userDeltaResponseSchema } from "@/validators/userCache";

export const joinRaidQueueResponseSchema = userDeltaResponseSchema.extend({
  teamId: z.string().optional(),
});

export const thresholdFormSchema = z.object({
  damageRequired: z.coerce.number().min(1, "Damage must be at least 1"),
  sortOrder: z.coerce.number().min(0).max(255).prefault(0),
  effectDurationMinutes: z.coerce.number().min(1).max(10080).prefault(60),
  rewards: ObjectiveReward,
});

export type ThresholdFormData = z.infer<typeof thresholdFormSchema>;
export type ThresholdFormDataInput = z.input<typeof thresholdFormSchema>;
