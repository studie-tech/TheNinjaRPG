import { describe, expect, it } from "vitest";
import type { Jutsu } from "@/drizzle/schema";
import {
  checkJutsuBloodlineItem,
  type JutsuBloodlineItemUserItems,
} from "@/libs/train";

type MinimalJutsu = Pick<Jutsu, "requiredBloodlineItemId">;
type MinimalUserItemWithItem = JutsuBloodlineItemUserItems[number];

const ITEM_ID = "item-abc";

const makeJutsu = (requiredBloodlineItemId: string | null): MinimalJutsu =>
  ({ requiredBloodlineItemId }) as MinimalJutsu;

const makeUserItem = (
  itemId: string,
  equipped: MinimalUserItemWithItem["equipped"],
  durability = 100,
  itemType: MinimalUserItemWithItem["item"]["itemType"] = "KEYSTONE",
  maxDurability = 100,
): MinimalUserItemWithItem =>
  ({
    itemId,
    equipped,
    durability,
    item: { id: itemId, itemType, maxDurability },
  }) as MinimalUserItemWithItem;

const check = (
  requiredBloodlineItemId: string | null,
  userItems?: JutsuBloodlineItemUserItems,
) => checkJutsuBloodlineItem(makeJutsu(requiredBloodlineItemId) as Jutsu, userItems);

describe("checkJutsuBloodlineItem", () => {
  it.each([
    ["null", null],
    ["empty string", ""],
  ])(
    "returns true when no requiredBloodlineItemId is set (%s)",
    (_label, requiredBloodlineItemId) => {
      expect(check(requiredBloodlineItemId)).toBe(true);
    },
  );

  it("returns false when requiredBloodlineItemId is set and userItems is undefined", () => {
    expect(check(ITEM_ID)).toBe(false);
  });

  it("returns false when requiredBloodlineItemId is set but item is not equipped", () => {
    const items = [makeUserItem(ITEM_ID, "NONE")];
    expect(check(ITEM_ID, items)).toBe(false);
  });

  it("returns true when required item is equipped in a non-NONE slot with durability", () => {
    const items = [makeUserItem(ITEM_ID, "HAND_1", 50)];
    expect(check(ITEM_ID, items)).toBe(true);
  });

  it("returns false when a broken KEYSTONE required item is equipped (durability gated)", () => {
    const items = [makeUserItem(ITEM_ID, "HAND_1", 0, "KEYSTONE")];
    expect(check(ITEM_ID, items)).toBe(false);
  });

  it("returns false when a broken ARMOR required item is equipped (durability gated)", () => {
    const items = [makeUserItem(ITEM_ID, "HAND_1", 0, "ARMOR")];
    expect(check(ITEM_ID, items)).toBe(false);
  });

  it("returns true for a broken WEAPON required item (weapons stay equipped at low durability in combat)", () => {
    const items = [makeUserItem(ITEM_ID, "HAND_1", 0, "WEAPON")];
    expect(check(ITEM_ID, items)).toBe(true);
  });

  it("returns false when a different item is equipped but not the required one", () => {
    const items = [makeUserItem("other-item", "HAND_1")];
    expect(check(ITEM_ID, items)).toBe(false);
  });
});
