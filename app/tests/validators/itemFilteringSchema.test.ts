import { describe, expect, it } from "vitest";
import { itemFilteringSchema } from "@/validators/item";

describe("item list slot aliases", () => {
  it("accepts an equipped position", () => {
    expect(itemFilteringSchema.parse({ limit: 500, slot: "HAND_1" }).slot).toBe(
      "HAND_1",
    );
  });

  it("accepts an item type sent as slot", () => {
    expect(itemFilteringSchema.parse({ limit: 500, slot: "ACCESSORY" }).slot).toBe(
      "ACCESSORY",
    );
  });

  it("keeps a catalog slot", () => {
    expect(itemFilteringSchema.parse({ limit: 500, slot: "HEAD" }).slot).toBe("HEAD");
  });

  it("still rejects an unknown slot", () => {
    expect(() => itemFilteringSchema.parse({ limit: 500, slot: "POCKET" })).toThrow();
  });
});
