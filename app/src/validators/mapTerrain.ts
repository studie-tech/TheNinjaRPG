import { z } from "zod";
import { COMBAT_BIOMES } from "@/drizzle/constants";

const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Colors must be #rrggbb hex values");

export const mapTerrainValidator = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(191)
    .regex(
      /^[a-z0-9]+(\.[a-z0-9]+)*$/,
      "Key must be lowercase dot-separated segments, e.g. swamp or lava.field",
    ),
  name: z.string().trim().min(1).max(191),
  colors: z.tuple([hexColor, hexColor, hexColor]),
  textureUrl: z.string().url().nullable(),
  swatchColor: hexColor,
  battleBiome: z.enum(COMBAT_BIOMES),
  isWater: z.boolean(),
  depression: z.number().min(0).max(1),
  defaultWalkCost: z.number().int().min(1).max(50),
  licenseDetails: z.string().max(2048),
});
export type ZodMapTerrainType = z.infer<typeof mapTerrainValidator>;
