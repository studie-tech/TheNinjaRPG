import { z } from "zod";

/**
 * Schema for specifying item/jutsu/AI IDs with drop chance and quantity.
 * Used in objectives for attackers, rewards, and other ID-based fields.
 */
export const idsWithNumberField = z
  .array(
    z.object({
      ids: z.array(z.string()).default([]),
      number: z.number().default(100), // Drop chance % (0-100), default 100 = guaranteed
      quantity: z.number().default(1), // How many items to give
    }),
  )
  .default([]);
