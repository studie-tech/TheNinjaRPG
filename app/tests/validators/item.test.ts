import { describe, it, expect } from "vitest";
import { ItemVariantValidator } from "@/validators/item";
import { MAX_ITEM_VARIANTS } from "@/drizzle/constants";

describe("ItemVariantValidator", () => {
  const valid = {
    name: "Red Edition",
    image: "https://utfs.io/f/abc123",
    costType: "MONEY" as const,
    cost: 500,
    order: 1,
  };

  it("accepts a fully valid create payload (no id)", () => {
    const result = ItemVariantValidator.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("accepts a valid update payload (with id)", () => {
    const result = ItemVariantValidator.safeParse({ ...valid, id: "variant-abc" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.id).toBe("variant-abc");
  });

  it("id field is optional — omitting it is valid", () => {
    const { id: _id, ...withoutId } = { ...valid, id: "x" };
    const result = ItemVariantValidator.safeParse(withoutId);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.id).toBeUndefined();
  });

  // ── name ──────────────────────────────────────────────────────────────────

  it("rejects empty name", () => {
    const result = ItemVariantValidator.safeParse({ ...valid, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects whitespace-only name", () => {
    const result = ItemVariantValidator.safeParse({ ...valid, name: "   " });
    expect(result.success).toBe(false);
  });

  it("trims leading/trailing whitespace from name", () => {
    const result = ItemVariantValidator.safeParse({ ...valid, name: "  Red Edition  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe("Red Edition");
  });

  // ── image ─────────────────────────────────────────────────────────────────

  it("rejects empty image", () => {
    const result = ItemVariantValidator.safeParse({ ...valid, image: "" });
    expect(result.success).toBe(false);
  });

  // ── costType ──────────────────────────────────────────────────────────────

  it("accepts all valid costType values", () => {
    const types = ["MONEY", "REPUTATION", "SEICHI_SILVER", "VILLAGE_PRESTIGE", "VARIANT_TOKEN"] as const;
    for (const costType of types) {
      const result = ItemVariantValidator.safeParse({ ...valid, costType });
      expect(result.success, `costType "${costType}" should be valid`).toBe(true);
    }
  });

  it("rejects unknown costType", () => {
    const result = ItemVariantValidator.safeParse({ ...valid, costType: "GOLD" });
    expect(result.success).toBe(false);
  });

  // ── cost ──────────────────────────────────────────────────────────────────

  it("accepts cost of 0", () => {
    const result = ItemVariantValidator.safeParse({ ...valid, cost: 0 });
    expect(result.success).toBe(true);
  });

  it("rejects negative cost", () => {
    const result = ItemVariantValidator.safeParse({ ...valid, cost: -1 });
    expect(result.success).toBe(false);
  });

  it("coerces string cost to number", () => {
    const result = ItemVariantValidator.safeParse({ ...valid, cost: "100" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.cost).toBe(100);
  });

  it("rejects non-integer cost", () => {
    const result = ItemVariantValidator.safeParse({ ...valid, cost: 9.5 });
    expect(result.success).toBe(false);
  });

  // ── order ─────────────────────────────────────────────────────────────────

  it("accepts order 1 (minimum)", () => {
    const result = ItemVariantValidator.safeParse({ ...valid, order: 1 });
    expect(result.success).toBe(true);
  });

  it(`accepts order ${MAX_ITEM_VARIANTS} (maximum)`, () => {
    const result = ItemVariantValidator.safeParse({ ...valid, order: MAX_ITEM_VARIANTS });
    expect(result.success).toBe(true);
  });

  it("rejects order 0 (below minimum)", () => {
    const result = ItemVariantValidator.safeParse({ ...valid, order: 0 });
    expect(result.success).toBe(false);
  });

  it(`rejects order ${MAX_ITEM_VARIANTS + 1} (above maximum)`, () => {
    const result = ItemVariantValidator.safeParse({ ...valid, order: MAX_ITEM_VARIANTS + 1 });
    expect(result.success).toBe(false);
  });

  it("coerces string order to number", () => {
    const result = ItemVariantValidator.safeParse({ ...valid, order: "3" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.order).toBe(3);
  });

  it("rejects non-integer order", () => {
    const result = ItemVariantValidator.safeParse({ ...valid, order: 1.5 });
    expect(result.success).toBe(false);
  });

  // ── description ───────────────────────────────────────────────────────────

  describe("description field", () => {
    it("accepts undefined description", () => {
      const result = ItemVariantValidator.safeParse({ ...valid });
      expect(result.success).toBe(true);
    });

    it("accepts an empty string description", () => {
      const result = ItemVariantValidator.safeParse({ ...valid, description: "" });
      expect(result.success).toBe(true);
    });

    it("accepts a non-empty description", () => {
      const result = ItemVariantValidator.safeParse({ ...valid, description: "Crimson flame edition." });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.description).toBe("Crimson flame edition.");
    });
  });

  // ── battleDescription ─────────────────────────────────────────────────────

  describe("battleDescription field", () => {
    it("accepts undefined battleDescription", () => {
      const result = ItemVariantValidator.safeParse({ ...valid });
      expect(result.success).toBe(true);
    });

    it("accepts a non-empty battleDescription", () => {
      const result = ItemVariantValidator.safeParse({
        ...valid,
        battleDescription: "%user strikes with the Crimson Blade",
      });
      expect(result.success).toBe(true);
      if (result.success)
        expect(result.data.battleDescription).toBe("%user strikes with the Crimson Blade");
    });
  });
});
