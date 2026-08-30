// @vitest-environment node

import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { FARM_MAX_PLOTS, FARM_PLOT_PURCHASE_COST, FARM_STARTING_PLOTS } from "@/drizzle/constants";
import { farmCollectionLog, farmExtraction, farmPlot, item, userData, userItem } from "@/drizzle/schema";
import { insertUsers } from "../../setup/factories";
import { farmingRouter } from "@/server/api/routers/farming";
import { itemRouter } from "@/server/api/routers/item";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

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

describeWithDatabase("farming router guards against a real MySQL", () => {
  beforeEach(async () => {
    await resetTables(farmCollectionLog, farmExtraction, farmPlot, userItem, item, userData);
    const database = await getTestDatabase();
    await database.insert(item).values([cropItemRow(), seedItemRow()] as never);
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

  it("plants nothing and consumes nothing when the seed stack cannot cover every empty plot", async () => {
    await farmer();
    await giveItem("ui-seed", "seed-1", 2);
    const database = await getTestDatabase();
    await database.insert(farmPlot).values(
      [0, 1, 2, 3, 4].map((slotIndex) => ({ id: `plot-${slotIndex}`, userId: "farm-user", slotIndex })) as never,
    );
    const api = await caller("farm-user");
    const result = await api.plantAllEmpty({ seedItemId: "seed-1" });
    expect(result.success).toBe(false);
    const planted = await database.select().from(farmPlot).where(eq(farmPlot.userId, "farm-user"));
    expect(planted.every((plot) => plot.seedItemId === null)).toBe(true);
    const [stack] = await database.select().from(userItem).where(eq(userItem.id, "ui-seed"));
    expect(stack?.quantity).toBe(2);
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
