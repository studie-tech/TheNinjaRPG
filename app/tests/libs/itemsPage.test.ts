import { describe, expect, it } from "bun:test";
import type { ItemSlot } from "@/drizzle/constants";
import type { UserItemWithRelations } from "@/drizzle/schema";
import {
  backpackFilterChips,
  countUnlistedBagStacks,
  dropTargetsFor,
  equipLimitReason,
  filterBackpack,
  fittingSlots,
  rankSlotCandidates,
  slotName,
  sortBackpack,
  unlistedBagStacksNote,
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
    userItem({
      id: "Legendary40",
      rarity: "LEGENDARY",
      durability: 20,
      maxDurability: 50,
    }),
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
      userItem({
        id: "b-scroll",
        itemType: "CONSUMABLE",
        slot: "ITEM",
        createdAt: new Date("2026-03-01"),
      }),
      userItem({
        id: "a-vest",
        itemType: "ARMOR",
        slot: "CHEST",
        durability: 10,
        maxDurability: 50,
        createdAt: new Date("2026-01-01"),
      }),
      userItem({
        id: "c-sword",
        itemType: "WEAPON",
        slot: "HAND",
        durability: 40,
        maxDurability: 50,
        createdAt: new Date("2026-02-01"),
      }),
    ];
    expect(ids(sortBackpack(mixed, "name"))).toEqual(["a-vest", "b-scroll", "c-sword"]);
    expect(ids(sortBackpack(mixed, "type"))).toEqual(["c-sword", "b-scroll", "a-vest"]);
    expect(ids(sortBackpack(mixed, "slot"))).toEqual(["a-vest", "c-sword", "b-scroll"]);
    expect(ids(sortBackpack(mixed, "newest"))).toEqual([
      "b-scroll",
      "c-sword",
      "a-vest",
    ]);
    // Most worn first, so repairs are easy to find; items that never wear come last.
    expect(ids(sortBackpack(mixed, "durability"))).toEqual([
      "a-vest",
      "c-sword",
      "b-scroll",
    ]);
  });

  it("does not reorder the input", () => {
    const before = ids(rows);
    sortBackpack(rows, "rarity");
    expect(ids(rows)).toEqual(before);
  });

  it("sorts by the displayed active variant name, including name tie-breaks", () => {
    const swords = ["Alpha Blade", "Zebra Blade"].map((id, index) => {
      const base = userItem({ id });
      return {
        ...base,
        activeVariantId: "active",
        item: {
          ...base.item,
          variants: [
            {
              id: "active",
              image: "/blade.webp",
              name: index === 0 ? "Zebra Blade" : "Alpha Blade",
            },
          ],
        },
      } as UserItemWithRelations;
    });
    for (const sort of [
      "name",
      "rarity",
      "type",
      "slot",
      "newest",
      "durability",
    ] as const) {
      expect(ids(sortBackpack(swords, sort))).toEqual(["Zebra Blade", "Alpha Blade"]);
    }
  });

  it.each([null, "missing", "unnamed"])(
    "sorts by the base name when the active variant is %j",
    (activeVariantId) => {
      const base = userItem({ id: "Alpha Blade" });
      const sword = {
        ...base,
        activeVariantId,
        item: {
          ...base.item,
          variants: [{ id: "unnamed", image: "/blade.webp", name: null }],
        },
      } as unknown as UserItemWithRelations;
      expect(
        ids(sortBackpack([userItem({ id: "Zebra Blade" }), sword], "name")),
      ).toEqual(["Alpha Blade", "Zebra Blade"]);
    },
  );
});

