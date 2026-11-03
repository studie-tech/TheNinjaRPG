import { z } from "zod";

/** A store checkout lock persisted on the device until a terminal server receipt settles it. */
export const storePurchaseLockSchema = z.object({
  accountId: z.string(),
  attempt: z.object({
    transactionId: z.string().optional(),
    productId: z.string(),
    baselineReceiptIds: z.array(z.string()),
    baselineNativeTransactionIds: z.array(z.string()),
    phase: z.enum(["sheet-open", "payment-pending", "charged-or-pending"]),
    startedAt: z.string(),
  }),
});
