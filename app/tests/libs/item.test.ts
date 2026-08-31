import { describe, it, expect } from "vitest";
import {
  COOKING_BASE_SLOTS,
  FED_COOKING_GOLD_SLOTS,
  FED_COOKING_NORMAL_SLOTS,
  FED_COOKING_SILVER_SLOTS,
  ItemTypes,
  MATERIALS_BASE_SLOTS,
  NonActionItemTypes,
} from "@/drizzle/constants";
import {
  buildItemLoadoutData,
  calcMaxCookingItems,
  calcMaxHouseCookingItems,
  calcMaxHouseMaterials,
  calcMaxMaterials,
  canEquipAdditional,
  checkEquipConstraints,
  computeLoadoutAssignments,
  type EquipConstraintInfo,
  type EquippedAssignment,
  type EquippedConstraintState,
  getHomeStorageBucket,
  getHomeStorageBucketFullMessage,
  getInventoryBucket,
  getInventoryBucketCapacity,
  getInventoryBucketFullMessage,
  isEquippableUserItem,
  showsItemLevelBadge,
  userItemActionBadges,
} from "@/libs/item";
import type { ItemSlot } from "@/drizzle/constants";
import type { UserData, UserItemWithRelations } from "@/drizzle/schema";

const NOW = new Date("2026-06-17T00:00:00Z");
const PAST = new Date("2026-06-16T00:00:00Z");
const FUTURE = new Date("2026-06-18T00:00:00Z");

describe("isEquippableUserItem", () => {
  it("accepts a carried, non-auction, non-crafting item", () => {
    expect(
      isEquippableUserItem(
        { storedAtHome: false, isInAuction: false, craftingFinishedAt: null },
        NOW,
      ),
    ).toBe(true);
  });
  it("rejects a home-stored item", () => {
    expect(
      isEquippableUserItem(
        { storedAtHome: true, isInAuction: false, craftingFinishedAt: null },
        NOW,
      ),
    ).toBe(false);
  });
  it("rejects an in-auction item", () => {
    expect(
      isEquippableUserItem(
        { storedAtHome: false, isInAuction: true, craftingFinishedAt: null },
        NOW,
      ),
    ).toBe(false);
  });
  it("rejects an item still being crafted, accepts a finished one", () => {
    expect(
      isEquippableUserItem(
        { storedAtHome: false, isInAuction: false, craftingFinishedAt: FUTURE },
        NOW,
      ),
    ).toBe(false);
    expect(
      isEquippableUserItem(
        { storedAtHome: false, isInAuction: false, craftingFinishedAt: PAST },
        NOW,
      ),
    ).toBe(true);
  });
  it("treats an item whose crafting finishes exactly now as equippable", () => {
    // Matches toggleEquipItem and the imbuement check, which both use `> now`.
    expect(
      isEquippableUserItem(
        { storedAtHome: false, isInAuction: false, craftingFinishedAt: NOW },
        NOW,
      ),
    ).toBe(true);
  });
});

describe("userItemActionBadges", () => {
  it("shows both quantity and level badges for a stack of leveling equipment", () => {
    const badges = userItemActionBadges([
      {
        id: "stacked-weapon",
        quantity: 5,
        level: 12,
        item: { itemType: "WEAPON", slot: "HAND" },
      },
    ]);

    expect(badges.counts).toEqual([{ id: "stacked-weapon", quantity: 5 }]);
    expect(badges.levels).toEqual([{ id: "stacked-weapon", level: 12 }]);
  });

  it("does not show a quantity badge for a single leveling item", () => {
    const badges = userItemActionBadges([
      {
        id: "single-weapon",
        quantity: 1,
        level: 12,
        item: { itemType: "WEAPON", slot: "HAND" },
      },
    ]);

    expect(badges.counts).toEqual([]);
    expect(badges.levels).toEqual([{ id: "single-weapon", level: 12 }]);
  });
});

const info = (over: Partial<EquipConstraintInfo>): EquipConstraintInfo => ({
  itemId: "i1",
  bloodlineId: null,
  itemType: "WEAPON",
  slot: "HEAD",
  maxEquips: 1,
  ...over,
});

const equipped = (over: Partial<EquippedConstraintState>): EquippedConstraintState => ({
  slot: "ITEM_1",
  itemType: "WEAPON",
  bloodlineId: null,
  ...over,
});

