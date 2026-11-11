import { describe, expect, it } from "bun:test";
import {
  applyFarmMutationPatch,
  getFarmBulkMutationUpdate,
  getFarmMutationUpdate,
  getFarmProfileUpdate,
  syncFarmNotifications,
} from "@/deltas/farming";
import { getFarmingLevel } from "@/libs/farming";
import type { FarmPlotState, FarmStateResponse } from "@/validators/farming";
import { AllObjectives, QuestTracker } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";

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
      {
        success: true,
        message: "Harvested",
        farmingExperienceDelta: levelUpExperience,
      },
    );

    expect(result.farmingExperience).toBe(state.farmingExperience + levelUpExperience);
    expect(result.farmingLevel).toBe(getFarmingLevel(result.farmingExperience));
    expect(result.farmingLevel).toBeGreaterThan(
      getFarmingLevel(state.farmingExperience),
    );
  });
});

const completeState = {
  ...state,
  farmingLevel: getFarmingLevel(state.farmingExperience),
};

it("reconciles a confirmed plant without changing its collection or level metadata", () => {
  const updatedPlot = { ...emptyPlot, seedItemId: "seed-1" };
  const next = getFarmMutationUpdate(
    completeState,
    {
      success: true,
      message: "Planted",
      updatedPlot,
      farmingExperienceDelta: 2,
      inventoryDeltas: [{ itemId: "seed-1", quantityDelta: -1 }],
    },
    "plant",
  );
  expect(next?.plots[0]).toEqual(updatedPlot);
  expect(next?.availableSeeds[0]?.quantity).toBe(2);
  expect(next?.farmingExperience).toBe(102);
});

it.each(["harvest", "waterAll", "buy", "extract"])(
  "refetches incomplete %s changes",
  (action) => {
    expect(
      getFarmMutationUpdate(completeState, { success: true, message: "Saved" }, action),
    ).toBeUndefined();
  },
);

it("refetches level unlocks, missing plots and ambiguous inventory stacks", () => {
  const result = { success: true, message: "Watered", updatedPlot: emptyPlot };
  expect(
    getFarmMutationUpdate(
      completeState,
      { ...result, farmingExperienceDelta: 5000 },
      "water",
    ),
  ).toBeUndefined();
  expect(
    getFarmMutationUpdate({ ...completeState, plots: [] }, result, "water"),
  ).toBeUndefined();
  const crop = {
    itemId: "crop",
    userItemId: "one",
    quantity: 3,
  } as FarmStateResponse["sellableCrops"][number];
  const sale = {
    success: true,
    message: "Sold",
    farmCurrencyDelta: 10,
    inventoryDeltas: [{ itemId: "crop", quantityDelta: -1 }],
  };
  expect(
    getFarmMutationUpdate(
      { ...completeState, sellableCrops: [crop, { ...crop, userItemId: "two" }] },
      sale,
      "sell",
      "one",
    ),
  ).toBeUndefined();
  expect(
    getFarmMutationUpdate(
      { ...completeState, sellableCrops: [crop] },
      sale,
      "sell",
      "one",
    )?.sellableCrops[0]?.quantity,
  ).toBe(2);
});

it("refetches successful responses that withhold required farm changes", () => {
  expect(
    getFarmMutationUpdate(
      completeState,
      { success: true, message: "Saved", updatedPlot: emptyPlot },
      "water",
    ),
  ).toBeUndefined();
  expect(
    getFarmMutationUpdate(
      completeState,
      {
        success: true,
        message: "Saved",
        updatedPlot: emptyPlot,
        farmingExperienceDelta: 2,
      },
      "plant",
    ),
  ).toBeUndefined();
  expect(
    getFarmMutationUpdate(completeState, { success: true, message: "Sold" }, "sell"),
  ).toBeUndefined();
});

it("refetches when a crop sale changes shop affordability", () => {
  const crop = {
    itemId: "crop",
    userItemId: "one",
    quantity: 3,
  } as FarmStateResponse["sellableCrops"][number];
  expect(
    getFarmMutationUpdate(
      {
        ...completeState,
        sellableCrops: [crop],
        shopEntries: [
          {
            type: "SEED",
            label: "Seeds",
            cost: 510,
            minLevel: 1,
            canAfford: false,
            canPurchase: false,
          },
        ],
      },
      {
        success: true,
        message: "Sold",
        farmCurrencyDelta: 10,
        inventoryDeltas: [{ itemId: "crop", quantityDelta: -1 }],
      },
      "sell",
      "one",
    ),
  ).toBeUndefined();
});

