import { describe, expect, it } from "bun:test";
import { Container, Sprite } from "pixi.js";

import { boundsOverlap, isObjectChainVisible, worldSpriteBounds } from "@/libs/rendering/visibility";

/** Builds a scene-like chain: root -> group -> sprite, returning all three. */
const buildChain = () => {
  const root = new Container();
  const group = new Container();
  const sprite = new Sprite();
  group.addChild(sprite);
  root.addChild(group);
  return { root, group, sprite };
};

describe("isObjectChainVisible", () => {
  it("accepts an object whose whole ancestor chain is visible", () => {
    const { sprite } = buildChain();
    expect(isObjectChainVisible(sprite)).toBe(true);
  });

  it("rejects an object that is itself hidden", () => {
    const { sprite } = buildChain();
    sprite.visible = false;
    expect(isObjectChainVisible(sprite)).toBe(false);
  });

  it("rejects a visible sprite inside a hidden group, as left by despawned users", () => {
    const { group, sprite } = buildChain();
    group.visible = false;
    expect(sprite.visible).toBe(true);
    expect(isObjectChainVisible(sprite)).toBe(false);
  });

  it("rejects any hidden ancestor higher up the chain", () => {
    const { root, sprite } = buildChain();
    root.visible = false;
    expect(isObjectChainVisible(sprite)).toBe(false);
  });
});

describe("scenery viewport bounds", () => {
  const artwork = { x: 10, y: 20, width: 100, height: 200, anchorX: 0.5, anchorY: 0.85, rotation: 0 };
  it("keeps the visible part of tall artwork whose ground contact is outside the viewport", () => {
    const bounds = worldSpriteBounds(artwork);
    expect(bounds.minX).toBe(-40);
    expect(bounds.maxX).toBe(60);
    expect(bounds.minY).toBeCloseTo(-10);
    expect(bounds.maxY).toBe(190);
    expect(boundsOverlap(bounds, { minX: 0, maxX: 20, minY: 170, maxY: 210 })).toBe(true);
    expect(boundsOverlap(bounds, { minX: 0, maxX: 20, minY: 200, maxY: 210 })).toBe(false);
  });
  it("includes rotated corners rather than culling by the unrotated footprint", () => {
    const bounds = worldSpriteBounds({ ...artwork, rotation: Math.PI / 2 });
    expect(bounds.minX).toBeCloseTo(-160);
    expect(bounds.maxX).toBeCloseTo(40);
    expect(bounds.minY).toBeCloseTo(-30);
    expect(bounds.maxY).toBeCloseTo(70);
    expect(boundsOverlap(bounds, { minX: -150, maxX: -140, minY: 0, maxY: 10 })).toBe(true);
  });
  it("retains sheared wall tops and bases at the viewport edge", () => {
    const bounds = worldSpriteBounds({ ...artwork, shearY: 0.5 });
    expect(bounds.minX).toBe(-40);
    expect(bounds.maxX).toBe(60);
    expect(bounds.minY).toBeCloseTo(-35);
    expect(bounds.maxY).toBeCloseTo(215);
    expect(boundsOverlap(bounds, { minX: 50, maxX: 65, minY: 210, maxY: 225 })).toBe(true);
  });
  it("retains edge pixels and wind padding while rejecting distant artwork", () => {
    const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(boundsOverlap(bounds, { minX: 10, minY: 0, maxX: 20, maxY: 10 })).toBe(true);
    expect(boundsOverlap(bounds, { minX: 12, minY: 0, maxX: 20, maxY: 10 }, 3)).toBe(true);
    expect(boundsOverlap(bounds, { minX: 14, minY: 0, maxX: 20, maxY: 10 }, 3)).toBe(false);
  });
});
