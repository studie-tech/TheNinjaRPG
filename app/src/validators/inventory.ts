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

/** A confirmed durability write against the loaded baseline. */
export const inventoryDurabilityChangeSchema = z.object({
  id: z.string(),
  beforeDurability: z.number().int().nonnegative(),
  durability: z.number().int().nonnegative(),
});

export type InventoryDurabilityChange = z.infer<typeof inventoryDurabilityChangeSchema>;

/** A confirmed stack split: the source's remaining quantity and the new stack it created. */
export const inventorySplitSchema = z.object({
  id: z.string(),
  beforeQuantity: z.number().int().positive(),
  quantity: z.number().int().positive(),
  newUserItemId: z.string(),
  splitQuantity: z.number().int().positive(),
  createdAt: z.date(),
});

export type InventorySplit = z.infer<typeof inventorySplitSchema>;
