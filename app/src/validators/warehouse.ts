import { z } from "zod";
import { WAREHOUSE_LOG_TYPES } from "@/drizzle/constants";
import { baseServerResponse } from "@/validators/base";
import { inventoryQuantityChangeSchema } from "@/validators/inventory";

/**
 * Confirmed changes to the viewer's Warehouse view. Stock and allowance figures are amounts
 * added to the loaded values, the allowance only to a view of the same UTC day; deposit
 * candidates replace every loaded stack of their items.
 */
export const warehouseChangeSchema = z.object({
  stock: z
    .array(
      z.object({
        itemId: z.string(),
        quantity: z.number().int(),
        reserved: z.number().int(),
        /** Present when the change may create the item's first stock row. */
        item: z.object({ name: z.string(), image: z.string() }).optional(),
      }),
    )
    .optional(),
  allowanceUsed: z.object({ day: z.string(), quantity: z.number().int() }).optional(),
  candidates: z
    .object({
      itemIds: z.array(z.string()),
      rows: z.array(
        z.object({
          userItemId: z.string(),
          itemId: z.string(),
          name: z.string(),
          image: z.string(),
          quantity: z.number().int(),
          availableAt: z.date().nullable(),
        }),
      ),
    })
    .optional(),
  /** Village tokens, or clan points in faction settlements, added to the loaded funds. */
  funds: z.number().int().optional(),
  production: z.array(z.object({ itemId: z.string(), name: z.string() })).optional(),
  approval: z
    .object({
      userId: z.string(),
      row: z
        .object({
          userId: z.string(),
          username: z.string(),
          wartime: z.boolean(),
          active: z.boolean(),
        })
        .nullable(),
    })
    .optional(),
});

export type WarehouseChange = z.infer<typeof warehouseChangeSchema>;

/** Warehouse history rows a mutation wrote, in the shape the history pages list them. */
export const warehouseLogSchema = z.object({
  id: z.string(),
  type: z.enum(WAREHOUSE_LOG_TYPES),
  quantity: z.number().int(),
  createdAt: z.date(),
  itemName: z.string().nullable(),
  username: z.string().nullable(),
});

export type WarehouseLogEntry = z.infer<typeof warehouseLogSchema>;

/**
 * Response of mutations that move Warehouse stock. An absent change on success withholds
 * the view, which the client then reloads.
 */
export const warehouseResponseSchema = baseServerResponse.extend({
  warehouseChange: warehouseChangeSchema.optional(),
  warehouseLogs: z.array(warehouseLogSchema).optional(),
  inventoryChanges: z.array(inventoryQuantityChangeSchema).optional(),
});
