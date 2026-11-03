import { describe, expect, it } from "bun:test";
import type { ItemSlot } from "@/drizzle/constants";
import type { UserItemWithRelations } from "@/drizzle/schema";
import {
  backpackFilterChips,
  filterBackpack,
  fittingSlots,
  rankSlotCandidates,
  sortBackpack,
} from "@/libs/itemsPage";

type Fixture = {
  id: string;
  rarity?: string;
  itemType?: string;
  slot?: string;
  durability?: number;
  maxDurability?: number;
  equipped?: ItemSlot;
  createdAt?: Date;
};

/** A carried user item with only the fields the rules read. */
const userItem = ({
  id,
  rarity = "COMMON",
  itemType = "WEAPON",
  slot = "HAND",
  durability = 0,
  maxDurability = 0,
  equipped = "NONE",
  createdAt = new Date("2026-01-01T00:00:00Z"),
}: Fixture) =>
  ({
    id,
    durability,
    quantity: 1,
    equipped,
    createdAt,
    storedAtHome: false,
    isInAuction: false,
    craftingFinishedAt: null,
    item: { id: `item-${id}`, name: id, rarity, itemType, slot, maxDurability },
  }) as unknown as UserItemWithRelations;

const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

describe("backpack sorting", () => {
  const rows = [
    userItem({ id: "Common100", rarity: "COMMON", durability: 50, maxDurability: 50 }),
    userItem({ id: "Epic60", rarity: "EPIC", durability: 30, maxDurability: 50 }),
    userItem({ id: "EpicNoDur", rarity: "EPIC" }),
    userItem({ id: "Legendary40", rarity: "LEGENDARY", durability: 20, maxDurability: 50 }),
    userItem({ id: "Epic100", rarity: "EPIC", durability: 50, maxDurability: 50 }),
  ];

  it("sorts by rarity then durability then name", () => {
    expect(ids(sortBackpack(rows, "rarity"))).toEqual([
      "Legendary40",
      "Epic100",
      "EpicNoDur",
      "Epic60",
      "Common100",
    ]);
  });

  it("sorts by each key", () => {
    const mixed = [
      userItem({ id: "b-scroll", itemType: "CONSUMABLE", slot: "ITEM", createdAt: new Date("2026-03-01") }),
      userItem({ id: "a-vest", itemType: "ARMOR", slot: "CHEST", durability: 10, maxDurability: 50, createdAt: new Date("2026-01-01") }),
      userItem({ id: "c-sword", itemType: "WEAPON", slot: "HAND", durability: 40, maxDurability: 50, createdAt: new Date("2026-02-01") }),
    ];
    expect(ids(sortBackpack(mixed, "name"))).toEqual(["a-vest", "b-scroll", "c-sword"]);
    expect(ids(sortBackpack(mixed, "type"))).toEqual(["c-sword", "b-scroll", "a-vest"]);
    expect(ids(sortBackpack(mixed, "slot"))).toEqual(["a-vest", "c-sword", "b-scroll"]);
    expect(ids(sortBackpack(mixed, "newest"))).toEqual(["b-scroll", "c-sword", "a-vest"]);
    // Most worn first, so repairs are easy to find; items that never wear come last.
    expect(ids(sortBackpack(mixed, "durability"))).toEqual(["a-vest", "c-sword", "b-scroll"]);
  });

  it("does not reorder the input", () => {
    const before = ids(rows);
    sortBackpack(rows, "rarity");
    expect(ids(rows)).toEqual(before);
  });
});

describe("backpack filtering", () => {
  const rows = [
    userItem({ id: "Storm Shuriken", itemType: "WEAPON", slot: "THROWN" }),
    userItem({ id: "Healing Salve", itemType: "CONSUMABLE", slot: "ITEM" }),
    userItem({ id: "Worn Vest", itemType: "ARMOR", slot: "CHEST", durability: 10, maxDurability: 50 }),
  ];

  it("filters by query and type and needs repair", () => {
    expect(ids(filterBackpack(rows, { query: "  salve ", type: "ALL" }))).toEqual(["Healing Salve"]);
    expect(ids(filterBackpack(rows, { query: "", type: "WEAPON" }))).toEqual(["Storm Shuriken"]);
    expect(ids(filterBackpack(rows, { query: "", type: "NEEDS_REPAIR" }))).toEqual(["Worn Vest"]);
    expect(filterBackpack(rows, { query: "kunai", type: "ALL" })).toEqual([]);
  });

  it("builds chips from present types only", () => {
    expect(backpackFilterChips(rows)).toEqual([
      { value: "ALL", label: "All", count: 3 },
      { value: "WEAPON", label: "Weapons", count: 1 },
      { value: "CONSUMABLE", label: "Consumables", count: 1 },
      { value: "ARMOR", label: "Armor", count: 1 },
      { value: "NEEDS_REPAIR", label: "Needs repair", count: 1 },
    ]);
    expect(backpackFilterChips(rows.slice(0, 2)).map((chip) => chip.value)).not.toContain(
      "NEEDS_REPAIR",
    );
  });
});

describe("slot rules", () => {
  it("lists the fitting slots of hand and item gear", () => {
    expect(fittingSlots({ slot: "HAND", itemType: "WEAPON" } as never)).toEqual(["HAND_1", "HAND_2"]);
    expect(fittingSlots({ slot: "ITEM", itemType: "CONSUMABLE" } as never)).toEqual([
      "ITEM_1",
      "ITEM_2",
      "ITEM_3",
      "ITEM_4",
      "ITEM_5",
      "ITEM_6",
    ]);
    expect(fittingSlots({ slot: "HEAD", itemType: "ARMOR" } as never)).toEqual(["HEAD"]);
    expect(fittingSlots({ slot: "NONE", itemType: "MATERIAL" } as never)).toEqual([]);
    expect(fittingSlots({ slot: "ITEM", itemType: "MEAL" } as never)).toEqual([]);
    expect(fittingSlots({ slot: "ITEM", itemType: "FURNITURE" } as never)).toEqual([]);
  });

  it("ranks candidates with mastery-blocked last and marks items equipped elsewhere", () => {
    const rows = [
      userItem({ id: "Current", rarity: "LEGENDARY", equipped: "HAND_1" }),
      userItem({ id: "Common100", rarity: "COMMON", durability: 50, maxDurability: 50 }),
      userItem({ id: "EpicBlocked", rarity: "EPIC", durability: 50, maxDurability: 50 }),
      userItem({ id: "Epic60", rarity: "EPIC", durability: 30, maxDurability: 50 }),
      userItem({ id: "OtherHand", rarity: "RARE", equipped: "HAND_2" }),
      userItem({ id: "Legendary40", rarity: "LEGENDARY", durability: 20, maxDurability: 50 }),
      userItem({ id: "Helmet", rarity: "LEGENDARY", slot: "HEAD", itemType: "ARMOR" }),
    ];
    const candidates = rankSlotCandidates(rows, "HAND_1", (ui) =>
      ui.id === "EpicBlocked" ? "Needs 500 Taijutsu" : null,
    );
    expect(candidates.map((c) => c.userItem.id)).toEqual([
      "Legendary40",
      "Epic60",
      "OtherHand",
      "Common100",
      "EpicBlocked",
    ]);
    expect(candidates.find((c) => c.userItem.id === "OtherHand")?.equippedIn).toBe("HAND_2");
    expect(candidates.find((c) => c.userItem.id === "Epic60")?.equippedIn).toBeNull();
    expect(candidates.at(-1)?.blockedReason).toBe("Needs 500 Taijutsu");
  });
});
