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
