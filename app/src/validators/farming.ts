import { z } from "zod";

export const dayNightCycleStateSchema = z.object({
  phase: z.enum(["day", "night"]),
  brightness: z.number(),
  nextPhaseAt: z.date(),
  nextDayCycleAt: z.date(),
  dayCycleIndex: z.number().int(),
});

export type DayNightCycleState = z.infer<typeof dayNightCycleStateSchema>;

/** @deprecated Use dayNightCycleStateSchema */
export const farmCycleStateSchema = dayNightCycleStateSchema;
/** @deprecated Use DayNightCycleState */
export type FarmCycleState = DayNightCycleState;

export const farmPlotStateSchema = z.object({
  id: z.string(),
  slotIndex: z.number().int(),
  seedItemId: z.string().nullable(),
  seedName: z.string().nullable(),
  cropName: z.string().nullable(),
  cropImage: z.string().nullable(),
  plantedAt: z.date().nullable(),
  finishAt: z.date().nullable(),
  lastWateredAt: z.date().nullable(),
  fertilizerApplied: z.boolean(),
  isReady: z.boolean(),
  canWater: z.boolean(),
  nextWateringAt: z.date().nullable(),
  growthProgress: z.number(),
  growthStage: z.number().int(),
  growTimeSeconds: z.number().int().optional(),
  yieldQuantity: z.number().int().optional(),
  plantExperience: z.number().int().optional(),
  harvestExperience: z.number().int().optional(),
});

export type FarmPlotState = z.infer<typeof farmPlotStateSchema>;

export const farmVisualStateSchema = z.object({
  plots: z.array(farmPlotStateSchema),
  totalPlots: z.number().int(),
  selectedPlotIndex: z.number().int().nullable().optional(),
});

export type FarmVisualState = z.infer<typeof farmVisualStateSchema>;

export const farmShopEntrySchema = z.object({
  type: z.enum(["PLOT", "EXTRACTOR", "SEED", "FERTILIZER"]),
  label: z.string(),
  cost: z.number().int(),
  minLevel: z.number().int(),
  itemId: z.string().optional(),
  itemName: z.string().optional(),
  itemImage: z.string().optional(),
  canAfford: z.boolean(),
  canPurchase: z.boolean(),
  lockedReason: z.string().optional(),
  growTimeSeconds: z.number().int().optional(),
  yieldItemId: z.string().optional(),
  yieldName: z.string().optional(),
  yieldImage: z.string().optional(),
  yieldQuantity: z.number().int().optional(),
  experience: z.number().int().optional(),
  fertilizerTimeReductionSeconds: z.number().int().optional(),
});

export type FarmShopEntryState = z.infer<typeof farmShopEntrySchema>;

export const farmShopPurchaseInputSchema = z
  .object({
    type: z.enum(["PLOT", "EXTRACTOR", "SEED", "FERTILIZER"]),
    itemId: z.string().optional(),
    quantity: z.int().min(1).max(99).prefault(1),
  })
  .refine(
    (input) => !["PLOT", "EXTRACTOR"].includes(input.type) || input.quantity === 1,
    { message: "Upgrades can only be purchased one at a time", path: ["quantity"] },
  );

export const farmCollectionLogSchema = z.object({
  collected: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  items: z.array(
    z.object({
      itemId: z.string(),
      name: z.string(),
      image: z.string(),
      harvested: z.boolean(),
      firstHarvestedAt: z.date().nullable(),
    }),
  ),
});

export type FarmCollectionLogState = z.infer<typeof farmCollectionLogSchema>;

export const farmStateResponseSchema = z.object({
  farmingLevel: z.number().int(),
  farmingExperience: z.number().int(),
  expForCurrentLevel: z.number().int(),
  expForNextLevel: z.number().int().nullable(),
  farmCurrency: z.number().int(),
  farmPlotsPurchased: z.number().int(),
  farmExtractorsOwned: z.number().int(),
  maxPurchasablePlots: z.number().int(),
  maxExtractors: z.number().int(),
  totalPlots: z.number().int(),
  dayNightCycle: dayNightCycleStateSchema,
  collectionLog: farmCollectionLogSchema,
  plots: z.array(farmPlotStateSchema),
  shopEntries: z.array(farmShopEntrySchema),
  availableSeeds: z.array(
    z.object({
      itemId: z.string(),
      name: z.string(),
      image: z.string(),
      quantity: z.number().int(),
      minLevel: z.number().int(),
      growTimeSeconds: z.number().int(),
      yieldItemId: z.string(),
      yieldName: z.string(),
      yieldImage: z.string(),
      yieldQuantity: z.number().int(),
      plantExperience: z.number().int(),
      harvestExperience: z.number().int(),
    }),
  ),
  availableFertilizers: z.array(
    z.object({
      userItemId: z.string(),
      itemId: z.string(),
      name: z.string(),
      image: z.string(),
      quantity: z.number().int(),
      timeReductionSeconds: z.number().int(),
    }),
  ),
  activeSeedExtractions: z.array(
    z.object({
      id: z.string(),
      extractorSlot: z.number().int(),
      cropItemId: z.string(),
      cropName: z.string(),
      cropImage: z.string(),
      cropQuantity: z.number().int(),
      seedItemId: z.string(),
      seedName: z.string(),
      seedImage: z.string(),
      seedQuantity: z.number().int(),
      startedAt: z.date(),
      finishAt: z.date(),
    }),
  ),
  extractableCrops: z.array(
    z.object({
      userItemId: z.string(),
      itemId: z.string(),
      name: z.string(),
      image: z.string(),
      quantity: z.number().int(),
      seedItemId: z.string(),
      seedCount: z.number().int(),
    }),
  ),
  sellableCrops: z.array(
    z.object({
      userItemId: z.string(),
      itemId: z.string(),
      name: z.string(),
      image: z.string(),
      quantity: z.number().int(),
      sellValue: z.number().int(),
    }),
  ),
});

export type FarmStateResponse = z.infer<typeof farmStateResponseSchema>;

export const farmInventoryDeltaSchema = z.object({
  itemId: z.string(),
  quantityDelta: z.number().int(),
});

export const farmMutationResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  updatedPlot: farmPlotStateSchema.nullable().optional(),
  farmCurrencyDelta: z.number().int().optional(),
  farmingExperienceDelta: z.number().int().optional(),
  inventoryDeltas: z.array(farmInventoryDeltaSchema).optional(),
  totalPlots: z.number().int().optional(),
  farmPlotsPurchasedDelta: z.number().int().optional(),
  farmExtractorsOwnedDelta: z.number().int().optional(),
});

export type FarmMutationResponse = z.infer<typeof farmMutationResponseSchema>;
export type FarmEffect =
  | "water"
  | "fertilize"
  | "harvest"
  | "plant"
  | "expand"
  | "level";
