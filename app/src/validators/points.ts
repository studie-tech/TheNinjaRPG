import { z } from "zod";
import { FederalStatuses } from "@/drizzle/constants";
import { baseServerResponse } from "./base";

export const buyRepsSchema = z.object({
  reputationPoints: z.number().min(5).max(1000),
});

export type BuyRepsSchema = z.infer<typeof buyRepsSchema>;

export const searchPaypalTransactionSchema = z
  .strictObject({
    transactionId: z.string().min(4).max(255),
    transactionDate: z.date(),
  })
  .required();

export type SearchPaypalTransactionSchema = z.infer<
  typeof searchPaypalTransactionSchema
>;

export const paypalCheckoutSchema = z.strictObject({
  requestId: z
    .string()
    .length(21)
    .regex(/^[A-Za-z0-9_-]+$/),
  expectedUserId: z.string().min(1).max(191),
  userId: z.string().min(1).max(191),
  reputationPoints: z.number().int().min(5),
});
export const paypalCheckoutIdSchema = z.strictObject({
  requestId: z
    .string()
    .length(21)
    .regex(/^[A-Za-z0-9_-]+$/),
});
export const paypalOrderSchema = z.strictObject({
  orderId: z.string().min(15).max(20),
});

export const paypalSubscriptionIdSchema = z.strictObject({
  subscriptionId: z.string().min(1).max(191),
});
export const paypalSubscriptionSchema = paypalSubscriptionIdSchema.extend({
  orderId: z.string().min(1).max(191).optional(),
});

export const federalReputationPurchaseSchema = z.strictObject({
  userId: z.string().min(1).max(191),
  expectedUserId: z.string().min(1).max(191),
  status: z.enum(FederalStatuses),
});
export const federalUpgradeSchema = z.strictObject({
  userId: z.string().min(1).max(191),
  plan: z.enum(FederalStatuses),
});

export const paypalCaptureResponseSchema = baseServerResponse.extend({
  restartFunding: z.boolean().optional(),
});
