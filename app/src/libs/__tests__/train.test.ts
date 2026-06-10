import { describe, expect, it } from "vitest";
import type { Item, Jutsu, UserItem } from "@/drizzle/schema";
import { checkJutsuBloodlineItem } from "@/libs/train";

type MinimalJutsu = Pick<Jutsu, "requiredBloodlineItemId">;
type MinimalUserItemWithItem = Pick<UserItem, "itemId" | "equipped" | "durability"> & {
  item: Pick<Item, "id" | "itemType" | "maxDurability">;
};

const ITEM_ID = "item-abc";

const makeJutsu = (requiredBloodlineItemId: string | null): MinimalJutsu =>
  ({ requiredBloodlineItemId }) as MinimalJutsu;

const makeUserItem = (
  itemId: string,
  equipped: UserItem["equipped"],
  durability = 100,
  itemType: Item["itemType"] = "KEYSTONE",
  maxDurability = 100,
): MinimalUserItemWithItem =>
  ({
    itemId,
    equipped,
    durability,
    item: { id: itemId, itemType, maxDurability },
  }) as MinimalUserItemWithItem;

describe("checkJutsuBloodlineItem", () => {
  it("returns true when no requiredBloodlineItemId is set (null)", () => {
    const result = checkJutsuBloodlineItem(makeJutsu(null) as Jutsu, []);
    expect(result).toBe(true);
  });

  it("returns true when no requiredBloodlineItemId is set (empty string)", () => {
    const result = checkJutsuBloodlineItem(makeJutsu("") as Jutsu, []);
    expect(result).toBe(true);
  });

  it("returns false when requiredBloodlineItemId is set and userItems is undefined", () => {
    const result = checkJutsuBloodlineItem(makeJutsu(ITEM_ID) as Jutsu, undefined);
    expect(result).toBe(false);
  });

  it("returns false when requiredBloodlineItemId is set but item is not equipped", () => {
    const items = [makeUserItem(ITEM_ID, "NONE")];
    const result = checkJutsuBloodlineItem(
      makeJutsu(ITEM_ID) as Jutsu,
      items as Parameters<typeof checkJutsuBloodlineItem>[1],
    );
    expect(result).toBe(false);
  });

  it("returns true when required item is equipped in a non-NONE slot with durability", () => {
    const items = [makeUserItem(ITEM_ID, "HAND_1", 50)];
    const result = checkJutsuBloodlineItem(
      makeJutsu(ITEM_ID) as Jutsu,
      items as Parameters<typeof checkJutsuBloodlineItem>[1],
    );
    expect(result).toBe(true);
  });

  it("returns false when a broken KEYSTONE required item is equipped (durability gated)", () => {
    const items = [makeUserItem(ITEM_ID, "HAND_1", 0, "KEYSTONE")];
    const result = checkJutsuBloodlineItem(
      makeJutsu(ITEM_ID) as Jutsu,
      items as Parameters<typeof checkJutsuBloodlineItem>[1],
    );
    expect(result).toBe(false);
  });

  it("returns false when a broken ARMOR required item is equipped (durability gated)", () => {
    const items = [makeUserItem(ITEM_ID, "HAND_1", 0, "ARMOR")];
    const result = checkJutsuBloodlineItem(
      makeJutsu(ITEM_ID) as Jutsu,
      items as Parameters<typeof checkJutsuBloodlineItem>[1],
    );
    expect(result).toBe(false);
  });

  it("returns true for a broken WEAPON required item (weapons stay equipped at low durability in combat)", () => {
    const items = [makeUserItem(ITEM_ID, "HAND_1", 0, "WEAPON")];
    const result = checkJutsuBloodlineItem(
      makeJutsu(ITEM_ID) as Jutsu,
      items as Parameters<typeof checkJutsuBloodlineItem>[1],
    );
    expect(result).toBe(true);
  });

  it("returns false when a different item is equipped but not the required one", () => {
    const items = [makeUserItem("other-item", "HAND_1")];
    const result = checkJutsuBloodlineItem(
      makeJutsu(ITEM_ID) as Jutsu,
      items as Parameters<typeof checkJutsuBloodlineItem>[1],
    );
    expect(result).toBe(false);
  });
});