describe("backpack filtering", () => {
  const rows = [
    userItem({ id: "Storm Shuriken", itemType: "WEAPON", slot: "THROWN" }),
    userItem({ id: "Healing Salve", itemType: "CONSUMABLE", slot: "ITEM" }),
    userItem({
      id: "Worn Vest",
      itemType: "ARMOR",
      slot: "CHEST",
      durability: 10,
      maxDurability: 50,
    }),
  ];

  it("filters by query and type and needs repair", () => {
    expect(ids(filterBackpack(rows, { query: "  salve ", type: "ALL" }))).toEqual([
      "Healing Salve",
    ]);
    expect(ids(filterBackpack(rows, { query: "", type: "WEAPON" }))).toEqual([
      "Storm Shuriken",
    ]);
    expect(ids(filterBackpack(rows, { query: "", type: "NEEDS_REPAIR" }))).toEqual([
      "Worn Vest",
    ]);
    expect(filterBackpack(rows, { query: "kunai", type: "ALL" })).toEqual([]);
  });

  it("finds the active variant's displayed name and retains the base name alias", () => {
    const base = userItem({ id: "Base Sword" });
    const sword = {
      ...base,
      activeVariantId: "blue",
      item: {
        ...base.item,
        variants: [
          { id: "blue", image: "/blue.webp", name: "Blue Sword" },
          { id: "red", image: "/red.webp", name: "Red Sword" },
        ],
      },
    } as UserItemWithRelations;
    expect(filterBackpack([sword], { query: "  BLUE sword ", type: "ALL" })).toEqual([
      sword,
    ]);
    expect(filterBackpack([sword], { query: "Base Sword", type: "WEAPON" })).toEqual([
      sword,
    ]);
    expect(filterBackpack([sword], { query: "Red Sword", type: "ALL" })).toEqual([]);
    expect(filterBackpack([sword], { query: "Blue Sword", type: "ARMOR" })).toEqual([]);
    expect(
      filterBackpack([sword], { query: "Blue Sword", type: "NEEDS_REPAIR" }),
    ).toEqual([]);
  });

  it.each([null, "missing"])(
    "finds only the base name when the active variant is %j",
    (activeVariantId) => {
      const base = userItem({ id: "Base Sword" });
      const sword = {
        ...base,
        activeVariantId,
        item: {
          ...base.item,
          variants: [{ id: "blue", image: "/blue.webp", name: "Blue Sword" }],
        },
      } as UserItemWithRelations;
      expect(filterBackpack([sword], { query: "Base Sword", type: "ALL" })).toEqual([
        sword,
      ]);
      expect(filterBackpack([sword], { query: "Blue Sword", type: "ALL" })).toEqual([]);
    },
  );

  it("builds chips from present types only", () => {
    expect(backpackFilterChips(rows)).toEqual([
      { value: "ALL", label: "All", count: 3 },
      { value: "WEAPON", label: "Weapons", count: 1 },
      { value: "CONSUMABLE", label: "Consumables", count: 1 },
      { value: "ARMOR", label: "Armor", count: 1 },
      { value: "NEEDS_REPAIR", label: "Needs repair", count: 1 },
    ]);
    expect(
      backpackFilterChips(rows.slice(0, 2)).map((chip) => chip.value),
    ).not.toContain("NEEDS_REPAIR");
  });
});

