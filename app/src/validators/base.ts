import { z } from "zod";

export const baseServerResponse = z.object({
  success: z.boolean(),
  message: z.string(),
});
export type BaseServerResponse = z.infer<typeof baseServerResponse>;

/** Read the literal `type` that discriminates a tag, AI condition or AI action schema. */
export const literalType = (schema: {
  shape: { type: { unwrap(): { value: unknown } } };
}) => schema.shape.type.unwrap().value as string;

/** Optional integer stored in SQL: blank, null and omitted values all become null. */
export const makeCappedNullableNumber = (max: number, min = 0) =>
  z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? null : value),
    z.coerce.number().int().min(min).max(max).nullable(),
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
