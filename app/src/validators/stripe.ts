import { z } from "zod";

/** Purchasable game value shared by the shop controls and server-priced checkout. */
export const stripePurchaseSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("reputation"),
    reputationPoints: z.number().int().min(5),
  }),
  z.object({
    type: z.literal("federal"),
    federalStatus: z.enum(["NORMAL", "SILVER", "GOLD"]),
  }),
]);

/** Stripe subscription statuses that can no longer renew or be cancelled. */
export const isEndedSubscriptionStatus = (status: string) =>
  status === "canceled" || status === "incomplete_expired";
