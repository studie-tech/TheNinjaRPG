import { z } from "zod";
import { BOUNTY_STATUSES } from "@/drizzle/constants";

export const createBountySchema = z.object({
  targetUserId: z.string().min(1),
  amountRyo: z.coerce.number().int().min(1),
});

export const signupBountySchema = z.object({
  bountyId: z.string().min(1),
  targetUserId: z.string().min(1),
});

export const resignBountySchema = z.object({
  claimId: z.string().min(1),
});

export const retractBountySchema = z.object({
  bountyId: z.string().min(1),
});

export const bountyBoardFilterSchema = z.object({
  cursor: z.number().nullish(),
  limit: z.number().min(1).max(100).prefault(30),
  status: z.enum([...BOUNTY_STATUSES, "all"]).prefault("OPEN"),
});

export const collectBountySchema = z.object({
  bountyId: z.string().min(1),
});

export const addBountyMoneySchema = z.object({
  bountyId: z.string().min(1),
  amountRyo: z.number().int().min(1),
});
