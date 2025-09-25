import { z } from "zod";

export const awardSchema = z
  .object({
    reputationAmount: z.coerce.number().min(0).max(100).optional(),
    moneyAmount: z.coerce.number().min(0).max(100000000).optional(),
    reason: z.string().min(1, "Reason is required"),
    userIds: z.array(z.string()).min(1, "At least one user must be selected"),
  })
  .refine((data) => data.reputationAmount || data.moneyAmount, {
    message: "Either reputation or money amount must be provided",
  });

export type AwardSchema = z.infer<typeof awardSchema>;

// Filtering schema for listing awards
export const awardsFilteringSchema = z.object({
  rewardType: z.enum(["all", "reputation", "money", "both"]).default("all"),
  awardedTo: z.string().optional(), // receiver username contains
  awardedBy: z.string().optional(), // awardedBy username contains
  date: z.string().optional(),
});

export type AwardsFilteringSchema = z.infer<typeof awardsFilteringSchema>;
