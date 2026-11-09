import { describe, expect, it } from "bun:test";
import type { UserItemWithRelations } from "@/drizzle/schema";
import {
  bulkSellBlockReason,
  bulkSellMessage,
  bulkSellTotals,
  toggleRarityPick,
  warnedItems,
} from "@/libs/itemsPage";

const NOW = new Date("2026-11-05T12:00:00Z");

const row = (
  id: string,
  overrides: Partial<UserItemWithRelations> = {},
  item: Partial<UserItemWithRelations["item"]> = {},
) =>
  ({
    id,
    quantity: 1,
    equipped: "NONE",
    storedAtHome: false,
    isInAuction: false,
    craftingFinishedAt: null,
    ...overrides,
    item: {
      name: id,
      rarity: "COMMON",
      cost: 100,
      isEventItem: false,
      inShop: true,
      hidden: false,
      isFarmSeed: false,
      farmSellValue: 0,
      effects: [],
      ...item,
    },
  }) as unknown as UserItemWithRelations;

const user = { anbuId: null } as never;

describe("bulkSellBlockReason", () => {
  it("blocks equipped, home, auction, crafting and unaffordable farm seeds", () => {
    expect(bulkSellBlockReason(row("a"), 0, NOW)).toBeNull();
    expect(bulkSellBlockReason(row("a", { equipped: "HAND_1" }), 0, NOW)).toBe(
      "is equipped",
    );
    expect(bulkSellBlockReason(row("a", { storedAtHome: true }), 0, NOW)).toBe(
      "is stored at home",
    );
    expect(bulkSellBlockReason(row("a", { isInAuction: true }), 0, NOW)).toBe(
      "is in auction",
    );
    expect(
      bulkSellBlockReason(
        row("a", { craftingFinishedAt: new Date("2026-11-06") }),
        0,
        NOW,
      ),
    ).toBe("is being crafted");
    const seed = row(
      "seed",
      {},
      { isFarmSeed: true, inShop: false, farmSellValue: 50 },
    );
    expect(bulkSellBlockReason(seed, 10, NOW)).toBe("needs 50 farm coins to buy back");
    expect(bulkSellBlockReason(seed, 50, NOW)).toBeNull();
  });
});

describe("toggleRarityPick", () => {
  it("adds sellable shown items of a rarity and a second press removes them", () => {
    const shown = [
      row("c1"),
      row("c2"),
      row("blocked", { isInAuction: true }),
      row("r1", {}, { rarity: "RARE" }),
    ];
    const sellable = (ui: UserItemWithRelations) => bulkSellBlockReason(ui, 0, NOW);
    const first = toggleRarityPick(shown, "COMMON", ["r1", "elsewhere"], sellable);
    expect(first.sort()).toEqual(["c1", "c2", "elsewhere", "r1"]);
    expect(toggleRarityPick(shown, "COMMON", first, sellable).sort()).toEqual([
      "elsewhere",
      "r1",
    ]);
  });
});

describe("bulkSellTotals", () => {
  it("sums ryo once per stack and counts zero-price items as drops", () => {
    const totals = bulkSellTotals(
      [
        row("shop", { quantity: 3 }, { cost: 100 }),
        row("event", {}, { isEventItem: true, cost: 900 }),
        row("rare-loot", {}, { inShop: false, cost: 50 }),
        row("free", {}, { cost: 0 }),
      ],
      user,
      undefined,
    );
    // Selling pays 20% of the cost for each stack, rounded down.
    expect(totals).toEqual({ ryo: 60 + 10, sellCount: 2, dropCount: 2 });
  });
});

describe("warnedItems", () => {
  it("warns for rare, epic and legendary only", () => {
    const items = ["COMMON", "RARE", "EPIC", "LEGENDARY"].map((rarity) =>
      row(rarity, {}, { rarity: rarity as never }),
    );
    expect(warnedItems(items).map((item) => item.id)).toEqual([
      "RARE",
      "EPIC",
      "LEGENDARY",
    ]);
  });
});

describe("bulkSellMessage", () => {
  it("separates unknown sale outcomes from confirmed refusals and proceeds", () => {
    expect(bulkSellMessage([], [], [{ name: "Blade" }])).toBe(
      "No sales were confirmed. Could not confirm Blade. Your inventory and ryo will be refreshed.",
    );
    expect(
      bulkSellMessage(
        [60],
        [{ name: "Seed", reason: "is equipped" }],
        [{ name: "Blade" }],
      ),
    ).toBe(
      "Sold 1 item for 60 ryo. 1 stayed: Seed is equipped. Could not confirm Blade. Your inventory and ryo will be refreshed.",
    );
  });
  it("says what sold, what dropped and what stayed", () => {
    expect(bulkSellMessage([60, 200, 0], [])).toBe(
      "Sold 2 items for 260 ryo and dropped 1.",
    );
    expect(bulkSellMessage([0], [])).toBe("Dropped 1 item.");
    expect(bulkSellMessage([60], [{ name: "Blade", reason: "is equipped" }])).toBe(
      "Sold 1 item for 60 ryo. 1 stayed: Blade is equipped.",
    );
    expect(
      bulkSellMessage(
        [],
        [
          { name: "Blade", reason: "is in auction" },
          { name: "Seed", reason: "needs 50 farm coins to buy back" },
        ],
      ),
    ).toBe(
      "Nothing was sold. 2 stayed: Blade is in auction; Seed needs 50 farm coins to buy back.",
    );
  });
});
