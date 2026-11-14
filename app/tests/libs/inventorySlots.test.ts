import { describe, expect, it } from "bun:test";
import { countInventorySlots, type InventorySlotRow } from "@/libs/item";
import { countHeldInventorySlots } from "@/libs/itemsPage";

type Row = InventorySlotRow;
type SlotItem = NonNullable<Row["item"]>;

const kit: SlotItem = {
  itemType: "CONSUMABLE",
  isEventItem: false,
  canStack: true,
  stackSize: 9999,
};
const ore: SlotItem = {
  itemType: "MATERIAL",
  isEventItem: false,
  canStack: true,
  stackSize: 10,
};
const blade: SlotItem = {
  itemType: "WEAPON",
  isEventItem: false,
  canStack: false,
  stackSize: 1,
};
const charm: SlotItem = {
  itemType: "ACCESSORY",
  isEventItem: false,
  canStack: true,
  stackSize: 5,
};

/** A carried row; the label only names it in the test. */
const row = (
  _label: string,
  itemId: string,
  item: SlotItem,
  overrides: Partial<Row> = {},
): Row => ({
  itemId,
  quantity: 1,
  equipped: "NONE",
  storedAtHome: false,
  isInAuction: false,
  craftingFinishedAt: null,
  activeVariantId: null,
  level: 1,
  imbuements: [],
  item,
  ...overrides,
});

const listed = (label: string, itemId: string, item: SlotItem, quantity: number) =>
  row(label, itemId, item, { quantity, isInAuction: true });

describe("backpack slots", () => {
  it("counts one slot per carried stack, leaving equipped and stored items out", () => {
    expect(
      countInventorySlots([
        row("a", "ore", ore, { quantity: 4 }),
        row("b", "blade", blade),
        row("worn", "blade", blade, { equipped: "HAND_1" }),
        row("home", "ore", ore, { storedAtHome: true }),
      ]),
    ).toBe(2);
  });

  it("counts several listings of an item as the stacks their quantity needs", () => {
    // 900 kits: 700 carried, and two listings of 100 share one stack of 9,999.
    expect(
      countInventorySlots([
        row("bag", "kit", kit, { quantity: 700 }),
        listed("lot-a", "kit", kit, 100),
        listed("lot-b", "kit", kit, 100),
      ]),
    ).toBe(2);
    expect(
      countInventorySlots([
        listed("lot-a", "kit", kit, 20),
        listed("lot-b", "kit", kit, 20),
      ]),
    ).toBe(1);
  });

  it("adds a slot for each stack the listed quantity fills", () => {
    // 7 + 6 + 5 listed ore need two stacks of 10.
    expect(
      countInventorySlots([
        row("bag", "ore", ore, { quantity: 8 }),
        listed("lot-a", "ore", ore, 7),
        listed("lot-b", "ore", ore, 6),
        listed("lot-c", "ore", ore, 5),
      ]),
    ).toBe(3);
  });

  it("counts listings the same however full the carried stack is", () => {
    const lots = [listed("lot-a", "ore", ore, 3), listed("lot-b", "ore", ore, 2)];
    expect(
      countInventorySlots([row("bag", "ore", ore, { quantity: 5 }), ...lots]),
    ).toBe(2);
    expect(
      countInventorySlots([row("bag", "ore", ore, { quantity: 10 }), ...lots]),
    ).toBe(2);
  });

  it("gives a slot to each listing that cannot share a stack", () => {
    expect(
      countInventorySlots([
        listed("blade-a", "blade", blade, 1),
        listed("blade-b", "blade", blade, 1),
        row("imbued", "ore", ore, { quantity: 2, isInAuction: true, imbuements: [{}] }),
        listed("plain", "ore", ore, 2),
      ]),
    ).toBe(4);
  });

  it("keeps listings of gear at different levels in separate stacks", () => {
    expect(
      countInventorySlots([
        listed("lot-a", "charm", charm, 1),
        listed("lot-b", "charm", charm, 1),
        row("lot-other", "charm", charm, { quantity: 1, level: 3, isInAuction: true }),
      ]),
    ).toBe(2);
  });

  it("counts the slots listings use as held by listings", () => {
    const now = new Date();
    expect(
      countHeldInventorySlots(
        [
          row("bag", "kit", kit, { quantity: 700 }),
          listed("lot-a", "kit", kit, 100),
          listed("lot-b", "kit", kit, 100),
        ],
        "normal",
        now,
      ),
    ).toEqual({ auction: 1, crafting: 0 });
    expect(
      countHeldInventorySlots(
        [listed("lot-a", "ore", ore, 7), listed("lot-b", "ore", ore, 6)],
        "materials",
        now,
      ),
    ).toEqual({ auction: 2, crafting: 0 });
  });
});
