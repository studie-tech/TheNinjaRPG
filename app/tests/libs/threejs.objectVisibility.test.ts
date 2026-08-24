import { describe, expect, it } from "vitest";
import { Group, Sprite } from "three";

import { isObjectChainVisible } from "@/libs/threejs/util";

/** Builds a scene-like chain: root -> group -> sprite, returning all three. */
const buildChain = () => {
  const root = new Group();
  const group = new Group();
  const sprite = new Sprite();
  group.add(sprite);
  root.add(group);
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
    // drawUsers hides stale user groups at the group level only
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
