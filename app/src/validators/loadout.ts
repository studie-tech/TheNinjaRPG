import { z } from "zod";
import { LOADOUT_NAME_MAX_LENGTH } from "@/drizzle/constants";
import { hotkeyMapSchema } from "@/libs/combat/hotkeys";

export const renameLoadoutSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(LOADOUT_NAME_MAX_LENGTH),
});
export type RenameLoadoutSchema = z.infer<typeof renameLoadoutSchema>;

/** Replace one loadout's battle keys; used by both jutsu and item loadouts. */
export const setLoadoutHotkeysSchema = z.object({
  id: z.string().min(1).max(191),
  hotkeys: hotkeyMapSchema,
});
export type SetLoadoutHotkeysSchema = z.infer<typeof setLoadoutHotkeysSchema>;

/** Fit the maximum entry count even when JSON escapes every ID character. */
export const LOADOUT_SHARE_MAX_LENGTH = 128 * 1024;
/** Bound pasted preview work independently of the recipient's current equip allowance. */
export const LOADOUT_SHARE_MAX_ENTRIES = 100;
/** Match the database's ID width for both shared jutsu and destination slots. */
const sharedIdSchema = z.string().trim().min(1).max(191);

/** Versioned ordinary-jutsu payload; reject extra fields and preserve first occurrence order. */
export const sharedJutsuLoadoutSchema = z
  .object({
    type: z.literal("tnr-jutsu-loadout"),
    version: z.literal(1),
    jutsuIds: z.array(sharedIdSchema).max(LOADOUT_SHARE_MAX_ENTRIES),
  })
  .strict()
  .transform((value) => ({ ...value, jutsuIds: [...new Set(value.jutsuIds)] }));

/** Decode bounded JSON into the shared format, reporting parse failures as schema issues. */
export const sharedJutsuLoadoutTextSchema = z
  .string()
  .min(1)
  .max(LOADOUT_SHARE_MAX_LENGTH)
  .transform((text, ctx): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      ctx.addIssue({ code: "custom", message: "Invalid loadout JSON" });
      return z.NEVER;
    }
  })
  .pipe(sharedJutsuLoadoutSchema);

/** Defer JSON decoding to preparation so malformed text uses the normal mutation response. */
export const previewJutsuLoadoutSchema = z.object({
  loadoutId: sharedIdSchema,
  text: z.string().min(1).max(LOADOUT_SHARE_MAX_LENGTH),
});

/** Carry the preview fingerprint; the import endpoint recomputes recipient authorization. */
export const importJutsuLoadoutSchema = previewJutsuLoadoutSchema.extend({
  previewToken: z.string().regex(/^[a-f0-9]{64}$/),
});
