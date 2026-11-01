import { describe, expect, it } from "bun:test";
import { applyFarmMutationPatch, getFarmMutationUpdate } from "@/deltas/farming";
import { getFarmingLevel } from "@/libs/farming";
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
  shopEntries: [],
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

  it("keeps the farming level in step with patched experience", () => {
    const levelUpExperience = 5_000;
    const result = applyFarmMutationPatch(
      { ...state, farmingLevel: getFarmingLevel(state.farmingExperience) },
      { success: true, message: "Harvested", farmingExperienceDelta: levelUpExperience },
    );

    expect(result.farmingExperience).toBe(state.farmingExperience + levelUpExperience);
    expect(result.farmingLevel).toBe(getFarmingLevel(result.farmingExperience));
    expect(result.farmingLevel).toBeGreaterThan(
      getFarmingLevel(state.farmingExperience),
    );
  });
});

const completeState = { ...state, farmingLevel: getFarmingLevel(state.farmingExperience) };

it("reconciles a confirmed plant without changing its collection or level metadata", () => {
  const updatedPlot = { ...emptyPlot, seedItemId: "seed-1" };
  const next = getFarmMutationUpdate(completeState, {
    success: true, message: "Planted", updatedPlot, farmingExperienceDelta: 2,
    inventoryDeltas: [{ itemId: "seed-1", quantityDelta: -1 }],
  }, "plant");
  expect(next?.plots[0]).toEqual(updatedPlot);
  expect(next?.availableSeeds[0]?.quantity).toBe(2);
  expect(next?.farmingExperience).toBe(102);
});

it.each(["harvest", "waterAll", "buy", "extract"])("refetches incomplete %s changes", (action) => {
  expect(getFarmMutationUpdate(completeState, { success: true, message: "Saved" }, action)).toBeUndefined();
});

it("refetches level unlocks, missing plots and ambiguous inventory stacks", () => {
  const result = { success: true, message: "Watered", updatedPlot: emptyPlot };
  expect(getFarmMutationUpdate(completeState, { ...result, farmingExperienceDelta: 5000 }, "water")).toBeUndefined();
  expect(getFarmMutationUpdate({ ...completeState, plots: [] }, result, "water")).toBeUndefined();
  const crop = { itemId: "crop", userItemId: "one", quantity: 3 } as FarmStateResponse["sellableCrops"][number];
  const sale = { success: true, message: "Sold", farmCurrencyDelta: 10, inventoryDeltas: [{ itemId: "crop", quantityDelta: -1 }] };
  expect(getFarmMutationUpdate({ ...completeState, sellableCrops: [crop, { ...crop, userItemId: "two" }] }, sale, "sell", "one")).toBeUndefined();
  expect(getFarmMutationUpdate({ ...completeState, sellableCrops: [crop] }, sale, "sell", "one")?.sellableCrops[0]?.quantity).toBe(2);
});

it("refetches successful responses that withhold required farm changes", () => {
  expect(getFarmMutationUpdate(completeState, { success: true, message: "Saved", updatedPlot: emptyPlot }, "water")).toBeUndefined();
  expect(getFarmMutationUpdate(completeState, { success: true, message: "Saved", updatedPlot: emptyPlot, farmingExperienceDelta: 2 }, "plant")).toBeUndefined();
  expect(getFarmMutationUpdate(completeState, { success: true, message: "Sold" }, "sell")).toBeUndefined();
});

it("refetches when a crop sale changes shop affordability", () => {
  const crop = { itemId: "crop", userItemId: "one", quantity: 3 } as FarmStateResponse["sellableCrops"][number];
  expect(getFarmMutationUpdate({ ...completeState, sellableCrops: [crop], shopEntries: [{
    type: "SEED", label: "Seeds", cost: 510, minLevel: 1, canAfford: false, canPurchase: false,
  }] }, { success: true, message: "Sold", farmCurrencyDelta: 10,
    inventoryDeltas: [{ itemId: "crop", quantityDelta: -1 }] }, "sell", "one")).toBeUndefined();
});

it("refetches a crop sale whose instance is absent even when another stack has the same item", () => {
  const crop = { itemId: "crop", userItemId: "other-stack", quantity: 3 } as FarmStateResponse["sellableCrops"][number];
  expect(getFarmMutationUpdate({ ...completeState, sellableCrops: [crop] }, {
    success: true, message: "Sold", farmCurrencyDelta: 10,
    inventoryDeltas: [{ itemId: "crop", quantityDelta: -1 }],
  }, "sell", "sold-stack")).toBeUndefined();
});
