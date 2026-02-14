import { z } from "zod";
import { ActivityStreakTypes } from "@/drizzle/constants";
import { rewardFields } from "./rewards";

// Reward schema - reuse from objectives
export const streakRewardSchema = z.object(rewardFields);
export type StreakRewardType = z.infer<typeof streakRewardSchema>;

// Single day reward configuration
export const streakDayRewardSchema = z.object({
  dayNumber: z.coerce.number().min(1).max(28),
  rewards: streakRewardSchema,
  image: z.url().optional().nullable(),
});
export type StreakDayRewardType = z.infer<typeof streakDayRewardSchema>;

// Base activity streak config fields (shared between create and update)
const activityStreakConfigBaseSchema = z.object({
  name: z.string().min(1, "Name is required").max(191),
  description: z.string().max(5000).optional().nullable(),
  image: z.url().optional().nullable(),
  totalDays: z.coerce.number().min(1).max(28).prefault(14),
  streakType: z.enum(ActivityStreakTypes).prefault("RECURRING"),
  isActive: z.boolean().prefault(true),
  ryoCost: z.coerce.number().min(0).prefault(0),
  repsCost: z.coerce.number().min(0).prefault(0),
  seichiSilverCost: z.coerce.number().min(0).prefault(0),
  startDate: z.coerce.date().optional().nullable(),
  endDate: z.coerce.date().optional().nullable(),
  rewards: z.array(streakDayRewardSchema).min(1).max(28),
});

// Validation refinement for activity streak configs
const activityStreakConfigRefinement = (
  val: z.infer<typeof activityStreakConfigBaseSchema>,
  ctx: z.RefinementCtx,
) => {
  const dayNumbers = val.rewards.map((r) => r.dayNumber);
  const uniqueDayNumbers = new Set(dayNumbers);

  // Check for duplicate day numbers
  if (uniqueDayNumbers.size !== dayNumbers.length) {
    ctx.addIssue({
      code: "custom",
      message: "Rewards contain duplicate day numbers",
      path: ["rewards"],
    });
  }

  // Check for day numbers exceeding totalDays
  const outOfRange = dayNumbers.find((d) => d > val.totalDays);
  if (outOfRange) {
    ctx.addIssue({
      code: "custom",
      message: `Reward dayNumber ${outOfRange} exceeds totalDays (${val.totalDays})`,
      path: ["rewards"],
    });
  }

  // Validate date range if both are provided
  if (val.startDate && val.endDate && val.startDate > val.endDate) {
    ctx.addIssue({
      code: "custom",
      message: "Start date must be before end date",
      path: ["endDate"],
    });
  }
};

// Activity streak configuration schema for create
export const activityStreakConfigSchema = activityStreakConfigBaseSchema.superRefine(
  activityStreakConfigRefinement,
);
export type ActivityStreakConfigInput = z.infer<typeof activityStreakConfigSchema>;

// Update schema includes id
export const activityStreakConfigUpdateSchema = activityStreakConfigBaseSchema
  .extend({ id: z.string() })
  .superRefine(activityStreakConfigRefinement);
export type ActivityStreakConfigUpdateInput = z.infer<
  typeof activityStreakConfigUpdateSchema
>;

// Schema for purchasing an event pass
export const purchaseEventPassSchema = z.object({
  configId: z.string(),
});
export type PurchaseEventPassInput = z.infer<typeof purchaseEventPassSchema>;

// Schema for claiming a streak day
export const claimStreakDaySchema = z.object({
  configId: z.string(),
  // If true, user pays rep to continue streak instead of resetting
  payCatchUp: z.boolean().optional().prefault(false),
  // If true, user explicitly wants to reset streak to day 1
  reset: z.boolean().optional().prefault(false),
});
export type ClaimStreakDayInput = z.infer<typeof claimStreakDaySchema>;

// Form schema for editing activity streak config (rewards managed separately in state)
export const activityStreakFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(191),
  description: z.string().max(5000).optional().nullable(),
  image: z.url().optional().nullable(),
  totalDays: z.coerce.number().min(1).max(28).prefault(14),
  streakType: z.enum(ActivityStreakTypes).prefault("RECURRING"),
  isActive: z.boolean().prefault(true),
  ryoCost: z.coerce.number().min(0).prefault(0),
  repsCost: z.coerce.number().min(0).prefault(0),
  seichiSilverCost: z.coerce.number().min(0).prefault(0),
  startDate: z.coerce.date().optional().nullable(),
  endDate: z.coerce.date().optional().nullable(),
});
export type ActivityStreakFormType = z.infer<typeof activityStreakFormSchema>;
