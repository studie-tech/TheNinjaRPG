import { z } from "zod";

export const createBountySchema = z.object({
  targetUserId: z.string().min(1),
  amountRyo: z.coerce.number().int().min(1),
});

export const addBountyMoneySchema = z.object({
  bountyId: z.string().min(1),
  amountRyo: z.number().int().min(1),
});
