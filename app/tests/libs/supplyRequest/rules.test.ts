import { expect, it } from "bun:test";
import {
  getSupplyRequestInventoryUpdate,
  getSupplyRequestUserUpdate,
} from "@/deltas/supplyRequest";
import { DURABILITY_MAX_DEFAULT, MAP_WAKE_ISLAND_SECTOR } from "@/drizzle/constants";
import {
  getSupplyRequestReward,
  isSupplyStackAvailable,
  matchesSupplyProfession,
  supplyRequestBlockMessage,
} from "@/libs/supplyRequest";

it("matches only the active profession's authored toggle", () => {
  const item = { canBeCrafted: false, canBeGathered: true, canBeHunted: false };
  expect(matchesSupplyProfession(item, "GATHERING")).toBe(true);
  for (const occupation of ["CRAFTING", "HUNTER", null] as const)
    expect(matchesSupplyProfession(item, occupation)).toBe(false);
});

it("rounds the entire payout normally and awards flat XP for each bundle", () => {
  expect(getSupplyRequestReward(1.234, 100)).toEqual({ ryo: 74, experience: 2000 });
  expect(getSupplyRequestReward(1.236, 100)).toEqual({ ryo: 74, experience: 2000 });
  expect(getSupplyRequestReward(10.009, 300)).toEqual({ ryo: 1802, experience: 6000 });
});

it("excludes unavailable and modified stacks without combining smaller stacks", () => {
  const stack = {
    quantity: 250,
    equipped: "NONE" as const,
    storedAtHome: false,
    isInAuction: false,
    craftingFinishedAt: null,
    activeVariantId: null,
    imbuements: [],
    level: 1,
    experience: 0,
    durability: DURABILITY_MAX_DEFAULT,
  };
  expect(isSupplyStackAvailable(stack)).toBe(true);
  for (const change of [
    { quantity: 99 },
    { equipped: "HAND_1" as const },
    { storedAtHome: true },
    { isInAuction: true },
    { craftingFinishedAt: new Date(Date.now() + 60000) },
    { activeVariantId: "variant" },
    { imbuements: [{}] },
    { level: 2 },
    { experience: 1 },
    { durability: 0 },
  ])
    expect(isSupplyStackAvailable({ ...stack, ...change })).toBe(false);
  expect(isSupplyStackAvailable({ ...stack, craftingFinishedAt: new Date(0) })).toBe(
    true,
  );
});

it("opens on the UTC reset and shares a claim across occupations", () => {
  const now = new Date("2026-11-21T00:00:00.000Z");
  const user = {
    occupation: "GATHERING" as const,
    sector: MAP_WAKE_ISLAND_SECTOR,
    status: "AWAKE" as const,
    isBanned: false,
    supplyRequestAt: new Date("2026-11-20T23:59:59.999Z"),
  };
  expect(supplyRequestBlockMessage(user, now)).toBeNull();
  expect(
    supplyRequestBlockMessage(
      { ...user, supplyRequestAt: now, occupation: "HUNTER" },
      now,
    ),
  ).toContain("already");
  expect(supplyRequestBlockMessage({ ...user, occupation: null }, now)).toContain(
    "Choose",
  );
  expect(supplyRequestBlockMessage({ ...user, sector: 1 }, now)).toContain(
    "Wake Island",
  );
  expect(supplyRequestBlockMessage({ ...user, status: "ASLEEP" }, now)).toContain(
    "awake",
  );
});

it("withholds inventory projection when queue settlement changed other stacks", () => {
  const stack = { id: "stock", itemId: "herb", quantity: 250 };
  const updatedAt = new Date();
  expect(
    getSupplyRequestInventoryUpdate(stack, 200, updatedAt, {
      craftingItemsChanged: false,
      startedQueuedJobs: 0,
    }),
  ).toEqual([
    { id: "stock", itemId: "herb", beforeQuantity: 250, quantity: 50, updatedAt },
  ]);
  expect(
    getSupplyRequestInventoryUpdate(stack, 200, updatedAt, {
      craftingItemsChanged: true,
      startedQueuedJobs: 0,
    }),
  ).toBeUndefined();
  expect(
    getSupplyRequestInventoryUpdate(stack, 200, updatedAt, {
      craftingItemsChanged: false,
      startedQueuedJobs: 1,
    }),
  ).toBeUndefined();
});

it("withholds the entire profile projection when progression needs reconciliation", () => {
  expect(
    getSupplyRequestUserUpdate(
      {
        user: {} as never,
        updatedUser: { requiresProgressionRefresh: true, publishedAchievementIds: [] },
        consequences: [],
        questIdsUpdated: [],
        allConsumptions: [],
      },
      600,
    ),
  ).toEqual({});
});

it.each(["add_item", "remove_item", "combat", "random_encounter"] as const)(
  "withholds inventory projection for %s quest effects",
  (type) => {
    expect(
      getSupplyRequestInventoryUpdate(
        { id: "stock", itemId: "herb", quantity: 250 },
        200,
        new Date(),
        { craftingItemsChanged: false, startedQueuedJobs: 0 },
        [{ type, ids: ["quest-target"] }],
      ),
    ).toBeUndefined();
  },
);
