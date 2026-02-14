import { z } from "zod";

export const createMoneyTransferSchema = (maxAmount: number) =>
  z.object({
    amount: z.coerce.number().int().positive().max(maxAmount),
  });

export type MoneyTransferSchemaInput = z.input<
  ReturnType<typeof createMoneyTransferSchema>
>;
export type MoneyTransferSchema = z.infer<ReturnType<typeof createMoneyTransferSchema>>;