it("refetches a crop sale whose instance is absent even when another stack has the same item", () => {
  const crop = {
    itemId: "crop",
    userItemId: "other-stack",
    quantity: 3,
  } as FarmStateResponse["sellableCrops"][number];
  expect(
    getFarmMutationUpdate(
      { ...completeState, sellableCrops: [crop] },
      {
        success: true,
        message: "Sold",
        farmCurrencyDelta: 10,
        inventoryDeltas: [{ itemId: "crop", quantityDelta: -1 }],
      },
      "sell",
      "sold-stack",
    ),
  ).toBeUndefined();
});

it("patches bulk watering timelines while preserving the loaded crop catalog", () => {
  const growing = {
    ...emptyPlot,
    seedItemId: "seed-1",
    cropName: "Crop",
    cropImage: "crop.webp",
    finishAt: new Date("2026-11-02T14:00:00Z"),
  };
  const before = {
    id: growing.id,
    seedItemId: growing.seedItemId,
    finishAt: growing.finishAt,
    lastWateredAt: growing.lastWateredAt,
  };
  const result = {
    success: true,
    message: "Watered",
    farmingExperienceDelta: 1,
    updatedPlots: [
      {
        before,
        after: {
          ...growing,
          cropName: null,
          cropImage: null,
          lastWateredAt: new Date("2026-11-02T12:00:00Z"),
        },
      },
    ],
  };
  const current = { ...completeState, plots: [growing] };
  expect(getFarmBulkMutationUpdate(current, result, "water")?.plots[0]).toEqual({
    ...result.updatedPlots[0]!.after,
    cropName: "Crop",
    cropImage: "crop.webp",
  });
  expect(
    getFarmBulkMutationUpdate(
      { ...current, plots: [{ ...growing, finishAt: new Date(0) }] },
      result,
      "water",
    ),
  ).toBeUndefined();
  expect(
    getFarmBulkMutationUpdate(current, { ...result, success: false }, "water"),
  ).toBeUndefined();
  expect(
    getFarmBulkMutationUpdate(
      current,
      { ...result, farmingExperienceDelta: 5000 },
      "water",
    ),
  ).toBeUndefined();
});

it("patches bulk harvest quantities by stack identity and recovers new collections or ownership", () => {
  const crop = {
    userItemId: "crop-stack",
    itemId: "crop-1",
    quantity: 2,
  } as FarmStateResponse["sellableCrops"][number];
  const current = {
    ...completeState,
    collectionLog: {
      collected: 1,
      total: 1,
      items: [
        {
          itemId: "crop-1",
          name: "Crop",
          image: "crop.webp",
          harvested: true,
          firstHarvestedAt: new Date(0),
        },
      ],
    },
    sellableCrops: [crop, { ...crop, userItemId: "other", quantity: 4 }],
    extractableCrops: [
      {
        userItemId: crop.userItemId,
        itemId: crop.itemId,
        quantity: crop.quantity,
        name: "Crop",
        image: "crop.webp",
        seedItemId: "seed-1",
        seedCount: 1,
      },
    ],
  } as FarmStateResponse;
  const result = {
    success: true,
    message: "Harvested",
    farmingExperienceDelta: 1,
    updatedPlots: [
      {
        before: {
          id: emptyPlot.id,
          seedItemId: null,
          finishAt: null,
          lastWateredAt: null,
        },
        after: emptyPlot,
      },
    ],
    inventoryChanges: [
      { id: crop.userItemId, itemId: crop.itemId, beforeQuantity: 2, quantity: 5 },
    ],
  };
  const next = getFarmBulkMutationUpdate(current, result, "harvest");
  expect(next?.sellableCrops.map((row) => row.quantity)).toEqual([5, 4]);
  expect(next?.extractableCrops[0]?.quantity).toBe(5);
  expect(
    getFarmBulkMutationUpdate(
      current,
      { ...result, inventoryChanges: undefined },
      "harvest",
    ),
  ).toBeUndefined();
  expect(
    getFarmBulkMutationUpdate(
      { ...current, collectionLog: { ...current.collectionLog, items: [] } },
      result,
      "harvest",
    ),
  ).toBeUndefined();
  expect(
    getFarmBulkMutationUpdate(
      { ...current, sellableCrops: [{ ...crop, quantity: 9 }], extractableCrops: [] },
      result,
      "harvest",
    ),
  ).toBeUndefined();
});

