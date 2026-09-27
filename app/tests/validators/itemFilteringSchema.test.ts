import { describe, expect, it } from "vitest";
import { itemFilteringSchema, resolveItemListFilter } from "@/validators/item";

describe("item list slot aliases", () => {
  it("maps an equipped hand slot onto the catalog hand slot", () => {
    const parsed = itemFilteringSchema.parse({ limit: 500, slot: "HAND_1" });
    expect(resolveItemListFilter(parsed).slot).toBe("HAND");
  });

  it("treats an item type sent as slot as the item type", () => {
    const parsed = itemFilteringSchema.parse({ limit: 500, slot: "ACCESSORY" });
    const resolved = resolveItemListFilter(parsed);
    expect(resolved.slot).toBeUndefined();
    expect(resolved.itemType).toBe("ACCESSORY");
  });

  it("does not replace an item type that was sent alongside a mistaken slot", () => {
    const resolved = resolveItemListFilter({ slot: "ACCESSORY", itemType: "WEAPON" });
    expect(resolved.itemType).toBe("WEAPON");
    expect(resolved.slot).toBeUndefined();
  });

  it("keeps a catalog slot", () => {
    const parsed = itemFilteringSchema.parse({ limit: 500, slot: "HEAD" });
    expect(resolveItemListFilter(parsed).slot).toBe("HEAD");
  });

  it("still rejects an unknown slot", () => {
    expect(() => itemFilteringSchema.parse({ limit: 500, slot: "POCKET" })).toThrow();
  });
});
