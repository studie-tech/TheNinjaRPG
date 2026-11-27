import { z } from "zod";
import { AllTags } from "@/validators/combat";

/** A saved tag snapshot prevents content edits from redirecting an upgrade. */
export const bloodrightChangeSchema = z.object({
  tagIndex: z.int().min(0),
  tag: AllTags,
  field: z.string().min(1),
  mode: z.enum(["FLAT", "PERCENT"]),
  value: z.number().finite().positive(),
});
export const bloodrightOptionSchema = z.object({
  bloodlineId: z.string().min(1),
  jutsuId: z.string().min(1),
  name: z.string().trim().min(1).max(191),
  description: z.string().max(10000),
  seichiSilverCost: z.int().min(0).max(2147483647),
  hidden: z.boolean(),
  changes: z.array(bloodrightChangeSchema).min(1).max(100),
});
export type BloodrightChange = z.infer<typeof bloodrightChangeSchema>;
export type BloodrightOptionData = z.infer<typeof bloodrightOptionSchema>;

export type BloodrightOptionInput = z.input<typeof bloodrightOptionSchema>;

/** Compact, validated operations captured in battle state. */
export type BloodrightAppliedChange = Omit<BloodrightChange, "tag"> & {
  tagType: BloodrightChange["tag"]["type"];
};
