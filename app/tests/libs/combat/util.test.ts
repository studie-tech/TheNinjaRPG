import { describe, it, expect } from "vitest";
import { applyActiveVariant } from "@/libs/combat/util";

const baseItem = {
  id: "item-1",
  image: "/items/base.png",
  name: "Base Sword",
  description: "A sharp blade.",
};

describe("applyActiveVariant", () => {
  // ── no active variant ──────────────────────────────────────────────────────

  it("returns base item fields when activeVariantId is null", () => {
    const result = applyActiveVariant({
      activeVariantId: null,
      item: {
        ...baseItem,
        variants: [
          {
            id: "v1",
            image: "/items/red.png",
            name: "Red Sword",
            description: "A scarlet blade.",
          },
        ],
      },
    });
    expect(result.image).toBe("/items/base.png");
    expect(result.name).toBe("Base Sword");
    expect(result.description).toBe("A sharp blade.");
  });

  it("returns base item fields when activeVariantId is undefined", () => {
    const result = applyActiveVariant({
      activeVariantId: undefined,
      item: { ...baseItem, variants: [{ id: "v1", image: "/items/red.png" }] },
    });
    expect(result.image).toBe("/items/base.png");
    expect(result.name).toBe("Base Sword");
    expect(result.description).toBe("A sharp blade.");
  });

  it("returns base item fields when activeVariantId is an empty string", () => {
    const result = applyActiveVariant({
      activeVariantId: "",
      item: { ...baseItem, variants: [{ id: "v1", image: "/items/red.png" }] },
    });
    expect(result.image).toBe("/items/base.png");
  });

  // ── active variant resolves ────────────────────────────────────────────────

  it("overrides image/name/description when the active variant matches", () => {
    const result = applyActiveVariant({
      activeVariantId: "v2",
      item: {
        ...baseItem,
        variants: [
          {
            id: "v1",
            image: "/items/red.png",
            name: "Red Sword",
            description: "A scarlet blade.",
          },
          {
            id: "v2",
            image: "/items/blue.png",
            name: "Blue Sword",
            description: "An azure blade.",
          },
        ],
      },
    });
    expect(result.image).toBe("/items/blue.png");
    expect(result.name).toBe("Blue Sword");
    expect(result.description).toBe("An azure blade.");
  });

  it("falls back per-field when the variant leaves name/description null", () => {
    const result = applyActiveVariant({
      activeVariantId: "v1",
      item: {
        ...baseItem,
        variants: [
          { id: "v1", image: "/items/red.png", name: null, description: null },
        ],
      },
    });
    // image is always defined on a variant, so it overrides...
    expect(result.image).toBe("/items/red.png");
    // ...but null name/description fall back to the base item.
    expect(result.name).toBe("Base Sword");
    expect(result.description).toBe("A sharp blade.");
  });

  it("returns base item fields when activeVariantId matches no variant", () => {
    const result = applyActiveVariant({
      activeVariantId: "v-missing",
      item: {
        ...baseItem,
        variants: [{ id: "v1", image: "/items/red.png", name: "Red Sword" }],
      },
    });
    expect(result.image).toBe("/items/base.png");
    expect(result.name).toBe("Base Sword");
  });

  // ── variants array absent / empty ──────────────────────────────────────────

  it("returns base item fields when variants is absent and activeVariantId is set", () => {
    const result = applyActiveVariant({
      activeVariantId: "v1",
      item: { ...baseItem },
    });
    expect(result.image).toBe("/items/base.png");
    expect(result.name).toBe("Base Sword");
  });

  it("returns base item fields when variants is empty and activeVariantId is set", () => {
    const result = applyActiveVariant({
      activeVariantId: "v1",
      item: { ...baseItem, variants: [] },
    });
    expect(result.image).toBe("/items/base.png");
  });

  // ── merged object preserves the rest of the item ───────────────────────────

  it("preserves non-cosmetic item fields in the returned object", () => {
    const result = applyActiveVariant({
      activeVariantId: "v1",
      item: {
        ...baseItem,
        variants: [{ id: "v1", image: "/items/red.png", name: "Red Sword" }],
      },
    });
    expect(result.id).toBe("item-1");
    expect(result.name).toBe("Red Sword");
  });
});
