import { describe, expect, it } from "bun:test";
import { readItemListFilterSlot } from "@/libs/item";
import { itemFilteringSchema } from "@/validators/item";

describe("item list slot aliases", () => {
  it("accepts an equipped position and reads its catalog slot", () => {
    expect(itemFilteringSchema.parse({ limit: 500, slot: "HAND_1" }).slot).toBe(
      "HAND_1",
    );
    expect(readItemListFilterSlot("HAND_1", undefined)).toEqual({
      slot: "HAND",
      itemType: undefined,
    });
  });

  it("accepts an item type sent as slot and filters by that type", () => {
    expect(itemFilteringSchema.parse({ limit: 500, slot: "ACCESSORY" }).slot).toBe(
      "ACCESSORY",
    );
    expect(readItemListFilterSlot("ACCESSORY", undefined)).toEqual({
      slot: undefined,
      itemType: "ACCESSORY",
    });
  });

  it("does not replace an item type that was sent alongside a mistaken slot", () => {
    expect(readItemListFilterSlot("ACCESSORY", "WEAPON")).toEqual({
      slot: undefined,
      itemType: "WEAPON",
    });
  });

  it("keeps a catalog slot", () => {
    expect(itemFilteringSchema.parse({ limit: 500, slot: "HEAD" }).slot).toBe("HEAD");
  });

  it("still rejects an unknown slot", () => {
    expect(() => itemFilteringSchema.parse({ limit: 500, slot: "POCKET" })).toThrow();
  });
});
