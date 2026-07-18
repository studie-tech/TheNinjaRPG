import { z } from "zod";

export const mapAssetValidator = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(191)
    .regex(
      /^[a-z0-9]+(\.[a-z0-9]+)*$/,
      "Key must be lowercase dot-separated segments, e.g. tree.green.round",
    ),
  name: z.string().trim().min(1).max(191),
  category: z.string().trim().min(1).max(191),
  imageUrl: z.string().url(),
  windAffected: z.boolean(),
  small: z.boolean(),
  randomRotation: z.boolean(),
  renderScale: z.coerce.number().min(0.2).max(5),
  licenseDetails: z.string().max(2048),
});
export type ZodMapAssetType = z.infer<typeof mapAssetValidator>;
/** Form-input shape (renderScale arrives as a string before coercion) */
export type ZodMapAssetTypeInput = z.input<typeof mapAssetValidator>;
