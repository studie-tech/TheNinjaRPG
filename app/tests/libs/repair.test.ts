import { describe, expect, it } from "bun:test";
import type { UserItemWithRelations } from "@/drizzle/schema";
import { calcItemRepairCost } from "@/libs/item";
import {
  calcRepairAllCost,
  calculateKitsToUse,
  getRepairKits,
  needsInventoryRepair,
  type RepairKit,
} from "@/libs/repair";
import { RepairTag } from "@/validators/combat";

describe("furniture repair exclusion", () => {
  it("does not include damaged furniture in bulk repair", () => {
    const row = {
      storedAtHome: false,
      isInAuction: false,
      durability: 10,
      item: { itemType: "FURNITURE", maxDurability: 100 },
    };
    expect(needsInventoryRepair(row)).toBe(false);
    expect(
      needsInventoryRepair({ ...row, item: { ...row.item, itemType: "ARMOR" } }),
    ).toBe(true);
  });

  it("does not consume furniture carrying a stale repair effect as a repair kit", () => {
    const row = {
      id: "chair-row",
      quantity: 1,
      storedAtHome: false,
      isInAuction: false,
      craftingFinishedAt: null,
      item: { itemType: "FURNITURE", effects: [RepairTag.parse({ power: 100 })] },
    } as unknown as UserItemWithRelations;
    expect(getRepairKits([row])).toEqual([]);
    expect(
      getRepairKits([{ ...row, item: { ...row.item, itemType: "CONSUMABLE" } }]),
    ).toHaveLength(1);
  });
});

describe("repair all cost", () => {
  const row = (id: string, durability: number, patch: object = {}) =>
    ({
      id,
      durability,
      storedAtHome: false,
      isInAuction: false,
      item: { itemType: "ARMOR", maxDurability: 100, rarity: "RARE" },
      ...patch,
    }) as unknown as UserItemWithRelations;

  it("sums only the carried items that need repair", () => {
    const worn = row("worn", 50);
    const rows = [worn, row("whole", 100), row("stored", 10, { storedAtHome: true })];
    expect(calcRepairAllCost(rows)).toEqual({
      itemsNeedingRepair: [worn],
      totalCost: calcItemRepairCost(worn),
    });
  });

  it("covers nothing before the inventory has loaded", () => {
    expect(calcRepairAllCost(undefined)).toEqual({
      itemsNeedingRepair: [],
      totalCost: 0,
    });
  });
});

describe("repair kit selection", () => {
  const damagedItems = [
    { durability: 54, item: { maxDurability: 100 } },
    { durability: 60, item: { maxDurability: 100 } },
  ] as UserItemWithRelations[];
  const kit = (id: string, repairAmount: number, quantity: number): RepairKit => ({
    repairAmount,
    userItem: { id, quantity, item: { name: id } } as UserItemWithRelations,
  });

  it("pools damage and consumes smaller powers first, preserving equal-power stack order", () => {
    const kits = [
      kit("large", 100, 10),
      kit("small-first", 10, 2),
      kit("medium", 15, 10),
      kit("small-second", 10, 3),
    ];
    const before = structuredClone(kits);

    expect(calculateKitsToUse(damagedItems, kits)).toEqual({
      kitsToUse: [
        { repairItemId: "small-first", repairItemName: "small-first", quantityUsed: 2 },
        {
          repairItemId: "small-second",
          repairItemName: "small-second",
          quantityUsed: 3,
        },
        { repairItemId: "medium", repairItemName: "medium", quantityUsed: 3 },
      ],
      totalDurabilityNeeded: 86,
      canRepairAll: true,
    });
    expect(kits).toEqual(before);
  });

  it("stops partway through an equal-power stack once damage is covered", () => {
    const kits = [kit("first", 30, 1), kit("second", 30, 5), kit("third", 30, 5)];

    expect(calculateKitsToUse(damagedItems, kits)).toEqual({
      kitsToUse: [
        { repairItemId: "first", repairItemName: "first", quantityUsed: 1 },
        { repairItemId: "second", repairItemName: "second", quantityUsed: 2 },
      ],
      totalDurabilityNeeded: 86,
      canRepairAll: true,
    });
  });

  it("reports the available partial repair without exceeding stack quantities", () => {
    const kits = [kit("large", 20, 1), kit("empty", 10, 0), kit("small", 10, 2)];

    expect(calculateKitsToUse(damagedItems, kits)).toEqual({
      kitsToUse: [
        { repairItemId: "small", repairItemName: "small", quantityUsed: 2 },
        { repairItemId: "large", repairItemName: "large", quantityUsed: 1 },
      ],
      totalDurabilityNeeded: 86,
      canRepairAll: false,
    });
  });

  it("names each used kit after its own item", () => {
    const renamed = kit("renamed", 10, 1);
    renamed.userItem.item.name = "Repair Kit";

    expect(calculateKitsToUse(damagedItems, [renamed]).kitsToUse).toEqual([
      { repairItemId: "renamed", repairItemName: "Repair Kit", quantityUsed: 1 },
    ]);
  });

  it("distinguishes no damage from no available kits", () => {
    expect(calculateKitsToUse([], [])).toEqual({
      kitsToUse: [],
      totalDurabilityNeeded: 0,
      canRepairAll: true,
    });
    expect(calculateKitsToUse(damagedItems, [])).toEqual({
      kitsToUse: [],
      totalDurabilityNeeded: 86,
      canRepairAll: false,
    });
  });
});
