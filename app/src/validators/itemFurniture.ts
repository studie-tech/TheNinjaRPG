import { z } from "zod";
import {
  HOME_FURNITURE_MAX_WIDTH,
  HOME_FURNITURE_MIN_WIDTH,
  HomeFurnitureActions,
} from "@/drizzle/constants";
import type { Item } from "@/drizzle/schema";

/** Source-image percentages keep geometry independent of image resolution and CDN renditions. */
export const furnitureImageBoundsSchema = z
  .strictObject({
    x: z.coerce.number().min(0).max(100),
    y: z.coerce.number().min(0).max(100),
    width: z.coerce.number().positive().max(100),
    height: z.coerce.number().positive().max(100),
  })
  .refine((bounds) => bounds.x + bounds.width <= 100, {
    message: "Bounds must fit inside the image width",
    path: ["width"],
  })
  .refine((bounds) => bounds.y + bounds.height <= 100, {
    message: "Bounds must fit inside the image height",
    path: ["height"],
  });
export type FurnitureImageBounds = z.output<typeof furnitureImageBoundsSchema>;

/** Visible art frames selection; only its painted ground footprint occupies floor space. */
export const furnitureGeometrySchema = z.strictObject({
  aspectRatio: z.coerce.number().positive().max(10),
  visibleBounds: furnitureImageBoundsSchema,
  footprint: furnitureImageBoundsSchema,
});
export type FurnitureGeometry = z.output<typeof furnitureGeometrySchema>;

/** Each painted direction can correct its own floor footprint without changing item mechanics. */
export const furnitureViewSchema = z.strictObject({
  image: z.string().min(1, "Image required").max(512),
  width: z.coerce
    .number()
    .min(HOME_FURNITURE_MIN_WIDTH)
    .max(HOME_FURNITURE_MAX_WIDTH)
    .optional(),
  groundAnchor: z.coerce.number().min(1).max(100).optional(),
  geometry: furnitureGeometrySchema.optional(),
});

/** The canonical zero-degree view remains Item.image; absent directions are unavailable. */
export const furnitureViewsSchema = z
  .strictObject({
    "90": furnitureViewSchema.optional(),
    "180": furnitureViewSchema.optional(),
    "270": furnitureViewSchema.optional(),
  })
  .prefault({});
export type FurnitureViews = z.output<typeof furnitureViewsSchema>;

/** Cosmetic variants own their directional art and optional framing, sharing the item's mechanics. */
export const furnitureVariantDataSchema = furnitureViewSchema
  .omit({ image: true })
  .extend({ views: furnitureViewsSchema });
export type FurnitureVariantData = z.output<typeof furnitureVariantDataSchema>;

/** Content-authored sprite geometry and optional home action, stored together for extension. */
export const furnitureDataSchema = z.object({
  action: z
    .union([z.enum(HomeFurnitureActions), z.literal("")])
    .nullish()
    .transform((value) => value || null),
  width: z.coerce
    .number()
    .min(HOME_FURNITURE_MIN_WIDTH)
    .max(HOME_FURNITURE_MAX_WIDTH)
    .prefault(24),
  groundAnchor: z.coerce.number().min(1).max(100).prefault(100),
  isFloor: z.coerce.boolean().prefault(false),
  geometry: furnitureGeometrySchema.optional(),
  views: furnitureViewsSchema,
});

export type FurnitureData = z.output<typeof furnitureDataSchema>;

/** New furniture starts as a decoration with its image anchored to the floor. */
export const DEFAULT_FURNITURE_DATA = furnitureDataSchema.parse({});

export const furnitureItemSchema = z.object({
  furnitureData: furnitureDataSchema.nullable().prefault(null),
});

/** Furniture is scene content; these defaults also normalize item-type changes in the editor. */
export const FURNITURE_ITEM_DEFAULTS = {
  slot: "NONE",
  target: "SELF",
  method: "SINGLE",
  weaponType: "NONE",
  coordinateTargeting: null,
  methodSize: null,
  effects: [],
  battleDescription: "",
  maxEquips: 0,
  preventBattleUsage: true,
  destroyOnUse: false,
  canStack: false,
  stackSize: 1,
  maxImbueNumber: 0,
  maxDurability: 0,
  canBeImbued: false,
  range: 0,
  cooldown: 0,
  chakraCost: 0,
  staminaCost: 0,
  healthCost: 0,
  chakraCostReducePerLvl: 0,
  staminaCostReducePerLvl: 0,
  healthCostReducePerLvl: 0,
  actionCostPerc: 100,
  parentItemId: null,
  bloodlineId: null,
  requiredSkillId: null,
  crystalTargetTypes: null,
  isFarmSeed: false,
  isFarmFertilizer: false,
  farmSellValue: 0,
  farmExtractSeedItemId: null,
  farmExtractSeedCount: 0,
} satisfies Partial<Item>;