it("projects confirmed farm counters independently of feature inventory and plot metadata", () => {
  expect(
    getFarmProfileUpdate({
      farmingExperienceDelta: 5,
      farmCurrencyDelta: -10,
      farmPlotsPurchasedDelta: 1,
      farmExtractorsOwnedDelta: 1,
    }),
  ).toEqual({
    userPatch: {},
    userDelta: {
      farmingExperience: 5,
      farmCurrency: -10,
      farmPlotsPurchased: 1,
      farmExtractorsOwned: 1,
    },
  });
  expect(getFarmProfileUpdate({})).toEqual({ userPatch: {}, userDelta: {} });
});

it("masks hidden quest targets without mutating the committed farming trackers", () => {
  const source = {
    role: "USER" as const,
    sector: 1,
    questData: [
      QuestTracker.parse({
        id: "hidden",
        goals: [{ id: "target", sector: 2, longitude: 4, latitude: 5 }],
      }),
    ],
    userQuests: [
      {
        quest: {
          id: "hidden",
          content: {
            objectives: [
              AllObjectives.parse({
                id: "target",
                task: "move_to_location",
                sector: 2,
                longitude: 4,
                latitude: 5,
                sectorType: "specific",
                locationType: "specific",
                hideLocation: true,
              }),
            ],
            reward: ObjectiveReward.parse({}),
            sceneBackground: "",
            sceneCharacters: [],
          },
        },
      },
    ],
  };
  const before = structuredClone(source);
  const patch = getFarmProfileUpdate({ farmingExperienceDelta: 1 }, source);
  expect(patch.userPatch.questData?.[0]?.goals[0]?.sector).toBeUndefined();
  expect(patch.userPatch.questData?.[0]?.goals[0]?.longitude).toBeUndefined();
  expect(source).toEqual(before);
});

describe("syncFarmNotifications", () => {
  const now = new Date("2030-01-01T12:00:00Z");
  const growing: FarmPlotState = {
    ...emptyPlot,
    seedItemId: "seed-1",
    plantedAt: new Date("2030-01-01T10:00:00Z"),
    finishAt: new Date("2030-01-02T00:00:00Z"),
  };
  const ready: FarmPlotState = {
    ...growing,
    finishAt: new Date("2030-01-01T11:00:00Z"),
  };
  const poll = { href: "/manual/polls", name: "Unvoted Polls", color: "blue" } as const;
  const harvestNotice = {
    href: "/farm",
    name: "5 farm crops are ready to harvest",
    color: "green",
  } as const;
  const waterNotice = {
    href: "/farm",
    name: "1 farm plant is ready to water",
    color: "blue",
  } as const;

  it("drops the farm notices once nothing is ready or waits for water", () => {
    const watered = { ...growing, lastWateredAt: now };
    expect(
      syncFarmNotifications([harvestNotice, poll, waterNotice], [watered], now),
    ).toEqual([poll]);
  });

  it("counts the plots still ready or waiting for water", () => {
    expect(
      syncFarmNotifications(
        [harvestNotice, waterNotice, poll],
        [ready, growing, emptyPlot],
        now,
      ),
    ).toEqual([
      { href: "/farm", name: "1 farm crop is ready to harvest", color: "green" },
      waterNotice,
      poll,
    ]);
  });

  it("returns the same list when the farm notices already match", () => {
    const current = [poll, waterNotice];
    expect(syncFarmNotifications(current, [growing], now)).toBe(current);
  });

  it("leaves a profile without notifications untouched", () => {
    expect(syncFarmNotifications(undefined, [ready], now)).toBeUndefined();
  });
});
