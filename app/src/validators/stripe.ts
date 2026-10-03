import { z } from "zod";

export const stripeCheckoutSchema = z.object({
  requestId: z.string().regex(/^[A-Za-z0-9_-]{21}$/),
  expectedUserId: z.string().min(1).max(191),
  userId: z.string().min(1).max(191),
  purchase: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("reputation"),
      reputationPoints: z.number().int().min(5),
    }),
    z.object({
      type: z.literal("federal"),
      federalStatus: z.enum(["NORMAL", "SILVER", "GOLD"]),
    }),
  ]),
});
export const stripeSessionSchema = z.object({
  sessionId: z
    .string()
    .regex(/^cs_(?:test_|live_)?[A-Za-z0-9]+$/)
    .max(255),
});
export const stripeSubscriptionSchema = z.object({
  checkoutId: z.string().min(1).max(191),
});
