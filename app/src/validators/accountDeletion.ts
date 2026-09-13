import { z } from "zod";

export const ACCOUNT_DELETION_CONFIRMATION = "DELETE MY ACCOUNT";
export const accountDeletionSchema = z
  .object({
    appleAuthorizationCode: z.string().min(1).max(4096).optional(),
    expectedUserId: z.string().min(1).max(191),
    confirmation: z.literal(ACCOUNT_DELETION_CONFIRMATION),
    understandsPermanentLoss: z.literal(true),
    understandsSubscriptions: z.literal(true),
  })
  .strict();

export const ACCOUNT_DELETION_REVERIFICATION = {
  level: "multi_factor",
  afterMinutes: 5,
} as const;