describe("canEquipAdditional", () => {
  it("allows an item when nothing is equipped", () => {
    expect(canEquipAdditional(info({}), [])).toBeNull();
  });
  it("blocks a second bloodline item", () => {
    expect(
      canEquipAdditional(info({ bloodlineId: "bl1" }), [
        equipped({ bloodlineId: "bl1" }),
      ]),
    ).toMatch(/one item with a bloodline/);
  });
  it("blocks a second ARMOR item in hand slots", () => {
    expect(
      canEquipAdditional(info({ itemType: "ARMOR", slot: "HAND" }), [
        equipped({ slot: "HAND_1", itemType: "ARMOR" }),
      ]),
    ).toMatch(/one armor item in your hand/);
  });
  it("allows a non-armor hand item alongside an armor hand item", () => {
    expect(
      canEquipAdditional(info({ itemType: "WEAPON", slot: "HAND" }), [
        equipped({ slot: "HAND_1", itemType: "ARMOR" }),
      ]),
    ).toBeNull();
  });
  it("blocks a second ACCESSORY", () => {
    expect(
      canEquipAdditional(info({ itemType: "ACCESSORY", slot: "ITEM" }), [
        equipped({ itemType: "ACCESSORY" }),
      ]),
    ).toMatch(/one accessory/);
  });
  it("does not enforce maxEquips (callers own that check)", () => {
    // Two already-equipped instances of the same item — still null here.
    expect(
      canEquipAdditional(info({ itemId: "i1", maxEquips: 1 }), [
        equipped({ slot: "ITEM_1" }),
        equipped({ slot: "ITEM_2" }),
      ]),
    ).toBeNull();
  });
});

describe("checkEquipConstraints", () => {
  it("allows an item when nothing is equipped", () => {
    expect(checkEquipConstraints(info({}), [])).toBeNull();
  });
  it("blocks exceeding maxEquips for the same item", () => {
    const current: EquippedAssignment[] = [
      { slot: "ITEM_1", info: info({ itemId: "i1", maxEquips: 1 }) },
    ];
    expect(checkEquipConstraints(info({ itemId: "i1", maxEquips: 1 }), current)).toMatch(
      /No more than 1/,
    );
  });
  it("allows a second instance up to maxEquips", () => {
    const current: EquippedAssignment[] = [
      { slot: "ITEM_1", info: info({ itemId: "i1", maxEquips: 2 }) },
    ];
    expect(checkEquipConstraints(info({ itemId: "i1", maxEquips: 2 }), current)).toBeNull();
  });
  it("delegates category limits to canEquipAdditional", () => {
    const current: EquippedAssignment[] = [
      { slot: "ITEM_1", info: info({ itemId: "acc1", itemType: "ACCESSORY", slot: "ITEM" }) },
    ];
    expect(
      checkEquipConstraints(
        info({ itemId: "acc2", itemType: "ACCESSORY", slot: "ITEM" }),
        current,
      ),
    ).toMatch(/one accessory/);
  });
});

// Minimal user-item factory; only the fields the function reads are set.
const ui = (over: {
  id: string;
  itemId: string;
  name?: string;
  slotType?: string;
  maxEquips?: number;
  hidden?: boolean;
  requiredLevel?: number;
  bloodlineId?: string | null;
  itemType?: string;
  storedAtHome?: boolean;
  isInAuction?: boolean;
  craftingFinishedAt?: Date | null;
  imbuements?: Array<{ craftingFinishedAt: Date | null }>;
}): UserItemWithRelations =>
  ({
    id: over.id,
    itemId: over.itemId,
    storedAtHome: over.storedAtHome ?? false,
    isInAuction: over.isInAuction ?? false,
    craftingFinishedAt: over.craftingFinishedAt ?? null,
    imbuements: over.imbuements ?? [],
    item: {
      id: over.itemId,
      name: over.name ?? over.itemId,
      hidden: over.hidden ?? false,
      requiredLevel: over.requiredLevel ?? 1,
      bloodlineId: over.bloodlineId ?? null,
      itemType: over.itemType ?? "WEAPON",
      slot: over.slotType ?? "ITEM",
      maxEquips: over.maxEquips ?? 1,
    },
  }) as unknown as UserItemWithRelations;

