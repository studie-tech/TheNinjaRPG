import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { FARM_MAX_PLOTS, FARM_PLOT_PURCHASE_COST, FARM_STARTING_PLOTS } from "@/drizzle/constants";
import { farmCollectionLog, farmExtraction, farmPlot, item, quest, questHistory, userData, userItem } from "@/drizzle/schema";
import { getFarmGrowTimeSeconds } from "@/libs/farming";
import { farmingRouter } from "@/server/api/routers/farming";
import { itemRouter } from "@/server/api/routers/item";
import { DecreaseFarmingTime } from "@/validators/combat";
import { insertItems, insertUserItems, insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
  recordQueries,
} from "../../../setup/testDatabase";

/**
 * The farming router carries the economy: level gates, purchase caps, compare-and-swap
 * guards and the rules that keep farm produce out of the ryo economy. Those live inside
 * the procedures rather than in the pure helpers, so they can only be exercised against
 * a real database -- a mocked client would assert the query we wrote, not the row the
 * engine ends up with.
 */
const caller = (userId: string) => callerFor(farmingRouter, userId);

const seedItemRow = (overrides: Record<string, unknown> = {}) => ({
  id: "seed-1",
  name: "Test Seed",
  image: "/seed.png",
  description: "seed",
  itemType: "MATERIAL",
  rarity: "COMMON",
  slot: "ITEM",
  target: "CHARACTER",
  effects: [],
  isFarmSeed: true,
  farmGrowTimeSeconds: 60,
  farmYieldItemId: "crop-1",
  farmMinLevel: 1,
  farmSellValue: 5,
  canStack: true,
  stackSize: 50,
  ...overrides,
});

const cropItemRow = (overrides: Record<string, unknown> = {}) => ({
  id: "crop-1",
  name: "Test Crop",
  image: "/crop.png",
  description: "crop",
  itemType: "MATERIAL",
  rarity: "COMMON",
  slot: "ITEM",
  target: "CHARACTER",
  effects: [],
  farmSellValue: 40,
  farmHarvestExperience: 10,
  canStack: true,
  stackSize: 50,
  ...overrides,
});

const farmer = async (patch: Record<string, unknown> = {}) => {
  const [row] = await insertUsers([
    { userId: "farm-user", username: "farmer", status: "AWAKE", farmCurrency: 1000, ...patch } as never,
  ]);
  return row as { userId: string };
};

const giveItem = async (id: string, itemId: string, quantity: number) => {
  const database = await getTestDatabase();
  await database.insert(userItem).values({ id, userId: "farm-user", itemId, quantity, equipped: "NONE" } as never);
};

const activateFarmQuest = async (task: string, value = 10) => {
  const database = await getTestDatabase();
  await database.insert(quest).values({
    id: "farm-quest",
    name: "Work the field",
    questType: "event",
    content: {
      objectives: [{ id: "farm-goal", task, value, description: "", successDescription: "" }],
      reward: {}, sceneBackground: "", sceneCharacters: [],
    },
  } as never);
  await database.insert(questHistory).values({
    id: "farm-quest-history", userId: "farm-user", questId: "farm-quest", questType: "event",
  } as never);
};

const readFarmGoal = async () => {
  const database = await getTestDatabase();
  const row = await database.query.userData.findFirst({ where: eq(userData.userId, "farm-user") });
  return row?.questData?.find((tracker) => tracker.id === "farm-quest")
    ?.goals.find((goal) => goal.id === "farm-goal");
};

