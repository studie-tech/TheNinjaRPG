import { z } from "zod";
import { PARENTAL_MAX_APPROVED_PLAYERS } from "@/drizzle/constants";

/** A string preserves leading zeroes in six-digit PINs. */
export const parentalPinSchema = z.string().regex(/^\d{6}$/, "Enter a six-digit PIN");
/** Every save, including disabling controls, supplies a PIN and the loaded version. */
export const parentalSettingsSchema = z.object({
  enabled: z.boolean(),
  tavernDisabled: z.boolean(),
  privateMessages: z.enum(["EVERYONE", "APPROVED", "NONE"]),
  approvedUserIds: z
    .array(z.string().min(1).max(191))
    .max(PARENTAL_MAX_APPROVED_PLAYERS),
  pin: parentalPinSchema,
  newPin: parentalPinSchema.optional(),
  version: z.number().int().nonnegative(),
});