describe("slot rules", () => {
  it("lists the fitting slots of hand and item gear", () => {
    expect(fittingSlots({ slot: "HAND", itemType: "WEAPON" } as never)).toEqual([
      "HAND_1",
      "HAND_2",
    ]);
    expect(fittingSlots({ slot: "ITEM", itemType: "CONSUMABLE" } as never)).toEqual([
      "ITEM_1",
      "ITEM_2",
      "ITEM_3",
      "ITEM_4",
      "ITEM_5",
      "ITEM_6",
    ]);
    expect(fittingSlots({ slot: "HEAD", itemType: "ARMOR" } as never)).toEqual([
      "HEAD",
    ]);
    expect(fittingSlots({ slot: "NONE", itemType: "MATERIAL" } as never)).toEqual([]);
    expect(fittingSlots({ slot: "ITEM", itemType: "MEAL" } as never)).toEqual([]);
    expect(fittingSlots({ slot: "ITEM", itemType: "FURNITURE" } as never)).toEqual([]);
  });

  it("ranks candidates with mastery-blocked last and marks items equipped elsewhere", () => {
    const rows = [
      userItem({ id: "Current", rarity: "LEGENDARY", equipped: "HAND_1" }),
      userItem({
        id: "Common100",
        rarity: "COMMON",
        durability: 50,
        maxDurability: 50,
      }),
      userItem({
        id: "EpicBlocked",
        rarity: "EPIC",
        durability: 50,
        maxDurability: 50,
      }),
      userItem({ id: "Epic60", rarity: "EPIC", durability: 30, maxDurability: 50 }),
      userItem({ id: "OtherHand", rarity: "RARE", equipped: "HAND_2" }),
      userItem({
        id: "Legendary40",
        rarity: "LEGENDARY",
        durability: 20,
        maxDurability: 50,
      }),
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
    expect(candidates.find((c) => c.userItem.id === "OtherHand")?.equippedIn).toBe(
      "HAND_2",
    );
    expect(candidates.find((c) => c.userItem.id === "Epic60")?.equippedIn).toBeNull();
    expect(candidates.at(-1)?.blockedReason).toBe("Needs 500 Taijutsu");
  });

  it("drops onto fitting slots other than its own and never onto blocked ones", () => {
    const worn = userItem({ id: "Katana", equipped: "HAND_1" });
    expect(dropTargetsFor(worn, () => null)).toEqual(["HAND_2"]);
    const loose = userItem({ id: "Tanto" });
    expect(
      dropTargetsFor(loose, (_ui, slot) =>
        slot === "HAND_2" ? "Needs 500 Bukijutsu" : null,
      ),
    ).toEqual(["HAND_1"]);
    expect(
      dropTargetsFor(
        userItem({ id: "Ore", itemType: "MATERIAL", slot: "NONE" }),
        () => null,
      ),
    ).toEqual([]);
  });

  it("names slots as players read them", () => {
    expect(slotName("HAND_2")).toBe("Hand 2");
    expect(slotName("ITEM_3")).toBe("Item 3");
    expect(slotName("HEAD")).toBe("Head");
  });

  it("blocks gear already at its equip limit, as the server does", () => {
    const worn = userItem({ id: "Katana", equipped: "HAND_1" });
    const copy = {
      ...userItem({ id: "Katana copy" }),
      itemId: worn.itemId,
    } as UserItemWithRelations;
    const limitOne = (ui: UserItemWithRelations) =>
      ({ ...ui, item: { ...ui.item, maxEquips: 1 } }) as UserItemWithRelations;
    const all = [limitOne(worn), limitOne(copy)];
    expect(equipLimitReason(all[0]!, all)).toBe("Unequip from Hand 1 first");
    expect(equipLimitReason(all[1]!, all)).toBe("Already equipped in Hand 1");
    const limitTwo = all.map(
      (ui) => ({ ...ui, item: { ...ui.item, maxEquips: 2 } }) as UserItemWithRelations,
    );
    expect(equipLimitReason(limitTwo[1]!, limitTwo)).toBeNull();
    const loose = limitOne(userItem({ id: "Tanto" }));
    expect(equipLimitReason(loose, [loose])).toBeNull();
  });
});

describe("countUnlistedBagStacks", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  const later = new Date("2026-11-11T13:00:00Z");
  const earlier = new Date("2026-11-11T11:00:00Z");
  const row = (fields: {
    storedAtHome?: boolean;
    equipped?: ItemSlot;
    isInAuction?: boolean;
    craftingFinishedAt?: Date | null;
  }) => ({
    storedAtHome: false,
    equipped: "NONE" as ItemSlot,
    isInAuction: false,
    craftingFinishedAt: null,
    ...fields,
  });

  it("counts carried stacks in auction and still crafting", () => {
    const rows = [
      row({}),
      row({ craftingFinishedAt: earlier }),
      row({ isInAuction: true }),
      row({ isInAuction: true, craftingFinishedAt: later }),
      row({ craftingFinishedAt: later }),
      row({ craftingFinishedAt: later }),
    ];
    expect(countUnlistedBagStacks(rows, now)).toEqual({ auction: 2, crafting: 2 });
  });

  it("skips stacks that use no bag space", () => {
    const rows = [
      row({ storedAtHome: true, isInAuction: true }),
      row({ equipped: "HEAD", craftingFinishedAt: later }),
    ];
    expect(countUnlistedBagStacks(rows, now)).toEqual({ auction: 0, crafting: 0 });
  });
});

describe("unlistedBagStacksNote", () => {
  it("names only the kinds present", () => {
    expect(unlistedBagStacksNote({ auction: 3, crafting: 11 })).toBe(
      "Also using space: 3 in auction, 11 being crafted.",
    );
    expect(unlistedBagStacksNote({ auction: 0, crafting: 1 })).toBe(
      "Also using space: 1 being crafted.",
    );
    expect(unlistedBagStacksNote({ auction: 0, crafting: 0 })).toBeNull();
  });
});
