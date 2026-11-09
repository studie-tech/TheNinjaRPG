import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  FARM_MAX_PLOTS,
  FARM_PLOT_PURCHASE_COST,
  FARM_STARTING_PLOTS,
} from "@/drizzle/constants";
import { farmExtraction, farmPlot, item, userData, userItem } from "@/drizzle/schema";
import { getMaxExtractors, getMaxPurchasablePlots } from "@/libs/farming";
import { farmingRouter } from "@/server/api/routers/farming";
import { insertItems, insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const userId = "shop-farmer";
const shopItem = (id: string, patch: Record<string, unknown>) => ({
  id,
  name: id,
  farmSellValue: 10,
  farmMinLevel: 1,
  inShop: false,
  farmGrowTimeSeconds: 60,
  ...patch,
});
const farmer = (patch: Record<string, unknown> = {}) =>
  insertUsers([
    {
      userId,
      username: "ShopFarmer",
      status: "AWAKE",
      farmCurrency: 1_000_000,
      ...patch,
    },
  ]);
const api = () => callerFor(farmingRouter, userId);

const entries = async () => {
  const state = await (await api()).getFarmState();
  return Object.fromEntries(
    state.shopEntries.map((entry) => [entry.itemId ?? entry.type, entry]),
  );
};

describeWithDatabase("farm shop", () => {
  beforeEach(async () => {
    await resetTables(farmExtraction, farmPlot, userItem, item, userData);
  });

  describe("purchasable stock", () => {
    const buy = async (type: "SEED" | "FERTILIZER", itemId?: string) =>
      (await api()).buyShopItem({ type, itemId, quantity: 1 });

    it.each([
      {
        label: "a market seed",
        type: "SEED",
        patch: { isFarmSeed: true },
        success: true,
      },
      {
        label: "a fertilizer",
        type: "FERTILIZER",
        patch: { isFarmFertilizer: true },
        success: true,
      },
      {
        label: "an item that is not a seed",
        type: "SEED",
        patch: { isFarmFertilizer: true },
        success: false,
      },
      {
        label: "an item that is not a fertilizer",
        type: "FERTILIZER",
        patch: { isFarmSeed: true },
        success: false,
      },
      {
        label: "a hidden seed",
        type: "SEED",
        patch: { isFarmSeed: true, hidden: true },
        success: false,
      },
      {
        label: "a hidden fertilizer",
        type: "FERTILIZER",
        patch: { isFarmFertilizer: true, hidden: true },
        success: false,
      },
      {
        label: "an unpriced seed",
        type: "SEED",
        patch: { isFarmSeed: true, farmSellValue: 0 },
        success: false,
      },
      {
        label: "an unpriced fertilizer",
        type: "FERTILIZER",
        patch: { isFarmFertilizer: true, farmSellValue: 0 },
        success: false,
      },
      {
        label: "a seed sold in the ryo shop",
        type: "SEED",
        patch: { isFarmSeed: true, inShop: true },
        success: false,
      },
      {
        label: "a fertilizer also sold in the ryo shop",
        type: "FERTILIZER",
        patch: { isFarmFertilizer: true, inShop: true },
        success: true,
      },
    ] as const)("handles $label", async ({ type, patch, success }) => {
      await farmer();
      await insertItems([shopItem("stock", patch)]);
      const result = await buy(type, "stock");
      expect(result.success).toBe(success);
      if (!success) expect(result.message).toBe("Shop item not found");
    });

    it("rejects a missing or unknown item id", async () => {
      await farmer();
      expect((await buy("SEED")).message).toBe("Shop item not found");
      expect((await buy("FERTILIZER", "unknown")).message).toBe("Shop item not found");
    });
  });

  describe("listed entries", () => {
    const maxedExperience = 100_000_000;

    it("offers every entry the player can buy", async () => {
      await farmer({ farmingExperience: maxedExperience });
      await insertItems([shopItem("seed", { isFarmSeed: true })]);
      const { PLOT, EXTRACTOR, seed } = await entries();
      for (const entry of [PLOT, EXTRACTOR, seed])
        expect(entry).toMatchObject({
          canAfford: true,
          canPurchase: true,
          lockedReason: undefined,
        });
    });

    it("locks entries above the player's level first", async () => {
      await farmer({ farmCurrency: 0 });
      await insertItems([shopItem("seed", { isFarmSeed: true, farmMinLevel: 99 })]);
      const { seed } = await entries();
      expect(seed).toMatchObject({
        canAfford: false,
        canPurchase: false,
        lockedReason: "Requires level 99",
      });
    });

    it("locks entries the player cannot afford", async () => {
      await farmer({ farmingExperience: maxedExperience, farmCurrency: 5 });
      await insertItems([shopItem("seed", { isFarmSeed: true })]);
      const { PLOT, seed } = await entries();
      for (const entry of [PLOT, seed])
        expect(entry).toMatchObject({
          canAfford: false,
          canPurchase: false,
          lockedReason: "Not enough farm coins",
        });
    });

    it("locks plots at the farm's size limit", async () => {
      await farmer({
        farmingExperience: maxedExperience,
        farmPlotsPurchased: FARM_MAX_PLOTS - FARM_STARTING_PLOTS,
      });
      expect((await entries()).PLOT).toMatchObject({
        canAfford: true,
        canPurchase: false,
        lockedReason: "Maximum farm size reached",
      });
    });

    it("locks plots and extractors at the level's allowance", async () => {
      await farmer({
        farmingExperience: 0,
        farmCurrency: FARM_PLOT_PURCHASE_COST * 10,
        farmPlotsPurchased: getMaxPurchasablePlots(1),
        farmExtractorsOwned: getMaxExtractors(1),
      });
      const { PLOT, EXTRACTOR } = await entries();
      if (PLOT?.minLevel === 1)
        expect(PLOT).toMatchObject({
          canPurchase: false,
          lockedReason: "Plot limit reached",
        });
      if (EXTRACTOR?.minLevel === 1)
        expect(EXTRACTOR).toMatchObject({
          canPurchase: false,
          lockedReason: "Extractor limit reached",
        });
    });
  });

  it("leaves the balance alone on a rejected purchase", async () => {
    await farmer();
    await insertItems([shopItem("stock", { isFarmSeed: true, hidden: true })]);
    await (await api()).buyShopItem({ type: "SEED", itemId: "stock", quantity: 1 });
    const saved = await (await getTestDatabase()).query.userData.findFirst({
      where: eq(userData.userId, userId),
    });
    expect(saved?.farmCurrency).toBe(1_000_000);
  });
});
