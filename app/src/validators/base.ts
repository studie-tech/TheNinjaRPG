import { z } from "zod";

export const baseServerResponse = z.object({
  success: z.boolean(),
  message: z.string(),
});
export type BaseServerResponse = z.infer<typeof baseServerResponse>;

/** Optional integer prerequisite stored in SQL: blank, null and omitted values are ungated. */
export const makeCappedNullableNumber = (max: number) =>
  z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? null : value),
    z.coerce.number().int().min(0).max(max).nullable(),
  );

/**
 * Schema for specifying item/jutsu/AI IDs with drop chance and quantity.
 * Used in objectives for attackers, rewards, and other ID-based fields.
 */
export const idsWithNumberField = z
  .array(
    z.object({
      ids: z.array(z.string()).prefault([]),
      number: z.number().prefault(100), // Drop chance % (0-100), default 100 = guaranteed
      quantity: z.number().prefault(1), // How many items to give
    }),
  )
  .prefault([]);