const USER = { level: 50, bloodlineId: "bl1" };

describe("buildItemLoadoutData", () => {
  it("serializes the unique inventory row id for equipped rows only", () => {
    expect(
      buildItemLoadoutData([
        { id: "r1", itemId: "i1", equipped: "HEAD" },
        { id: "r2", itemId: "i1", equipped: "NONE" },
      ]),
    ).toEqual([{ userItemId: "r1", itemId: "i1", slot: "HEAD" }]);
  });
});

describe("computeLoadoutAssignments", () => {
  it("assigns a simple valid loadout", () => {
    const items = [ui({ id: "r1", itemId: "i1", slotType: "HEAD" })];
    const out = computeLoadoutAssignments(
      [{ itemId: "i1", slot: "HEAD" }],
      items,
      USER,
    );
    expect(out.assignments).toEqual([{ userItemId: "r1", slot: "HEAD" }]);
    expect(out.invalidItems).toEqual([]);
  });

  it("selects the exact saved inventory copy when duplicates exist", () => {
    const items = [
      ui({ id: "r2", itemId: "i1", slotType: "HEAD" }),
      ui({ id: "r1", itemId: "i1", slotType: "HEAD" }),
    ];
    const out = computeLoadoutAssignments(
      [{ userItemId: "r1", itemId: "i1", slot: "HEAD" }],
      items,
      USER,
    );
    expect(out.assignments).toEqual([{ userItemId: "r1", slot: "HEAD" }]);
    expect(out.invalidItems).toEqual([]);
  });

  it("substitutes a duplicate when the saved copy is unavailable", () => {
    const items = [
      ui({ id: "r2", itemId: "i1", slotType: "HEAD" }),
      ui({ id: "r1", itemId: "i1", slotType: "HEAD", storedAtHome: true }),
    ];
    const out = computeLoadoutAssignments(
      [{ userItemId: "r1", itemId: "i1", slot: "HEAD" }],
      items,
      USER,
    );
    expect(out.assignments).toEqual([{ userItemId: "r2", slot: "HEAD" }]);
    expect(out.invalidItems).toEqual([]);
  });

  it("falls back by item id when the saved inventory row no longer exists", () => {
    const items = [ui({ id: "r2", itemId: "i1", slotType: "HEAD" })];
    const out = computeLoadoutAssignments(
      [{ userItemId: "deleted", itemId: "i1", slot: "HEAD" }],
      items,
      USER,
    );
    expect(out.assignments).toEqual([{ userItemId: "r2", slot: "HEAD" }]);
    expect(out.invalidItems).toEqual([]);
  });

  it("falls back to another copy when an earlier entry consumed the saved row", () => {
    const items = [
      ui({ id: "r1", itemId: "i1", slotType: "ITEM", maxEquips: 2 }),
      ui({ id: "r2", itemId: "i1", slotType: "ITEM", maxEquips: 2 }),
    ];
    const out = computeLoadoutAssignments(
      [
        { userItemId: "r1", itemId: "i1", slot: "ITEM_1" },
        { userItemId: "r1", itemId: "i1", slot: "ITEM_2" },
      ],
      items,
      USER,
    );
    expect(out.assignments).toEqual([
      { userItemId: "r1", slot: "ITEM_1" },
      { userItemId: "r2", slot: "ITEM_2" },
    ]);
    expect(out.invalidItems).toEqual([]);
  });

  it("does not pick the same row twice for a duplicated itemId", () => {
    // Loadout references i1 twice but the user owns only one unit.
    const items = [ui({ id: "r1", itemId: "i1", slotType: "ITEM", maxEquips: 2 })];
    const out = computeLoadoutAssignments(
      [
        { itemId: "i1", slot: "ITEM_1" },
        { itemId: "i1", slot: "ITEM_2" },
      ],
      items,
      USER,
    );
    expect(out.assignments).toEqual([{ userItemId: "r1", slot: "ITEM_1" }]);
    expect(out.invalidItems.length).toBe(1);
  });

  it("never assigns two items to the same slot", () => {
    const items = [
      ui({ id: "r1", itemId: "i1", slotType: "HEAD" }),
      ui({ id: "r2", itemId: "i2", slotType: "HEAD" }),
    ];
    const out = computeLoadoutAssignments(
      [
        { itemId: "i1", slot: "HEAD" },
        { itemId: "i2", slot: "HEAD" },
      ],
      items,
      USER,
    );
    const slots = out.assignments.map((a) => a.slot);
    expect(new Set(slots).size).toBe(slots.length);
    expect(out.assignments.length).toBe(1);
  });

  it("falls back to a free slot when two same-type items share a stale slot", () => {
    // Two different ITEM-slot items both saved at a stale ITEM_1. The first
    // takes ITEM_1; the second must fall back to a free compatible slot rather
    // than be dropped as "slot already in use" while ITEM_2 is still open.
    const items = [
      ui({ id: "r1", itemId: "i1", slotType: "ITEM" }),
      ui({ id: "r2", itemId: "i2", slotType: "ITEM" }),
    ];
    const out = computeLoadoutAssignments(
      [
        { itemId: "i1", slot: "ITEM_1" },
        { itemId: "i2", slot: "ITEM_1" },
      ],
      items,
      USER,
    );
    expect(out.invalidItems).toEqual([]);
    expect(out.assignments.length).toBe(2);
    expect(new Set(out.assignments.map((a) => a.slot)).size).toBe(2);
    expect(out.assignments).toContainEqual({ userItemId: "r1", slot: "ITEM_1" });
  });

  it("skips a hidden item with a clear warning", () => {
    const items = [ui({ id: "r1", itemId: "i1", name: "Ghost Blade", hidden: true })];
    const out = computeLoadoutAssignments(
      [{ itemId: "i1", slot: "HEAD" }],
      items,
      USER,
    );
    expect(out.assignments).toEqual([]);
    expect(out.invalidItems[0]).toMatch(/Ghost Blade is hidden/);
  });

  it("enforces maxEquips across two owned units", () => {
    const items = [
      ui({ id: "r1", itemId: "i1", slotType: "ITEM", maxEquips: 1 }),
      ui({ id: "r2", itemId: "i1", slotType: "ITEM", maxEquips: 1 }),
    ];
    const out = computeLoadoutAssignments(
      [
        { itemId: "i1", slot: "ITEM_1" },
        { itemId: "i1", slot: "ITEM_2" },
      ],
      items,
      USER,
    );
    expect(out.assignments.length).toBe(1);
    expect(out.invalidItems.length).toBe(1);
  });

  it("enforces a single accessory across the loadout", () => {
    const items = [
      ui({
        id: "r1",
        itemId: "acc1",
        name: "Ring A",
        slotType: "ITEM",
        itemType: "ACCESSORY",
      }),
      ui({
        id: "r2",
        itemId: "acc2",
        name: "Ring B",
        slotType: "ITEM",
        itemType: "ACCESSORY",
      }),
    ];
    const out = computeLoadoutAssignments(
      [
        { itemId: "acc1", slot: "ITEM_1" },
        { itemId: "acc2", slot: "ITEM_2" },
      ],
      items,
      USER,
    );
    expect(out.assignments).toEqual([{ userItemId: "r1", slot: "ITEM_1" }]);
    expect(out.invalidItems[0]).toMatch(/one accessory/);
  });

  it("skips home / level / bloodline / auction items", () => {
    const items = [
      ui({ id: "r1", itemId: "home", slotType: "HEAD", storedAtHome: true }),
      ui({ id: "r2", itemId: "high", slotType: "CHEST", requiredLevel: 999 }),
      ui({ id: "r3", itemId: "bl", slotType: "LEGS", bloodlineId: "other" }),
      ui({ id: "r4", itemId: "auc", slotType: "FEET", isInAuction: true }),
    ];
    const out = computeLoadoutAssignments(
      [
        { itemId: "home", slot: "HEAD" },
        { itemId: "high", slot: "CHEST" },
        { itemId: "bl", slot: "LEGS" },
        { itemId: "auc", slot: "FEET" },
      ],
      items,
      USER,
    );
    expect(out.assignments).toEqual([]);
    expect(out.invalidItems.length).toBe(4);
  });

  it("returns empty assignments for an empty loadout", () => {
    const out = computeLoadoutAssignments([], [], USER);
    expect(out.assignments).toEqual([]);
    expect(out.invalidItems).toEqual([]);
  });

  it("rejects an item currently being imbued (future craftingFinishedAt)", () => {
    const items = [
      ui({
        id: "r1",
        itemId: "i1",
        name: "Imbued Blade",
        slotType: "HEAD",
        imbuements: [{ craftingFinishedAt: FUTURE }],
      }),
    ];
    const out = computeLoadoutAssignments(
      [{ itemId: "i1", slot: "HEAD" }],
      items,
      USER,
      NOW,
    );
    expect(out.assignments).toEqual([]);
    expect(out.invalidItems.length).toBe(1);
    expect(out.invalidItems[0]).toMatch(/is being imbued/);
  });

  it("accepts an item whose imbuing has already finished (past craftingFinishedAt)", () => {
    const items = [
      ui({
        id: "r1",
        itemId: "i1",
        name: "Imbued Blade",
        slotType: "HEAD",
        imbuements: [{ craftingFinishedAt: PAST }],
      }),
    ];
    const out = computeLoadoutAssignments(
      [{ itemId: "i1", slot: "HEAD" }],
      items,
      USER,
      NOW,
    );
    expect(out.assignments).toEqual([{ userItemId: "r1", slot: "HEAD" }]);
    expect(out.invalidItems).toEqual([]);
  });

  it("prefers a clean duplicate row over a sibling that is being imbued", () => {
    // Two owned units of i1: r1 is mid-imbue, r2 is clean. The clean unit must
    // be chosen rather than skipping the entry as invalid.
    const items = [
      ui({
        id: "r1",
        itemId: "i1",
        slotType: "HEAD",
        imbuements: [{ craftingFinishedAt: FUTURE }],
      }),
      ui({ id: "r2", itemId: "i1", slotType: "HEAD" }),
    ];
    const out = computeLoadoutAssignments(
      [{ itemId: "i1", slot: "HEAD" }],
      items,
      USER,
      NOW,
    );
    expect(out.assignments).toEqual([{ userItemId: "r2", slot: "HEAD" }]);
    expect(out.invalidItems).toEqual([]);
  });

  it("recovers a saved NONE-sentinel slot to a real slot instead of assigning NONE", () => {
    // "NONE" is a valid ItemSlots member (the unequipped sentinel), so a saved
    // entry carrying it must not be taken at face value via the primary branch.
    const items = [ui({ id: "r1", itemId: "i1", slotType: "HEAD" })];
    const out = computeLoadoutAssignments(
      [{ itemId: "i1", slot: "NONE" }],
      items,
      USER,
      NOW,
    );
    expect(out.assignments).toEqual([{ userItemId: "r1", slot: "HEAD" }]);
    expect(out.invalidItems).toEqual([]);
  });

  it("does not resolve a NONE slot type to the NONE sentinel slot", () => {
    // Legacy/invalid saved slot forces the fallback resolver; an item whose
    // slot type is NONE must be rejected, never assigned the NONE sentinel.
    const items = [ui({ id: "r1", itemId: "i1", name: "Junk", slotType: "NONE" })];
    const out = computeLoadoutAssignments(
      // Legacy/removed saved slot value forces the fallback resolver.
      [{ itemId: "i1", slot: "ITEM_99" as unknown as ItemSlot }],
      items,
      USER,
      NOW,
    );
    expect(out.assignments).toEqual([]);
    expect(out.invalidItems[0]).toMatch(/invalid slot/);
  });

  it("re-resolves a saved slot incompatible with the item's slot type", () => {
    // A stale/corrupt loadout can carry a valid-enum slot ("CHEST") that does
    // not match the item's slot type ("HEAD"). It must not be equipped into
    // CHEST; the fallback resolver recovers a compatible HEAD slot instead.
    const items = [ui({ id: "r1", itemId: "i1", slotType: "HEAD" })];
    const out = computeLoadoutAssignments(
      [{ itemId: "i1", slot: "CHEST" }],
      items,
      USER,
      NOW,
    );
    expect(out.assignments).toEqual([{ userItemId: "r1", slot: "HEAD" }]);
    expect(out.invalidItems).toEqual([]);
  });
});

