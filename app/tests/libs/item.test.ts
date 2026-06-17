import { describe, it, expect } from "vitest";
import {
  checkEquipConstraints,
  computeLoadoutAssignments,
  type EquipConstraintInfo,
  type EquippedAssignment,
  isEquippableUserItem,
} from "@/libs/item";
import type { ItemSlot } from "@/drizzle/constants";
import type { UserItemWithRelations } from "@/drizzle/schema";

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

const info = (over: Partial<EquipConstraintInfo>): EquipConstraintInfo => ({
  itemId: "i1",
  bloodlineId: null,
  itemType: "WEAPON",
  slot: "HEAD",
  maxEquips: 1,
  ...over,
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
  it("blocks a second bloodline item", () => {
    const current: EquippedAssignment[] = [
      { slot: "ITEM_1", info: info({ itemId: "b1", bloodlineId: "bl1" }) },
    ];
    expect(
      checkEquipConstraints(info({ itemId: "b2", bloodlineId: "bl1" }), current),
    ).toMatch(/one item with a bloodline/);
  });
  it("blocks a second ARMOR item in hand slots", () => {
    const current: EquippedAssignment[] = [
      { slot: "HAND_1", info: info({ itemId: "a1", itemType: "ARMOR", slot: "HAND" }) },
    ];
    expect(
      checkEquipConstraints(info({ itemId: "a2", itemType: "ARMOR", slot: "HAND" }), current),
    ).toMatch(/one armor item in your hand/);
  });
  it("allows a non-armor hand item alongside an armor hand item", () => {
    const current: EquippedAssignment[] = [
      { slot: "HAND_1", info: info({ itemId: "a1", itemType: "ARMOR", slot: "HAND" }) },
    ];
    expect(
      checkEquipConstraints(info({ itemId: "w1", itemType: "WEAPON", slot: "HAND" }), current),
    ).toBeNull();
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
});