describeWithDatabase("farming router guards against a real MySQL", () => {
  beforeEach(async () => {
    await resetTables(farmCollectionLog, farmExtraction, farmPlot, userItem, item, questHistory, quest, userData);
    const database = await getTestDatabase();
    await database.insert(item).values([cropItemRow(), seedItemRow()] as never);
  });

  for (const action of ["plantSeed", "plantAllEmpty", "applyFertilizer", "fertilizeAll"] as const) {
    it(`${action} advances its own claimed quest snapshot without a guaranteed retry`, async () => {
      await farmer();
      const database = await getTestDatabase();
      const isPlanting = action === "plantSeed" || action === "plantAllEmpty";
      const isBulk = action === "plantAllEmpty" || action === "fertilizeAll";
      await activateFarmQuest(isPlanting ? "seeds_planted" : "plants_fertilized");
      await giveItem("ui-seed", "seed-1", 5);
      await database.insert(item).values(seedItemRow({
        id: "fert-1", name: "Compost", isFarmSeed: false, isFarmFertilizer: true,
        farmTimeReductionSeconds: 60, farmYieldItemId: null,
      }) as never);
      await giveItem("ui-fert", "fert-1", 5);
      await database.insert(farmPlot).values([0, 1].map((slotIndex) => ({
        id: `plot-${slotIndex}`, userId: "farm-user", slotIndex,
        ...(!isPlanting ? {
          seedItemId: "seed-1", plantedAt: new Date(), finishAt: new Date(Date.now() + 3_600_000),
        } : {}),
      })) as never);
      const api = await caller("farm-user");
      const recorded = await recordQueries(() => {
        switch (action) {
          case "plantSeed": return api.plantSeed({ plotId: "plot-0", seedItemId: "seed-1" });
          case "plantAllEmpty": return api.plantAllEmpty({ seedItemId: "seed-1" });
          case "applyFertilizer": return api.applyFertilizer({ plotId: "plot-0", userItemId: "ui-fert" });
          case "fertilizeAll": return api.fertilizeAll({ userItemId: "ui-fert" });
        }
      });
      expect(recorded.result.success).toBe(true);
      expect((await readFarmGoal())?.value).toBe(isBulk ? 2 : 1);
      // A same-snapshot claim must not invalidate the quest JSON it just protected.
      const userReads = recorded.statements.filter((statement) =>
        statement.startsWith("select") && statement.includes("from `UserData`"));
      // Planting also preloads passive sources for its duration snapshot.
      expect(userReads).toHaveLength(isPlanting ? 3 : 2);
    });
  }

  it("does not advance a stale quest document to the plant claim's timestamp", async () => {
    await farmer({ questData: [{ id: "farm-quest", goals: [{ id: "farm-goal", task: "seeds_planted", value: 1, done: false }] }] });
    await activateFarmQuest("seeds_planted");
    await giveItem("ui-seed", "seed-1", 5);
    const database = await getTestDatabase();
    await database.insert(farmPlot).values({ id: "plot-0", userId: "farm-user", slotIndex: 0 } as never);
    const current = await database.query.userData.findFirst({
      where: eq(userData.userId, "farm-user"),
      with: { userQuests: { with: { quest: true } } },
    });
    if (!current) throw new Error("Expected farmer");
    const stale = { ...current, questData: [], updatedAt: new Date(current.updatedAt.getTime() - 1), completedQuests: [] };
    let servedStale = false;
    const skewed = new Proxy(database, {
      get(target, property, receiver) {
        if (property !== "query") return Reflect.get(target, property, receiver);
        const query = target.query;
        return { ...query, userData: { ...query.userData, findFirst: (args: Parameters<typeof query.userData.findFirst>[0]) => {
          if (args?.columns?.questData && !servedStale) {
            servedStale = true;
            return Promise.resolve(stale);
          }
          return query.userData.findFirst(args);
        } } };
      },
    });
    const api = farmingRouter.createCaller({ drizzle: skewed, userId: "farm-user" } as never);
    const result = await api.plantSeed({ plotId: "plot-0", seedItemId: "seed-1" });
    expect(result.success).toBe(true);
    expect(servedStale).toBe(true);
    expect((await readFarmGoal())?.value).toBe(2);
  });

  for (const isBulk of [false, true]) {
    it(`records a ${isBulk ? "bulk" : "single"} harvest without an unused collection recount`, async () => {
      await farmer();
      const database = await getTestDatabase();
      await database.insert(farmPlot).values({
        id: "plot-harvest", userId: "farm-user", slotIndex: 0, seedItemId: "seed-1",
        plantedAt: new Date(Date.now() - 120_000), finishAt: new Date(Date.now() - 60_000),
      } as never);
      const api = await caller("farm-user");
      const recorded = await recordQueries(() => isBulk ? api.harvestAll() : api.harvestPlot({ plotId: "plot-harvest" }));
      expect(recorded.result.success).toBe(true);
      expect(recorded.statements.filter((statement) =>
        statement.startsWith("select") && statement.includes("FarmCollectionLog"))).toHaveLength(0);
      expect(await database.select().from(farmCollectionLog)).toHaveLength(1);
    });
  }

  it("counts both concurrent first harvests for an unfinished collection objective", async () => {
    await farmer();
    await activateFarmQuest("farming_collection_log", 2);
    const database = await getTestDatabase();
    await database.insert(item).values([
      cropItemRow({ id: "crop-2", name: "Second Crop" }),
      seedItemRow({ id: "seed-2", name: "Second Seed", farmYieldItemId: "crop-2" }),
    ] as never);
    await database.insert(farmPlot).values([0, 1].map((slotIndex) => ({
      id: `plot-${slotIndex}`, userId: "farm-user", slotIndex, seedItemId: `seed-${slotIndex + 1}`,
      plantedAt: new Date(Date.now() - 120_000), finishAt: new Date(Date.now() - 60_000),
    })) as never);
    const api = await caller("farm-user");
    const results = await Promise.all([api.harvestPlot({ plotId: "plot-0" }), api.harvestPlot({ plotId: "plot-1" })]);
    expect(results.every((result) => result.success)).toBe(true);
    expect((await readFarmGoal())?.value).toBe(2);
    expect((await readFarmGoal())?.done).toBe(true);
    expect(await database.select().from(farmCollectionLog)).toHaveLength(2);
  });

  it("skips the collection recount after its objective is complete", async () => {
    await farmer({ questData: [{ id: "farm-quest", goals: [{ id: "farm-goal", task: "farming_collection_log", value: 1, done: true }] }] });
    await activateFarmQuest("farming_collection_log", 1);
    const database = await getTestDatabase();
    await database.insert(farmPlot).values({
      id: "plot-harvest", userId: "farm-user", slotIndex: 0, seedItemId: "seed-1",
      plantedAt: new Date(Date.now() - 120_000), finishAt: new Date(Date.now() - 60_000),
    } as never);
    const api = await caller("farm-user");
    const recorded = await recordQueries(() => api.harvestPlot({ plotId: "plot-harvest" }));
    expect(recorded.result.success).toBe(true);
    expect(recorded.statements.filter((statement) =>
      statement.startsWith("select") && statement.includes("FarmCollectionLog"))).toHaveLength(0);
    expect((await readFarmGoal())?.done).toBe(true);
    expect(await database.select().from(farmCollectionLog)).toHaveLength(1);
  });

  it("refuses to sell a farm seed for coins, so shop stock cannot be cashed back", async () => {
    await farmer();
    await giveItem("ui-seed", "seed-1", 3);
    const api = await caller("farm-user");
    const result = await api.sellCrop({ userItemId: "ui-seed", quantity: 1 });
    expect(result.success).toBe(false);
    const database = await getTestDatabase();
    const [stack] = await database.select().from(userItem).where(eq(userItem.id, "ui-seed"));
    expect(stack?.quantity).toBe(3);
    const [user] = await database.select().from(userData).where(eq(userData.userId, "farm-user"));
    expect(user?.farmCurrency).toBe(1000);
  });

  it("keeps hidden shop items unbuyable even when their id is supplied directly", async () => {
    await farmer();
    const database = await getTestDatabase();
    await database.update(item).set({ hidden: true }).where(eq(item.id, "seed-1"));
    const api = await caller("farm-user");
    const result = await api.buyShopItem({ type: "SEED", itemId: "seed-1", quantity: 1 });
    expect(result.success).toBe(false);
    const rows = await database.select().from(userItem);
    expect(rows).toHaveLength(0);
  });

  it("reaches exactly the plot ceiling and refuses the purchase past it", async () => {
    const maxPurchases = FARM_MAX_PLOTS - FARM_STARTING_PLOTS;
    await farmer({
      farmingExperience: 100_000_000,
      farmCurrency: FARM_PLOT_PURCHASE_COST * (maxPurchases + 1),
      farmPlotsPurchased: maxPurchases - 1,
    });
    const api = await caller("farm-user");
    const last = await api.buyShopItem({ type: "PLOT", quantity: 1 });
    expect(last.success).toBe(true);
    const database = await getTestDatabase();
    const [user] = await database.select().from(userData).where(eq(userData.userId, "farm-user"));
    expect(FARM_STARTING_PLOTS + (user?.farmPlotsPurchased ?? 0)).toBe(FARM_MAX_PLOTS);
    const beyond = await api.buyShopItem({ type: "PLOT", quantity: 1 });
    expect(beyond.success).toBe(false);
  });

  it("pays out once when the same ready plot is harvested twice at the same moment", async () => {
    await farmer();
    const database = await getTestDatabase();
    await database.insert(farmPlot).values({
      id: "plot-1",
      userId: "farm-user",
      slotIndex: 0,
      seedItemId: "seed-1",
      plantedAt: new Date(Date.now() - 120_000),
      finishAt: new Date(Date.now() - 60_000),
    } as never);
    const api = await caller("farm-user");
    // The plot row is the only thing serialising these two callers; without the
    // compare-and-swap on finishAt both would clear it and both would grant a crop.
    const [first, second] = await Promise.all([
      api.harvestPlot({ plotId: "plot-1" }),
      api.harvestPlot({ plotId: "plot-1" }),
    ]);
    expect([first.success, second.success].filter(Boolean)).toHaveLength(1);
    const crops = await database.select().from(userItem).where(eq(userItem.itemId, "crop-1"));
    expect(crops.reduce((sum, row) => sum + row.quantity, 0)).toBe(1);
  });

  it("plants the first empty plots the seed stack covers when it cannot cover all", async () => {
    await farmer();
    await giveItem("ui-seed", "seed-1", 2);
    const database = await getTestDatabase();
    await database.insert(farmPlot).values(
      [4, 2, 0, 3, 1].map((slotIndex) => ({ id: `plot-${slotIndex}`, userId: "farm-user", slotIndex })) as never,
    );
    const api = await caller("farm-user");
    const result = await api.plantAllEmpty({ seedItemId: "seed-1" });
    expect(result.success).toBe(true);
    expect(result.inventoryDeltas).toEqual([{ itemId: "seed-1", quantityDelta: -2 }]);
    const plots = await database.select().from(farmPlot).where(eq(farmPlot.userId, "farm-user"));
    expect(
      plots.filter((plot) => plot.seedItemId).map((plot) => plot.slotIndex).sort(),
    ).toEqual([0, 1]);
    const seeds = await database.select().from(userItem).where(eq(userItem.itemId, "seed-1"));
    expect(seeds.reduce((sum, row) => sum + row.quantity, 0)).toBe(0);
  });

  it("fertilizes the first growing plots the fertilizer stack covers when it cannot cover all", async () => {
    await farmer();
    const database = await getTestDatabase();
    await database.insert(item).values(seedItemRow({
      id: "fert-1", name: "Compost", isFarmSeed: false, isFarmFertilizer: true,
      farmTimeReductionSeconds: 60, farmYieldItemId: null,
    }) as never);
    await giveItem("ui-fert", "fert-1", 1);
    await database.insert(farmPlot).values([2, 0, 1].map((slotIndex) => ({
      id: `plot-${slotIndex}`, userId: "farm-user", slotIndex,
      seedItemId: "seed-1", plantedAt: new Date(), finishAt: new Date(Date.now() + 3_600_000),
    })) as never);
    const api = await caller("farm-user");
    const result = await api.fertilizeAll({ userItemId: "ui-fert" });
    expect(result.success).toBe(true);
    const plots = await database.select().from(farmPlot).where(eq(farmPlot.userId, "farm-user"));
    expect(
      plots.filter((plot) => plot.fertilizerApplied).map((plot) => plot.slotIndex),
    ).toEqual([0]);
    const fertilizer = await database.select().from(userItem).where(eq(userItem.itemId, "fert-1"));
    expect(fertilizer.reduce((sum, row) => sum + row.quantity, 0)).toBe(0);
  });

  it.each(["single", "bulk"] as const)(
    "snapshots the same per-crop passive reduction for %s planting and previews",
    async (mode) => {
      await farmer({ federalStatus: "GOLD" });
      await giveItem("ui-seed", "seed-1", 10);
      const db = await getTestDatabase();
      // Farm-shop seeds are excluded from the regular item shop.
      await db.update(item).set({ inShop: false }).where(eq(item.id, "seed-1"));
      await insertItems([
        {
          id: "farm-gear",
          itemType: "ARMOR",
          maxDurability: 100,
          effects: [DecreaseFarmingTime.parse({ power: 10 })],
        },
      ]);
      await insertUserItems([
        {
          id: "farm-gear-owned",
          itemId: "farm-gear",
          userId: "farm-user",
          equipped: "CHEST",
          durability: 100,
        },
      ]);
      const api = await caller("farm-user");
      const preview = await api.getFarmState();
      if ("success" in preview) throw Error("Missing farm state");
      const player = await db.query.userData.findFirst({
        where: eq(userData.userId, "farm-user"),
      });
      const seconds = getFarmGrowTimeSeconds(60, player!, 10);
      expect(preview.availableSeeds[0]?.growTimeSeconds).toBe(seconds);
      expect(
        preview.shopEntries.find((entry) => entry.itemId === "seed-1")?.growTimeSeconds,
      ).toBe(seconds);
      const result =
        mode === "single"
          ? await api.plantSeed({ plotId: preview.plots[0]!.id, seedItemId: "seed-1" })
          : await api.plantAllEmpty({ seedItemId: "seed-1" });
      expect(result.success).toBe(true);
      const planted = (await db.query.farmPlot.findMany()).filter(
        (plot) => plot.seedItemId,
      );
      expect(planted).toHaveLength(mode === "single" ? 1 : FARM_STARTING_PLOTS);
      for (const plot of planted)
        expect(plot.finishAt!.getTime() - plot.plantedAt!.getTime()).toBe(
          seconds * 1000,
        );
      await db
        .update(userItem)
        .set({ equipped: "NONE" })
        .where(eq(userItem.id, "farm-gear-owned"));
      const refreshed = await api.getFarmState();
      if ("success" in refreshed) throw Error("Missing farm state");
      for (const plot of planted)
        expect(refreshed.plots.find((entry) => entry.id === plot.id)?.finishAt).toEqual(
          plot.finishAt,
        );
  });

  it("plants a seed and returns the prefetched yield on the updated plot", async () => {
    await farmer();
    await giveItem("ui-seed", "seed-1", 2);
    const database = await getTestDatabase();
    await database.insert(farmPlot).values({
      id: "plot-plant",
      userId: "farm-user",
      slotIndex: 0,
    } as never);
    const api = await caller("farm-user");
    const result = await api.plantSeed({ plotId: "plot-plant", seedItemId: "seed-1" });
    expect(result.success).toBe(true);
    expect(result.updatedPlot?.cropName).toBe("Test Crop");
    expect(result.updatedPlot?.cropImage).toBe("/crop.png");
    expect(result.updatedPlot?.harvestExperience).toBe(10);
    expect(result.updatedPlot?.seedItemId).toBe("seed-1");
    const [stack] = await database.select().from(userItem).where(eq(userItem.id, "ui-seed"));
    expect(stack?.quantity).toBe(1);
    const [plot] = await database.select().from(farmPlot).where(eq(farmPlot.id, "plot-plant"));
    expect(plot?.seedItemId).toBe("seed-1");
    expect(plot?.finishAt).toBeTruthy();
  });

  it("resolves planted crop names without querying beyond the overlapped yield catalog", async () => {
    await farmer();
    await giveItem("ui-seed", "seed-1", 1);
    const database = await getTestDatabase();
    await database.insert(farmPlot).values(Array.from({ length: FARM_STARTING_PLOTS }, (_, slotIndex) => ({
      id: `plot-${slotIndex}`,
      userId: "farm-user",
      slotIndex,
      seedItemId: "seed-1",
      plantedAt: new Date(),
      finishAt: new Date(Date.now() + 60_000),
    })) as never);
    const api = await caller("farm-user");
    const recorded = await recordQueries(() => api.getFarmState());
    const state = recorded.result;
    if (!("plots" in state)) {
      throw new Error("message" in state ? state.message : "getFarmState failed");
    }
    expect(state.plots.find((plot) => plot.id === "plot-0")?.cropName).toBe("Test Crop");
    expect(state.availableSeeds.find((seed) => seed.itemId === "seed-1")?.yieldName).toBe(
      "Test Crop",
    );
    expect(recorded.statements).toHaveLength(11);
  });

  it("completes yields changed after the catalog read before clearing orphaned crops", async () => {
    await farmer();
    const database = await getTestDatabase();
    await database.insert(item).values([
      cropItemRow({ id: "crop-2", name: "Planted Crop" }),
      cropItemRow({ id: "crop-3", name: "Inventory Crop" }),
      cropItemRow({ id: "crop-4", name: "Shop Crop" }),
      seedItemRow({ id: "seed-inventory", name: "Inventory Seed" }),
      seedItemRow({ id: "seed-shop", name: "Shop Seed", inShop: false }),
      seedItemRow({ id: "seed-missing", name: "Missing Yield Seed" }),
    ] as never);
    await giveItem("ui-inventory", "seed-inventory", 2);
    const plantedAt = new Date(Date.now() - 30_000);
    const finishAt = new Date(Date.now() + 30_000);
    await database.insert(farmPlot).values(Array.from({ length: FARM_STARTING_PLOTS }, (_, slotIndex) => ({
      id: `plot-${slotIndex}`,
      userId: "farm-user",
      slotIndex,
      ...(slotIndex < 2 ? {
        seedItemId: slotIndex === 0 ? "seed-1" : "seed-missing",
        plantedAt,
        finishAt,
      } : {}),
    })) as never);

    let releaseReads = () => {};
    const catalogUpdated = new Promise<void>((resolve) => { releaseReads = resolve; });
    let catalogRead = false;
    let completionReads = 0;
    const skewed = new Proxy(database, {
      get(target, property, receiver) {
        if (property !== "query") return Reflect.get(target, property, receiver);
        const query = target.query;
        return {
          ...query,
          item: {
            ...query.item,
            findMany: async (args: Parameters<typeof query.item.findMany>[0]) => {
              if (args?.with?.farmYieldItem) {
                // Read the old catalog, then let the independently loaded references see
                // staff's reassignment. None of the new crops has another seed reference.
                const catalog = await query.item.findMany(args);
                catalogRead = true;
                await Promise.all(Object.entries({
                  "seed-1": "crop-2",
                  "seed-inventory": "crop-3",
                  "seed-shop": "crop-4",
                  "seed-missing": "missing-crop",
                }).map(([seedId, yieldId]) => database.update(item)
                  .set({ farmYieldItemId: yieldId })
                  .where(eq(item.id, seedId))));
                releaseReads();
                return catalog;
              }
              await catalogUpdated;
              if (!args?.columns && !args?.orderBy) completionReads += 1;
              return query.item.findMany(args);
            },
          },
          farmPlot: {
            ...query.farmPlot,
            findMany: async (args: Parameters<typeof query.farmPlot.findMany>[0]) => {
              await catalogUpdated;
              return query.farmPlot.findMany(args);
            },
          },
          userItem: {
            ...query.userItem,
            findMany: async (args: Parameters<typeof query.userItem.findMany>[0]) => {
              await catalogUpdated;
              return query.userItem.findMany(args);
            },
          },
        };
      },
    });
    const api = farmingRouter.createCaller({ drizzle: skewed, userId: "farm-user" } as never);
    const recorded = await recordQueries(() => api.getFarmState());
    const state = recorded.result;
    if (!("plots" in state)) throw new Error("Expected farm state");
    expect(catalogRead).toBe(true);
    expect(state.plots.find((plot) => plot.id === "plot-0")?.cropName).toBe("Planted Crop");
    expect(state.availableSeeds.find((seed) => seed.itemId === "seed-inventory")?.yieldName).toBe("Inventory Crop");
    expect(state.shopEntries.find((entry) => entry.itemId === "seed-shop")?.yieldName).toBe("Shop Crop");
    expect(completionReads).toBe(1);
    expect(recorded.statements.filter((statement) => statement.startsWith("update `FarmPlot`"))).toHaveLength(1);
    const plots = await database.query.farmPlot.findMany({ where: eq(farmPlot.userId, "farm-user") });
    const planted = plots.find((plot) => plot.id === "plot-0");
    expect(planted?.seedItemId).toBe("seed-1");
    expect(planted?.plantedAt?.getTime()).toBe(plantedAt.getTime());
    expect(planted?.finishAt?.getTime()).toBe(finishAt.getTime());
    const orphaned = plots.find((plot) => plot.id === "plot-1");
    expect(orphaned?.seedItemId).toBeNull();
    expect(orphaned?.plantedAt).toBeNull();
    expect(orphaned?.finishAt).toBeNull();
    expect(state.plots.find((plot) => plot.id === "plot-1")?.seedItemId).toBeNull();
  });

  it("grants every distinct crop exactly once when a mixed harvest is settled together", async () => {
    await farmer();
    const database = await getTestDatabase();
    // A second seed/crop pair so harvestAll has to fan out over two different stacks.
    await database.insert(item).values([
      cropItemRow({ id: "crop-2", name: "Second Crop" }),
      seedItemRow({ id: "seed-2", name: "Second Seed", farmYieldItemId: "crop-2" }),
    ] as never);
    const ripe = (id: string, slotIndex: number, seedItemId: string) => ({
      id,
      userId: "farm-user",
      slotIndex,
      seedItemId,
      plantedAt: new Date(Date.now() - 120_000),
      finishAt: new Date(Date.now() - 60_000),
    });
    await database.insert(farmPlot).values([
      ripe("plot-a", 0, "seed-1"),
      ripe("plot-b", 1, "seed-1"),
      ripe("plot-c", 2, "seed-2"),
    ] as never);
    const api = await caller("farm-user");
    const result = await api.harvestAll();
    expect(result.success).toBe(true);
    const totalFor = async (itemId: string) =>
      (await database.select().from(userItem).where(eq(userItem.itemId, itemId)))
        .reduce((sum, row) => sum + row.quantity, 0);
    expect(await totalFor("crop-1")).toBe(2);
    expect(await totalFor("crop-2")).toBe(1);
    const plots = await database.select().from(farmPlot).where(eq(farmPlot.userId, "farm-user"));
    expect(plots.every((plot) => plot.seedItemId === null)).toBe(true);
  });

  it("keeps farm produce out of the ryo item shop", async () => {
    await farmer({ money: 10_000, villageId: null });
    const database = await getTestDatabase();
    // A crop priced in farm coins but flagged for the ryo shop: buying it for ryo and
    // selling it at the farm would mint farm currency out of the ryo economy.
    await database.update(item).set({ inShop: true, cost: 1 }).where(eq(item.id, "crop-1"));
    const shop = await callerFor(itemRouter, "farm-user");
    const result = await shop.buy({ itemId: "crop-1", stack: 1, villageId: null } as never);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/farm/i);
  });

  it("refuses a fertilizer stack that is stored at home", async () => {
    await farmer();
    const database = await getTestDatabase();
    await database.insert(item).values(
      seedItemRow({ id: "fert-1", name: "Compost", isFarmSeed: false, isFarmFertilizer: true,
        farmTimeReductionSeconds: 600, farmYieldItemId: null }) as never,
    );
    await database.insert(userItem).values({
      id: "ui-fert", userId: "farm-user", itemId: "fert-1", quantity: 2,
      equipped: "NONE", storedAtHome: true,
    } as never);
    const finishAt = new Date(Date.now() + 3_600_000);
    await database.insert(farmPlot).values({
      id: "plot-f", userId: "farm-user", slotIndex: 0, seedItemId: "seed-1",
      plantedAt: new Date(Date.now() - 60_000), finishAt,
    } as never);
    const api = await caller("farm-user");
    const result = await api.applyFertilizer({ plotId: "plot-f", userItemId: "ui-fert" });
    expect(result.success).toBe(false);
    const [stack] = await database.select().from(userItem).where(eq(userItem.id, "ui-fert"));
    expect(stack?.quantity).toBe(2);
    const [plot] = await database.select().from(farmPlot).where(eq(farmPlot.id, "plot-f"));
    expect(plot?.fertilizerApplied).toBe(false);
    expect(plot?.finishAt?.getTime()).toBe(finishAt.getTime());
  });

  it("does not let a stale watering overwrite a timer that moved underneath it", async () => {
    await farmer();
    const database = await getTestDatabase();
    const original = new Date(Date.now() + 3_600_000);
    const moved = new Date(original.getTime() - 600_000);
    await database.insert(farmPlot).values({
      id: "plot-w",
      userId: "farm-user",
      slotIndex: 0,
      seedItemId: "seed-1",
      plantedAt: new Date(Date.now() - 60_000),
      finishAt: moved,
    } as never);

    // Stand in for a request that read the plot before something else pulled the timer in:
    // reads answer with the pre-move row, writes go to the real database.
    const stalePlot = {
      id: "plot-w",
      userId: "farm-user",
      slotIndex: 0,
      seedItemId: "seed-1",
      plantedAt: new Date(Date.now() - 60_000),
      finishAt: original,
      lastWateredAt: null,
      fertilizerApplied: false,
      seedItem: null,
      yieldItem: null,
    };
    const staleClient = new Proxy(database as object, {
      get(target, property) {
        if (property === "query") {
          const query = Reflect.get(target, property) as Record<string, unknown>;
          return {
            ...query,
            farmPlot: { findFirst: async () => stalePlot, findMany: async () => [stalePlot] },
          };
        }
        return Reflect.get(target, property);
      },
    });
    const { farmingRouter: router } = { farmingRouter };
    const api = router.createCaller({ drizzle: staleClient, userId: "farm-user" } as never);

    const result = await api.waterPlot({ plotId: "plot-w" });

    // The reduction was derived from `original`; applying it would resurrect the longer timer.
    expect(result.success).toBe(false);
    const [plot] = await database.select().from(farmPlot).where(eq(farmPlot.id, "plot-w"));
    expect(plot?.finishAt?.getTime()).toBe(moved.getTime());
    expect(plot?.lastWateredAt).toBeNull();
  });

  it("keeps quest progress when a write lands between the user and quest reads", async () => {
    await farmer();
    const database = await getTestDatabase();
    await database.insert(quest).values({
      id: "farm-quest",
      name: "Water the field",
      questType: "event",
      content: {
        objectives: [
          {
            id: "water-goal",
            task: "plants_watered",
            value: 2,
            description: "",
            successDescription: "",
          },
        ],
        reward: {},
        sceneBackground: "",
        sceneCharacters: [],
      },
    } as never);
    await database.insert(questHistory).values({
      id: "farm-quest-history",
      userId: "farm-user",
      questId: "farm-quest",
      questType: "event",
    } as never);
    await database.insert(farmPlot).values(
      [0, 1].map((slotIndex) => ({
        id: `plot-q${slotIndex}`,
        userId: "farm-user",
        slotIndex,
        seedItemId: "seed-1",
        plantedAt: new Date(Date.now() - 60_000),
        finishAt: new Date(Date.now() + 3_600_000),
      })) as never,
    );

    // What a second request would have read from FarmingQuestState before the first
    // watering committed: empty trackers, carrying the timestamp of that same read.
    const [staleUser, staleHistory] = await Promise.all([
      database.query.userData.findFirst({
        where: eq(userData.userId, "farm-user"),
        columns: { userId: true, questData: true, updatedAt: true },
      }),
      database.query.questHistory.findFirst({
        where: eq(questHistory.id, "farm-quest-history"),
        with: { quest: true },
      }),
    ]);
    const staleQuestState = {
      ...staleUser,
      userQuests: [staleHistory],
      completedQuests: [],
    };

    const first = await (await caller("farm-user")).waterPlot({ plotId: "plot-q0" });
    expect(first.success).toBe(true);

    // The opening quest read answers with the pre-watering snapshot; every other read,
    // fetchUser included, sees the row as it stands now. Only the first one is skewed --
    // a retry issues a fresh query and has to be able to recover.
    let skewServed = false;
    const skewedClient = new Proxy(database as object, {
      get(target, property) {
        if (property === "query") {
          const query = Reflect.get(target, property) as Record<string, unknown>;
          const userDataQuery = query.userData as { findFirst: (args: unknown) => unknown;
          };
          return {
            ...query,
            userData: {
              ...userDataQuery,
              findFirst: async (args: { columns?: { questData?: boolean } }) => {
                if (args?.columns?.questData && !skewServed) {
                  skewServed = true;
                  return staleQuestState;
                }
                return await userDataQuery.findFirst(args);
              },
            },
          };
        }
        return Reflect.get(target, property);
      },
    });
    const skewed = farmingRouter.createCaller({
      drizzle: skewedClient,
      userId: "farm-user",
    } as never);

    const second = await skewed.waterPlot({ plotId: "plot-q1" });
    expect(second.success).toBe(true);

    // Both waterings have to survive: the stale document would otherwise be written back
    // over the first one, because it arrived carrying a timestamp the CAS accepted.
    const [row] = await database
      .select()
      .from(userData)
      .where(eq(userData.userId, "farm-user"));
    const goal = (row?.questData as { id: string; goals: { id: string; value: number }[] }[])
      ?.find((tracker) => tracker.id === "farm-quest")
      ?.goals.find((entry) => entry.id === "water-goal");
    expect(goal?.value).toBe(2);
  });

  it("settles a finished extraction once when two reads race to award it", async () => {
    await farmer();
    const database = await getTestDatabase();
    await giveItem("ui-seed-stack", "seed-1", 49);
    await database.insert(farmExtraction).values({
      id: "extraction-1",
      userId: "farm-user",
      extractorSlot: 0,
      cropItemId: "crop-1",
      seedItemId: "seed-1",
      cropQuantity: 1,
      seedQuantity: 1,
      startedAt: new Date(Date.now() - 120_000),
      finishAt: new Date(Date.now() - 60_000),
    } as never);
    const finished = await database.query.farmExtraction.findFirst({
      where: eq(farmExtraction.id, "extraction-1"),
      with: { cropItem: true, seedItem: true },
    });

    const settled = await (await caller("farm-user")).getFarmState();
    expect(settled).toBeTruthy();
    if (!("availableSeeds" in settled)) throw new Error("Expected farm state");
    expect(settled.availableSeeds.find((seed) => seed.itemId === "seed-1")?.quantity).toBe(50);

    // A concurrent request that read the extraction before the settling delete removed it.
    const staleClient = new Proxy(database as object, {
      get(target, property) {
        if (property === "query") {
          const query = Reflect.get(target, property) as Record<string, unknown>;
          return {
            ...query,
            farmExtraction: { findMany: async () => [finished], findFirst: async () => finished },
          };
        }
        return Reflect.get(target, property);
      },
    });
    await farmingRouter
      .createCaller({ drizzle: staleClient, userId: "farm-user" } as never)
      .getFarmState();

    // One extraction, one payout: awarding before claiming mints a seed and, at the
    // material cap, an extra inventory row alongside the full stack.
    const stacks = await database
      .select()
      .from(userItem)
      .where(eq(userItem.itemId, "seed-1"));
    expect(stacks).toHaveLength(1);
    expect(stacks[0]?.quantity).toBe(50);
    const remaining = await database.select().from(farmExtraction);
    expect(remaining).toHaveLength(0);
  });

  it("counts seeds already promised by the other extractors when admitting a job", async () => {
    await farmer({ farmExtractorsOwned: 2 });
    const database = await getTestDatabase();
    // Materials sit exactly at the cap, with one seed of room left in the existing stack.
    const fillers = Array.from({ length: 23 }, (_, index) =>
      cropItemRow({ id: `filler-${index}`, name: `Filler ${index}` }),
    );
    await database.insert(item).values(fillers as never);
    await database.insert(userItem).values(
      fillers.map((filler, index) => ({
        id: `ui-filler-${index}`,
        userId: "farm-user",
        itemId: filler.id,
        quantity: 1,
        equipped: "NONE",
      })) as never,
    );
    await database
      .update(item)
      .set({ farmExtractSeedItemId: "seed-1", farmExtractSeedCount: 1 })
      .where(eq(item.id, "crop-1"));
    await giveItem("ui-crop", "crop-1", 2);
    await giveItem("ui-seed-stack", "seed-1", 49);
    const api = await caller("farm-user");

    const first = await api.extractSeeds({
      extractorSlot: 0,
      userItemId: "ui-crop",
      quantity: 1,
    });
    expect(first.success).toBe(true);

    // The first extractor is already holding the one seed that fits. Sizing this job
    // against the inventory alone admits it, and both land on a full stack at settlement.
    const second = await api.extractSeeds({
      extractorSlot: 1,
      userItemId: "ui-crop",
      quantity: 1,
    });
    expect(second.success).toBe(false);
    expect(second.message).toContain("Materials inventory is full");
    expect(await database.select().from(farmExtraction)).toHaveLength(1);
  });

  it("merges two extractions of the same seed into one stack", async () => {
    await farmer();
    const database = await getTestDatabase();
    await giveItem("ui-seed-stack", "seed-1", 48);
    await database.insert(farmExtraction).values(
      [0, 1].map((extractorSlot) => ({
        id: `extraction-${extractorSlot}`,
        userId: "farm-user",
        extractorSlot,
        cropItemId: "crop-1",
        seedItemId: "seed-1",
        cropQuantity: 1,
        seedQuantity: 1,
        startedAt: new Date(Date.now() - 120_000),
        finishAt: new Date(Date.now() - 60_000),
      })) as never,
    );

    await (await caller("farm-user")).getFarmState();

    // Both extractions are valid and both must pay, but they share one inventory snapshot.
    // Granted separately, each measures the same 48-seed stack and the second opens a row
    // for a seed that belonged in the first.
    const stacks = await database
      .select()
      .from(userItem)
      .where(eq(userItem.itemId, "seed-1"));
    expect(stacks).toHaveLength(1);
    expect(stacks[0]?.quantity).toBe(50);
    expect(await database.select().from(farmExtraction)).toHaveLength(0);
  });

  it("fills the real stack when the inventory snapshot went stale under it", async () => {
    await farmer();
    const database = await getTestDatabase();
    await giveItem("ui-seed-stack", "seed-1", 48);
    await database.insert(farmExtraction).values({
      id: "extraction-s",
      userId: "farm-user",
      extractorSlot: 0,
      cropItemId: "crop-1",
      seedItemId: "seed-1",
      cropQuantity: 1,
      seedQuantity: 2,
      startedAt: new Date(Date.now() - 120_000),
      finishAt: new Date(Date.now() - 60_000),
    } as never);

    // Stand in for a grant that landed on this stack after settlement read its snapshot.
    // Aggregation cannot help here -- the staleness comes from another request.
    const staleClient = new Proxy(database as object, {
      get(target, property) {
        if (property === "query") {
          const query = Reflect.get(target, property) as Record<string, unknown>;
          const userItemQuery = query.userItem as {
            findMany: (args: unknown) => Promise<{ quantity: number }[]>;
            findFirst: (args: unknown) => unknown;
          };
          return {
            ...query,
            userItem: {
              findFirst: (args: unknown) => userItemQuery.findFirst(args),
              findMany: async (args: unknown) =>
                (await userItemQuery.findMany(args)).map((row) => ({
                  ...row,
                  quantity: 40,
                })),
            },
          };
        }
        return Reflect.get(target, property);
      },
    });
    await farmingRouter
      .createCaller({ drizzle: staleClient, userId: "farm-user" } as never)
      .getFarmState();

    // The two seeds belong in the existing stack. Opening a row for them because the
    // snapshot said 40 puts the player a row closer to the cap for nothing.
    const stacks = await database
      .select()
      .from(userItem)
      .where(eq(userItem.itemId, "seed-1"));
    expect(stacks).toHaveLength(1);
    expect(stacks[0]?.quantity).toBe(50);
  });

  it("holds a payout that would open a row past the material cap", async () => {
    await farmer();
    const database = await getTestDatabase();
    // Fill materials to the cap: 24 filler rows plus a seed stack one short of full.
    const fillers = Array.from({ length: 24 }, (_, index) =>
      cropItemRow({ id: `filler-${index}`, name: `Filler ${index}` }),
    );
    await database.insert(item).values(fillers as never);
    await database.insert(userItem).values(
      fillers.map((filler, index) => ({
        id: `ui-filler-${index}`,
        userId: "farm-user",
        itemId: filler.id,
        quantity: 1,
        equipped: "NONE",
      })) as never,
    );
    await giveItem("ui-seed-stack", "seed-1", 49);
    await database.insert(farmExtraction).values(
      [0, 1].map((extractorSlot) => ({
        id: `extraction-${extractorSlot}`,
        userId: "farm-user",
        extractorSlot,
        cropItemId: "crop-1",
        seedItemId: "seed-1",
        cropQuantity: 1,
        seedQuantity: 1,
        startedAt: new Date(Date.now() - 120_000),
        finishAt: new Date(Date.now() - 60_000),
      })) as never,
    );

    const state = await (await caller("farm-user")).getFarmState();

    // 25 rows is the cap and the two seeds need a 26th. Nothing may be spent to get there:
    // the seeds stay in the extractors, which keep showing them, until space is freed.
    expect(await database.select().from(userItem)).toHaveLength(25);
    const [stack] = await database
      .select()
      .from(userItem)
      .where(eq(userItem.id, "ui-seed-stack"));
    expect(stack?.quantity).toBe(49);
    const held = await database.select().from(farmExtraction);
    expect(held).toHaveLength(2);
    expect(held.every((row) => row.claimedAt === null)).toBe(true);
    expect(
      (state as { activeSeedExtractions: unknown[] }).activeSeedExtractions,
    ).toHaveLength(2);
  });

  it("does not pay twice when the delete fails and the claim later goes stale", async () => {
    await farmer();
    const database = await getTestDatabase();
    await database.insert(farmExtraction).values({
      id: "extraction-d",
      userId: "farm-user",
      extractorSlot: 0,
      cropItemId: "crop-1",
      seedItemId: "seed-1",
      cropQuantity: 1,
      seedQuantity: 3,
      startedAt: new Date(Date.now() - 120_000),
      finishAt: new Date(Date.now() - 60_000),
    } as never);

    // The seed grant commits, then the delete of the settled row fails transiently.
    const failingDelete = new Proxy(database as object, {
      get(target, property) {
        if (property === "delete") {
          return (table: unknown) => {
            if (table === farmExtraction) throw new Error("simulated delete failure");
            return (Reflect.get(target, property) as (arg: unknown) => unknown).call(
              target,
              table,
            );
          };
        }
        return Reflect.get(target, property);
      },
    });
    await farmingRouter
      .createCaller({ drizzle: failingDelete, userId: "farm-user" } as never)
      .getFarmState();

    const [afterGrant] = await database.select().from(farmExtraction);
    expect(afterGrant?.settledAt).not.toBeNull();
    expect((await database.select().from(userItem))[0]?.quantity).toBe(3);

    // Age the claim past the takeover window: a row that has already paid must be cleaned
    // up, never re-granted, however stale its claim looks.
    await database
      .update(farmExtraction)
      .set({ claimedAt: new Date(Date.now() - 3_600_000) })
      .where(eq(farmExtraction.id, "extraction-d"));

    await (await caller("farm-user")).getFarmState();

    const stacks = await database
      .select()
      .from(userItem)
      .where(eq(userItem.itemId, "seed-1"));
    expect(stacks).toHaveLength(1);
    expect(stacks[0]?.quantity).toBe(3);
    expect(await database.select().from(farmExtraction)).toHaveLength(0);
  });

  it("keeps a finished extraction when its payout write fails, and settles it later", async () => {
    await farmer();
    const database = await getTestDatabase();
    await database.insert(farmExtraction).values({
      id: "extraction-f",
      userId: "farm-user",
      extractorSlot: 0,
      cropItemId: "crop-1",
      seedItemId: "seed-1",
      cropQuantity: 1,
      seedQuantity: 3,
      startedAt: new Date(Date.now() - 120_000),
      finishAt: new Date(Date.now() - 60_000),
    } as never);

    // Stand in for the item write failing after the extraction has been claimed.
    const failingClient = new Proxy(database as object, {
      get(target, property) {
        if (property === "insert") {
          return (table: unknown) => {
            if (table === userItem) throw new Error("simulated item write failure");
            return (Reflect.get(target, property) as (arg: unknown) => unknown).call(
              target,
              table,
            );
          };
        }
        return Reflect.get(target, property);
      },
    });
    await farmingRouter
      .createCaller({ drizzle: failingClient, userId: "farm-user" } as never)
      .getFarmState();

    // The reward must not go down with the row: the claim is released and the next
    // settlement pays it out.
    const kept = await database.select().from(farmExtraction);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.claimedAt).toBeNull();
    expect(await database.select().from(userItem)).toHaveLength(0);

    await (await caller("farm-user")).getFarmState();

    const stacks = await database
      .select()
      .from(userItem)
      .where(eq(userItem.itemId, "seed-1"));
    expect(stacks).toHaveLength(1);
    expect(stacks[0]?.quantity).toBe(3);
    expect(await database.select().from(farmExtraction)).toHaveLength(0);
  });

  it("refuses every farming mutation for a banned user", async () => {
    await farmer({ isBanned: true });
    await giveItem("ui-seed", "seed-1", 3);
    const api = await caller("farm-user");
    const results = await Promise.all([
      api.buyShopItem({ type: "SEED", itemId: "seed-1", quantity: 1 }),
      api.sellCrop({ userItemId: "ui-seed", quantity: 1 }),
      api.harvestAll(),
    ]);
    expect(results.every((result) => !result.success)).toBe(true);
    expect(results.every((result) => /banned/i.test(result.message))).toBe(true);
  });
});
