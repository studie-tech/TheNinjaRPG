import { describe, expect, it } from "vitest";
import { applyFarmMutationPatch } from "@/libs/farm-state";
import type { FarmPlotState, FarmStateResponse } from "@/validators/farming";

const emptyPlot: FarmPlotState = {
  id: "plot-1",
  slotIndex: 0,
  seedItemId: null,
  seedName: null,
  cropName: null,
  cropImage: null,
  plantedAt: null,
  finishAt: null,
  lastWateredAt: null,
  fertilizerApplied: false,
  isReady: false,
  canWater: false,
  nextWateringAt: null,
  growthProgress: 0,
  growthStage: 0,
};

const state = {
  farmingExperience: 100,
  farmCurrency: 500,
  farmPlotsPurchased: 0,
  farmExtractorsOwned: 0,
  totalPlots: 5,
  plots: [emptyPlot],
  availableSeeds: [
    {
      itemId: "seed-1",
      name: "Seed",
      image: "seed.webp",
      quantity: 3,
      minLevel: 1,
      growTimeSeconds: 60,
      yieldItemId: "crop-1",
      yieldName: "Crop",
      yieldImage: "crop.webp",
      yieldQuantity: 1,
      plantExperience: 2,
      harvestExperience: 3,
    },
  ],
  availableFertilizers: [],
  activeSeedExtractions: [],
  extractableCrops: [],
  sellableCrops: [],
} as unknown as FarmStateResponse;

describe("applyFarmMutationPatch", () => {
  it("patches the confirmed plot, balances, experience, and inventory deltas", () => {
    const planted = {
      ...emptyPlot,
      seedItemId: "seed-1",
      seedName: "Seed",
      cropName: "Crop",
      cropImage: "crop.webp",
      plantedAt: new Date("2026-01-01T00:00:00Z"),
      finishAt: new Date("2026-01-01T01:00:00Z"),
      growthStage: 1,
      canWater: true,
    };
    const result = applyFarmMutationPatch(state, {
      success: true,
      message: "Planted",
      updatedPlot: planted,
      farmingExperienceDelta: 2,
      farmCurrencyDelta: -50,
      farmPlotsPurchasedDelta: 1,
      inventoryDeltas: [{ itemId: "seed-1", quantityDelta: -1 }],
    });

    expect(result.plots[0]).toEqual(planted);
    expect(result.farmingExperience).toBe(102);
    expect(result.farmCurrency).toBe(450);
    expect(result.farmPlotsPurchased).toBe(1);
    expect(result.availableSeeds[0]?.quantity).toBe(2);
    expect(state.plots[0]).toBe(emptyPlot);
  });
});
