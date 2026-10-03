import { z } from "zod";

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

export const paypalSubscriptionSchema = z.strictObject({
  subscriptionId: z.string().min(1).max(191),
  orderId: z.string().min(1).max(191).optional(),
});
