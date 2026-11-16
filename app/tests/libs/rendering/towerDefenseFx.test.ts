import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { type Container, Sprite, Texture } from "pixi.js";
import { createTowerDefenseFx } from "@/libs/rendering/scenes/towerDefenseFx";

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        scale() {},
        createRadialGradient: () => ({ addColorStop() {} }),
        createLinearGradient: () => ({ addColorStop() {} }),
        fillRect() {},
        fillText() {},
        strokeText() {},
        measureText: () => ({ width: 24 }),
      }) as never,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("tower defense floating numbers", () => {
  it("shows every glyph of a critical hit with a three-digit exponent", () => {
    const fx = createTowerDefenseFx();
    fx.number(0, 0, 1.23e100, { element: "physical", crit: true });
    const shown = visibleGlyphs(fx.container);
    // "1.23e100!": the mark of a critical hit survives the longest damage text.
    expect(shown).toHaveLength(9);
    expect(shown.every((glyph) => glyph.texture !== Texture.EMPTY)).toBe(true);
    fx.dispose();
  });

  it("spells out a bounty and the reason a bonus paid", () => {
    const fx = createTowerDefenseFx();
    fx.ryo(0, 0, 340, "wave cleared");
    // "+340", " ryo" and "wave cleared" share one record.
    expect(visibleGlyphs(fx.container)).toHaveLength(4 + 4 + 12);
    fx.dispose();
  });
});

/** Glyphs of the floating numbers currently shown. */
const visibleGlyphs = (root: Container) => {
  const numberLayer = root.children.at(-1) as Container;
  return numberLayer.children
    .filter((record) => record.visible)
    .flatMap((record) => (record as Container).children)
    .filter((glyph): glyph is Sprite => glyph instanceof Sprite && glyph.visible);
};