describe("COOKING item type", () => {
  it("is part of ItemTypes and NonActionItemTypes", () => {
    expect(ItemTypes).toContain("COOKING");
    expect(NonActionItemTypes).toContain("COOKING");
  });

  it("hides level badges like materials", () => {
    expect(showsItemLevelBadge({ itemType: "COOKING", slot: "ITEM" })).toBe(false);
    expect(showsItemLevelBadge({ itemType: "MATERIAL", slot: "ITEM" })).toBe(false);
    expect(showsItemLevelBadge({ itemType: "WEAPON", slot: "HAND" })).toBe(true);
  });
});

describe("inventory and home storage buckets", () => {
  it("prioritizes dedicated types over event flag", () => {
    expect(getInventoryBucket({ itemType: "COOKING", isEventItem: true })).toBe(
      "cooking",
    );
    expect(getInventoryBucket({ itemType: "MATERIAL", isEventItem: true })).toBe(
      "materials",
    );
    expect(getInventoryBucket({ itemType: "CONSUMABLE", isEventItem: true })).toBe(
      "event",
    );
    expect(getInventoryBucket({ itemType: "WEAPON", isEventItem: false })).toBe(
      "normal",
    );
  });

  it("maps home storage with event items using ordinary capacity", () => {
    expect(getHomeStorageBucket({ itemType: "COOKING" })).toBe("cooking");
    expect(getHomeStorageBucket({ itemType: "MATERIAL" })).toBe("materials");
    expect(getHomeStorageBucket({ itemType: "CONSUMABLE" })).toBe("normal");
  });

  it("keeps cooking out of normal and materials buckets", () => {
    const cooking = { itemType: "COOKING", isEventItem: false };
    expect(getInventoryBucket(cooking)).not.toBe("normal");
    expect(getInventoryBucket(cooking)).not.toBe("materials");
    expect(getInventoryBucket(cooking)).not.toBe("event");
  });
});

