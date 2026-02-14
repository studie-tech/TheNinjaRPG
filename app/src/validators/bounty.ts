import { z } from "zod";

export const createBountySchema = z.object({
  targetUserId: z.string().min(1),
  amountRyo: z.coerce.number().int().min(1),
});

export type CreateBountySchema = z.infer<typeof createBountySchema>;

export const signupBountySchema = z.object({
  bountyId: z.string().min(1),
  targetUserId: z.string().min(1),
});
export type SignupBountySchema = z.infer<typeof signupBountySchema>;

export const trackBountySchema = z.object({
  bountyId: z.string().min(1),
});
export type TrackBountySchema = z.infer<typeof trackBountySchema>;

export const resignBountySchema = z.object({
  claimId: z.string().min(1),
});
export type ResignBountySchema = z.infer<typeof resignBountySchema>;

export const retractBountySchema = z.object({
  bountyId: z.string().min(1),
});
export type RetractBountySchema = z.infer<typeof retractBountySchema>;

export const bountyBoardFilterSchema = z.object({
  cursor: z.number().nullish(),
  limit: z.number().min(1).max(100).prefault(30),
  showCompleted: z.boolean().prefault(false),
  status: z.enum(["OPEN", "CLAIMED", "EXPIRED", "CANCELLED", "all"]).prefault("OPEN"),
});

export const collectBountySchema = z.object({
  bountyId: z.string().min(1),
});
export type CollectBountySchema = z.infer<typeof collectBountySchema>;

export const addBountyMoneySchema = z.object({
  bountyId: z.string().min(1),
  amountRyo: z.number().min(1),
});
export type AddBountyMoneySchema = z.infer<typeof addBountyMoneySchema>;
