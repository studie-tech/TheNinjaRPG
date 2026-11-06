import { z } from "zod";
import type { UserData } from "@/drizzle/schema";
import type { UserCachePatch } from "@/validators/userCache";

/** Final committed activity remains projectable when other mutation effects are withheld. */
export type UserRecoveryActivity = Pick<UserData, "status"> &
  Partial<Pick<UserData, "battleId" | "travelFinishAt">>;

/** Confirmed recovery includes final activity even when other cache effects are unavailable. */
export type UserRecovery = {
  userId: string;
  activity?: UserRecoveryActivity;
  userPatch?: UserCachePatch;
  /** A live SQL-dependent effect is not fully represented by the known fields. */
  requiresUserRefresh?: boolean;
};

/** Shared output metadata for endpoint-local recovery, including custom mutation envelopes. */
export const userRecoverySchema = z.custom<UserRecovery>().optional();

export const baseServerResponse = z.object({
  success: z.boolean(),
  message: z.string(),
  // Endpoints report only recovery committed by their guarded account write.
  actionNotice: z.string().optional(),
  userRecovery: userRecoverySchema,
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
