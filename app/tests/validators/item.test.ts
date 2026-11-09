import { describe, it, expect } from "bun:test";
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
    if (result.success) expect(result.data.id).toBeUndefined();
  });

  it("accepts a valid update payload (with id)", () => {
    const result = ItemVariantValidator.safeParse({ ...valid, id: "variant-abc" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.id).toBe("variant-abc");
  });

  // ── name ──────────────────────────────────────────────────────────────────

  it("trims leading/trailing whitespace from name", () => {
    const result = ItemVariantValidator.safeParse({
      ...valid,
      name: "  Red Edition  ",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe("Red Edition");
  });

  // ── costType ──────────────────────────────────────────────────────────────

  it("accepts all valid costType values", () => {
    const types = [
      "MONEY",
      "REPUTATION",
      "SEICHI_SILVER",
      "VILLAGE_PRESTIGE",
      "VARIANT_TOKEN",
    ] as const;
    for (const costType of types) {
      const result = ItemVariantValidator.safeParse({ ...valid, costType });
      expect(result.success, `costType "${costType}" should be valid`).toBe(true);
    }
  });

  // ── cost ──────────────────────────────────────────────────────────────────

  it("accepts cost of 0", () => {
    const result = ItemVariantValidator.safeParse({ ...valid, cost: 0 });
    expect(result.success).toBe(true);
  });

  it("coerces string cost to number", () => {
    const result = ItemVariantValidator.safeParse({ ...valid, cost: "100" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.cost).toBe(100);
  });

  // ── order ─────────────────────────────────────────────────────────────────

  it(`accepts order ${MAX_ITEM_VARIANTS} (maximum)`, () => {
    const result = ItemVariantValidator.safeParse({
      ...valid,
      order: MAX_ITEM_VARIANTS,
    });
    expect(result.success).toBe(true);
  });

  it("coerces string order to number", () => {
    const result = ItemVariantValidator.safeParse({ ...valid, order: "3" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.order).toBe(3);
  });

  it.each([
    { title: "rejects empty name", patch: { name: "" } },
    { title: "rejects whitespace-only name", patch: { name: "   " } },
    { title: "rejects empty image", patch: { image: "" } },
    { title: "rejects unknown costType", patch: { costType: "GOLD" } },
    { title: "rejects negative cost", patch: { cost: -1 } },
    { title: "rejects non-integer cost", patch: { cost: 9.5 } },
    { title: "rejects order 0 (below minimum)", patch: { order: 0 } },
    {
      title: `rejects order ${MAX_ITEM_VARIANTS + 1} (above maximum)`,
      patch: { order: MAX_ITEM_VARIANTS + 1 },
    },
    { title: "rejects non-integer order", patch: { order: 1.5 } },
  ])("$title", ({ patch }) => {
    expect(ItemVariantValidator.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  // ── description ───────────────────────────────────────────────────────────

  describe("description field", () => {
    it("accepts an empty string description", () => {
      const result = ItemVariantValidator.safeParse({ ...valid, description: "" });
      expect(result.success).toBe(true);
    });

    it("accepts a non-empty description", () => {
      const result = ItemVariantValidator.safeParse({
        ...valid,
        description: "Crimson flame edition.",
      });
      expect(result.success).toBe(true);
      if (result.success)
        expect(result.data.description).toBe("Crimson flame edition.");
    });
  });

  // ── battleDescription ─────────────────────────────────────────────────────

  describe("battleDescription field", () => {
    it("accepts an empty string battleDescription", () => {
      const result = ItemVariantValidator.safeParse({
        ...valid,
        battleDescription: "",
      });
      expect(result.success).toBe(true);
    });

    it("accepts a non-empty battleDescription", () => {
      const result = ItemVariantValidator.safeParse({
        ...valid,
        battleDescription: "%user strikes with the Crimson Blade",
      });
      expect(result.success).toBe(true);
      if (result.success)
        expect(result.data.battleDescription).toBe(
          "%user strikes with the Crimson Blade",
        );
    });
  });
});
