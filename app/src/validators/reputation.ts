import { z } from "zod";

export const awardSchema = z
  .object({
    reputationAmount: z.coerce.number().min(0).max(100).optional(),
    moneyAmount: z.coerce.number().min(0).max(100000000).optional(),
    reason: z.string().min(1, "Reason is required"),
    userIds: z.array(z.string()).min(1, "At least one user must be selected"),
  })
  .refine((data) => data.reputationAmount || data.moneyAmount, {
    error: "Either reputation or money amount must be provided",
  });

export type AwardSchema = z.infer<typeof awardSchema>;

/**
 * The mutation carries an immutable recipient snapshot and an idempotency key in addition to the
 * editable award fields. Keeping this separate from {@link awardSchema} means the same schema can
 * still drive the form without manufacturing request metadata before the user confirms it.
 */
export const awardRequestSchema = awardSchema.extend({
  requestId: z.string().uuid(),
  expectedUsers: z
    .array(
      z.object({
        userId: z.string().min(1),
        username: z.string().min(1).max(191),
      }),
    )
    .min(1)
    .max(10),
});

// Filtering schema for listing awards
export const awardsFilteringSchema = z.object({
  rewardType: z.enum(["all", "reputation", "money", "both"]).prefault("all"),
  awardedTo: z.string().optional(), // receiver username contains
  awardedBy: z.string().optional(), // awardedBy username contains
  date: z.string().optional(),
});

export type AwardsFilteringSchema = z.infer<typeof awardsFilteringSchema>;
