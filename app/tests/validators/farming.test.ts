import { describe, expect, it } from "vitest";
import {
  farmCollectionLogSchema,
  farmShopPurchaseInputSchema,
  farmStateResponseSchema,
} from "@/validators/farming";

describe("farmShopPurchaseInputSchema", () => {
  it("defaults legacy purchases to a quantity of one", () => {
    expect(
      farmShopPurchaseInputSchema.parse({ type: "SEED", itemId: "seed-1" }),
    ).toEqual({ type: "SEED", itemId: "seed-1", quantity: 1 });
  });

  it("accepts bounded consumable quantities", () => {
    expect(
      farmShopPurchaseInputSchema.parse({
        type: "FERTILIZER",
        itemId: "fertilizer-1",
        quantity: 25,
      }).quantity,
    ).toBe(25);
    expect(
      farmShopPurchaseInputSchema.safeParse({
        type: "SEED",
        itemId: "seed-1",
        quantity: 100,
      }).success,
    ).toBe(false);
  });

  it("rejects bulk plot and extractor upgrades", () => {
    expect(
      farmShopPurchaseInputSchema.safeParse({ type: "PLOT", quantity: 2 }).success,
    ).toBe(false);
    expect(
      farmShopPurchaseInputSchema.safeParse({ type: "EXTRACTOR", quantity: 2 })
        .success,
    ).toBe(false);
  });
});

describe("farm collection response", () => {
  const collectionLog = {
    collected: 1,
    total: 2,
    items: [
      {
        itemId: "crop-1",
        name: "Carrot",
        image: "/carrot.png",
        harvested: true,
        firstHarvestedAt: new Date("2026-08-01T12:00:00.000Z"),
      },
      {
        itemId: "crop-2",
        name: "Onion",
        image: "/onion.png",
        harvested: false,
        firstHarvestedAt: null,
      },
    ],
  };

  it("validates harvested and unharvested crop entries", () => {
    expect(farmCollectionLogSchema.parse(collectionLog)).toEqual(collectionLog);
    expect(
      farmCollectionLogSchema.safeParse({
        ...collectionLog,
        items: [{ ...collectionLog.items[0], firstHarvestedAt: "not-a-date" }],
      }).success,
    ).toBe(false);
  });

  it("requires the collection log on the farm-state response", () => {
    const baseState = {
      farmingLevel: 1,
      farmingExperience: 0,
      expForCurrentLevel: 0,
      expForNextLevel: 500,
      farmCurrency: 0,
      farmPlotsPurchased: 0,
      farmExtractorsOwned: 0,
      maxPurchasablePlots: 0,
      maxExtractors: 0,
      totalPlots: 0,
      dayNightCycle: {
        phase: "day" as const,
        brightness: 1,
        nextPhaseAt: new Date(),
        nextDayCycleAt: new Date(),
        dayCycleIndex: 1,
      },
      plots: [],
      shopEntries: [],
      availableSeeds: [],
      availableFertilizers: [],
      activeSeedExtractions: [],
      extractableCrops: [],
      sellableCrops: [],
    };
    expect(
      farmStateResponseSchema.safeParse({ ...baseState, collectionLog }).success,
    ).toBe(true);
    expect(farmStateResponseSchema.safeParse(baseState).success).toBe(false);
  });
});
