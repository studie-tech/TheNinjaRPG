import { beforeEach, expect, it } from "bun:test";
import { item } from "@/drizzle/schema";
import { fetchFarmCatalog } from "@/queries/guide";
import { insertItems } from "../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../setup/testDatabase";

const seed = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  name: `Seed ${id}`,
  isFarmSeed: true,
  farmMinLevel: 1,
  farmSellValue: 5,
  ...patch,
});

describeWithDatabase("farm guide catalog", () => {
  beforeEach(async () => {
    await resetTables(item);
  });

  it("lists visible seeds by level then name, with their visible yield", async () => {
    await insertItems([
      seed("late", { name: "Late Seed", farmMinLevel: 3, farmYieldItemId: "herb" }),
      seed("beta", { name: "Beta Seed", farmYieldItemId: "herb" }),
      seed("alpha", { name: "Alpha Seed", farmYieldItemId: "herb" }),
      { id: "herb", name: "Moon Herb" },
    ]);
    const catalog = await fetchFarmCatalog(await getTestDatabase());
    expect(catalog.map((row) => row.name)).toEqual([
      "Alpha Seed",
      "Beta Seed",
      "Late Seed",
    ]);
    expect(catalog[0]).toEqual({
      id: "alpha",
      name: "Alpha Seed",
      rarity: expect.any(String),
      cost: expect.any(Number),
      isFarmSeed: true,
      inShop: expect.any(Boolean),
      hidden: false,
      farmSellValue: 5,
      farmMinLevel: 1,
      farmGrowTimeSeconds: expect.any(Number),
      farmPlantExperience: expect.any(Number),
      farmYieldItemId: "herb",
      yield: { id: "herb", name: "Moon Herb" },
    });
  });

  it("blanks a yield that is hidden, QA-only or missing while keeping its seed", async () => {
    await insertItems([
      seed("hidden-yield", { farmYieldItemId: "secret" }),
      seed("qa-yield", { farmYieldItemId: "qa" }),
      seed("missing-yield", { farmYieldItemId: "gone" }),
      seed("no-yield"),
      { id: "secret", name: "Secret Herb", hidden: true },
      { id: "qa", name: "QA Herb" },
    ]);
    const catalog = await fetchFarmCatalog(await getTestDatabase());
    expect(catalog.map((row) => [row.id, row.yield])).toEqual([
      ["hidden-yield", null],
      ["missing-yield", null],
      ["no-yield", null],
      ["qa-yield", null],
    ]);
  });

  it("leaves out hidden and QA seeds", async () => {
    await insertItems([
      seed("hidden", { hidden: true }),
      seed("qa", { name: "QA Seed" }),
      seed("shown"),
    ]);
    const catalog = await fetchFarmCatalog(await getTestDatabase());
    expect(catalog.map((row) => row.id)).toEqual(["shown"]);
  });
});
