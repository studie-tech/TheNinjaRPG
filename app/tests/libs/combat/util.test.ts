import { describe, it, expect } from "vitest";
import {
  getItemDisplayImage,
  getItemDisplayName,
  getItemDisplayDescription,
  getItemDisplayBattleDescription,
} from "@/libs/combat/util";

describe("getItemDisplayImage", () => {
  // ── flat { image } shape ──────────────────────────────────────────────────

  it("returns image directly from a flat source object", () => {
    const result = getItemDisplayImage({ image: "/items/sword.png" });
    expect(result).toBe("/items/sword.png");
  });

  // ── userItem shape, no active variant ─────────────────────────────────────

  it("returns item.image when activeVariantId is null", () => {
    const source = {
      activeVariantId: null,
      item: { image: "/items/base.png", variants: [{ id: "v1", image: "/items/red.png" }] },
    };
    expect(getItemDisplayImage(source)).toBe("/items/base.png");
  });

  it("returns item.image when activeVariantId is undefined", () => {
    const source = {
      activeVariantId: undefined,
      item: { image: "/items/base.png", variants: [{ id: "v1", image: "/items/red.png" }] },
    };
    expect(getItemDisplayImage(source)).toBe("/items/base.png");
  });

  it("returns item.image when activeVariantId is an empty string", () => {
    const source = {
      activeVariantId: "",
      item: { image: "/items/base.png", variants: [{ id: "v1", image: "/items/red.png" }] },
    };
    expect(getItemDisplayImage(source)).toBe("/items/base.png");
  });

  // ── userItem shape, active variant resolves ───────────────────────────────

  it("returns variant image when activeVariantId matches a variant", () => {
    const source = {
      activeVariantId: "v2",
      item: {
        image: "/items/base.png",
        variants: [
          { id: "v1", image: "/items/red.png" },
          { id: "v2", image: "/items/blue.png" },
        ],
      },
    };
    expect(getItemDisplayImage(source)).toBe("/items/blue.png");
  });

  it("returns item.image when activeVariantId does not match any variant", () => {
    const source = {
      activeVariantId: "v-missing",
      item: {
        image: "/items/base.png",
        variants: [{ id: "v1", image: "/items/red.png" }],
      },
    };
    expect(getItemDisplayImage(source)).toBe("/items/base.png");
  });

  // ── variants array absent ─────────────────────────────────────────────────

  it("returns item.image when variants array is absent and activeVariantId is set", () => {
    const source = {
      activeVariantId: "v1",
      item: { image: "/items/base.png" },
    };
    expect(getItemDisplayImage(source)).toBe("/items/base.png");
  });

  it("returns item.image when variants array is empty and activeVariantId is set", () => {
    const source = {
      activeVariantId: "v1",
      item: { image: "/items/base.png", variants: [] },
    };
    expect(getItemDisplayImage(source)).toBe("/items/base.png");
  });
});

describe("getItemDisplayName", () => {
  it("returns name from flat source", () => {
    expect(getItemDisplayName({ name: "Crimson Blade" })).toBe("Crimson Blade");
  });

  it("returns item.name when activeVariantId is null", () => {
    const source = {
      activeVariantId: null,
      item: { name: "Base Sword", variants: [{ id: "v1", name: "Red Sword" }] },
    };
    expect(getItemDisplayName(source)).toBe("Base Sword");
  });

  it("returns variant name when activeVariantId matches", () => {
    const source = {
      activeVariantId: "v1",
      item: { name: "Base Sword", variants: [{ id: "v1", name: "Red Sword" }] },
    };
    expect(getItemDisplayName(source)).toBe("Red Sword");
  });

  it("falls back to item.name when variant name is null", () => {
    const source = {
      activeVariantId: "v1",
      item: { name: "Base Sword", variants: [{ id: "v1", name: null }] },
    };
    expect(getItemDisplayName(source)).toBe("Base Sword");
  });

  it("falls back to item.name when activeVariantId does not match", () => {
    const source = {
      activeVariantId: "v-missing",
      item: { name: "Base Sword", variants: [{ id: "v1", name: "Red Sword" }] },
    };
    expect(getItemDisplayName(source)).toBe("Base Sword");
  });
});

describe("getItemDisplayDescription", () => {
  it("returns description from flat source", () => {
    expect(getItemDisplayDescription({ description: "A sharp blade." })).toBe("A sharp blade.");
  });

  it("returns item.description when no active variant", () => {
    const source = {
      activeVariantId: null,
      item: {
        description: "A sharp blade.",
        variants: [{ id: "v1", description: "A scarlet blade." }],
      },
    };
    expect(getItemDisplayDescription(source)).toBe("A sharp blade.");
  });

  it("returns variant description when activeVariantId matches and variant has description", () => {
    const source = {
      activeVariantId: "v1",
      item: {
        description: "A sharp blade.",
        variants: [{ id: "v1", description: "A scarlet blade." }],
      },
    };
    expect(getItemDisplayDescription(source)).toBe("A scarlet blade.");
  });

  it("falls back to item.description when variant description is null", () => {
    const source = {
      activeVariantId: "v1",
      item: {
        description: "A sharp blade.",
        variants: [{ id: "v1", description: null }],
      },
    };
    expect(getItemDisplayDescription(source)).toBe("A sharp blade.");
  });
});

describe("getItemDisplayBattleDescription", () => {
  it("returns battleDescription from flat source", () => {
    expect(
      getItemDisplayBattleDescription({ battleDescription: "%user swings a blade" }),
    ).toBe("%user swings a blade");
  });

  it("returns item.battleDescription when no active variant", () => {
    const source = {
      activeVariantId: null,
      item: {
        battleDescription: "%user swings a blade",
        variants: [{ id: "v1", battleDescription: "%user swings the Crimson Blade" }],
      },
    };
    expect(getItemDisplayBattleDescription(source)).toBe("%user swings a blade");
  });

  it("returns variant battleDescription when activeVariantId matches and variant has it", () => {
    const source = {
      activeVariantId: "v1",
      item: {
        battleDescription: "%user swings a blade",
        variants: [{ id: "v1", battleDescription: "%user swings the Crimson Blade" }],
      },
    };
    expect(getItemDisplayBattleDescription(source)).toBe("%user swings the Crimson Blade");
  });

  it("falls back to item.battleDescription when variant battleDescription is null", () => {
    const source = {
      activeVariantId: "v1",
      item: {
        battleDescription: "%user swings a blade",
        variants: [{ id: "v1", battleDescription: null }],
      },
    };
    expect(getItemDisplayBattleDescription(source)).toBe("%user swings a blade");
  });
});