describe("cooking capacity", () => {
  const user = (over: Partial<UserData> = {}) =>
    ({
      staffAccount: false,
      federalStatus: "NONE",
      extraItemSlots: 0,
      ...over,
    }) as UserData;

  it("mirrors materials base, federal, and purchased extras", () => {
    expect(calcMaxCookingItems(user())).toBe(COOKING_BASE_SLOTS);
    expect(calcMaxCookingItems(user({ federalStatus: "NORMAL" }))).toBe(
      COOKING_BASE_SLOTS + FED_COOKING_NORMAL_SLOTS,
    );
    expect(calcMaxCookingItems(user({ federalStatus: "SILVER" }))).toBe(
      COOKING_BASE_SLOTS + FED_COOKING_SILVER_SLOTS,
    );
    expect(calcMaxCookingItems(user({ federalStatus: "GOLD" }))).toBe(
      COOKING_BASE_SLOTS + FED_COOKING_GOLD_SLOTS,
    );
    expect(calcMaxCookingItems(user({ extraItemSlots: 3 }))).toBe(
      COOKING_BASE_SLOTS + 3,
    );
    expect(calcMaxCookingItems(user())).toBe(calcMaxMaterials(user()));
    expect(calcMaxCookingItems(user())).toBe(MATERIALS_BASE_SLOTS);
  });

  it("uses homeStorage - 10 for house cooking capacity", () => {
    expect(calcMaxHouseCookingItems(user(), 25)).toBe(15);
    expect(calcMaxHouseCookingItems(user(), 5)).toBe(0);
    expect(calcMaxHouseCookingItems(user(), 25)).toBe(
      calcMaxHouseMaterials(user(), 25),
    );
  });

  it("reports cooking-specific full messages and capacity", () => {
    expect(getInventoryBucketFullMessage("cooking")).toBe(
      "Cooking inventory is full",
    );
    expect(getInventoryBucketCapacity("cooking", user({ federalStatus: "GOLD" }))).toBe(
      COOKING_BASE_SLOTS + FED_COOKING_GOLD_SLOTS,
    );
    expect(getHomeStorageBucketFullMessage("cooking")).toBe(
      "Your home cooking storage is full",
    );
  });

  it("does not consume normal or materials capacity for cooking items", () => {
    const cooking = { itemType: "COOKING" as const, isEventItem: false };
    expect(getInventoryBucket(cooking)).toBe("cooking");
    expect(getHomeStorageBucket(cooking)).toBe("cooking");
    expect(getInventoryBucketFullMessage(getInventoryBucket(cooking))).not.toBe(
      "Inventory is full",
    );
    expect(getInventoryBucketFullMessage(getInventoryBucket(cooking))).not.toBe(
      "Materials inventory is full",
    );
  });
});
