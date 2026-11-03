import { z } from "zod";
import { GameAssetTypes } from "@/drizzle/constants";
import { lpcConfigValidator } from "@/validators/lpcAsset";

/** Asset edit payload shared by content forms and server mutation validation. */
export const gameAssetValidator = z.object({
  lpcConfig: lpcConfigValidator.nullable().optional(),
  name: z.string().min(1).max(191),
  image: z.url(),
  frames: z.coerce.number().int().min(1).max(100),
  speed: z.coerce.number().int().min(1).max(100),
  type: z.enum(GameAssetTypes),
  licenseDetails: z.string().min(1).max(512),
  onInitialBattleField: z.boolean(),
  hidden: z.coerce.boolean().optional(),
  url: z.url().optional(),
  folder: z
    .string()
    .max(191)
    .regex(/^[a-zA-Z0-9]*$/, "Folder name can only contain letters and numbers")
    .optional(),
});

export type ZodGameAssetType = z.output<typeof gameAssetValidator>;
export type ZodGameAssetInput = z.input<typeof gameAssetValidator>;
