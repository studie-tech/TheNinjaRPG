import { describe, it, expect } from "bun:test";
import { applyActiveVariant } from "@/libs/item";
import { DEFAULT_FURNITURE_DATA, type FurnitureData } from "@/validators/itemFurniture";

const baseItem = {
  id: "item-1",
  image: "/items/base.png",
  name: "Base Sword",
  description: "A sharp blade.",
};

describe("applyActiveVariant", () => {
  it("uses the skin's sprite geometry without inheriting another image's transparent padding", () => {
    const geometry = {
      aspectRatio: 2,
      visibleBounds: { x: 10, y: 20, width: 80, height: 70 },
      footprint: { x: 20, y: 70, width: 60, height: 20 },
    };
    const furnitureData = { ...DEFAULT_FURNITURE_DATA, geometry };
    const variant = {
      id: "red",
      image: "/red.webp",
      furnitureData: { geometry: { ...geometry, aspectRatio: 1 }, views: {} },
    };
    const item = { ...baseItem, furnitureData, variants: [variant] };
    expect(
      applyActiveVariant({ activeVariantId: "red", item }).furnitureData.geometry
        ?.aspectRatio,
    ).toBe(1);
    expect(
      applyActiveVariant({
        activeVariantId: "red",
        item: { ...item, variants: [{ id: "red", image: "/red.webp" }] },
      }).furnitureData.geometry,
    ).toBeUndefined();
    expect(
      applyActiveVariant({ activeVariantId: null, item }).furnitureData.geometry,
    ).toBe(geometry);
  });

  it("replaces furniture directions with the active skin's complete set without mutating mechanics", () => {
    const furnitureData: FurnitureData = {
      ...DEFAULT_FURNITURE_DATA,
      action: "storage",
      views: { "90": { image: "/base-90.webp" } },
    };
    const item = {
      ...baseItem,
      furnitureData,
      variants: [
        {
          id: "red",
          image: "/red.webp",
          furnitureData: {
            width: 20,
            groundAnchor: 90,
            views: { "180": { image: "/red-180.webp", width: 18 } },
          },
        },
      ],
    };
    const result = applyActiveVariant({ activeVariantId: "red", item });
    expect(result.furnitureData).toEqual({
      ...furnitureData,
      width: 20,
      groundAnchor: 90,
      views: { "180": { image: "/red-180.webp", width: 18 } },
    });
    expect(item.furnitureData.views).toEqual({ "90": { image: "/base-90.webp" } });
    expect(applyActiveVariant({ activeVariantId: null, item }).furnitureData).toBe(
      furnitureData,
    );
  });

  it.each([undefined, null, { views: {} }])(
    "uses only the active skin's canonical image when its directions are missing: %j",
    (variantData) => {
      const furnitureData: FurnitureData = {
        ...DEFAULT_FURNITURE_DATA,
        views: { "90": { image: "/base-90.webp" } },
      };
      const result = applyActiveVariant({
        activeVariantId: "red",
        item: {
          ...baseItem,
          furnitureData,
          variants: [{ id: "red", image: "/red.webp", furnitureData: variantData }],
        },
      });
      expect(result.image).toBe("/red.webp");
      expect(result.furnitureData.views).toEqual({});
    },
  );

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
