import { z } from "zod";

/** Confirmed stack quantities shared by item mutations and quest item costs. */
export const inventoryQuantityChangeSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  beforeQuantity: z.number().int().nonnegative(),
  quantity: z.number().int().nonnegative(),
  updatedAt: z.date().optional(),
});

export type InventoryQuantityChange = z.infer<typeof inventoryQuantityChangeSchema>;
