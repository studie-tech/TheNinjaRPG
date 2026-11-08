import { afterEach, describe, expect, it } from "bun:test";
import { BufferImageSource, Container, RenderLayer, Sprite, Texture } from "pixi.js";
import type { CritterHabitat } from "@/libs/critters";
import type { GameRenderer } from "@/libs/rendering/runtime";
import type { WorldBounds } from "@/libs/rendering/visibility";
import { type CritterSectorInput, createWorldCritters } from "@/libs/rendering/worldCritters";

const sheet = new Texture({ source: new BufferImageSource({ resource: new Uint8Array(1024 * 384 * 4), width: 1024, height: 384 }) });
const tile = { width: 40, height: 20 };
const cleanups: (() => void)[] = [];
afterEach(() => { while (cleanups.length) cleanups.pop()?.(); });

/** Real Pixi containers; only texture loading and lifetime ownership are stubbed. */
const fixture = (light = false) => {
  const requests: string[] = [];
  const game = {
    assets: { texture: async (url: string) => { requests.push(url); return sheet; } },
    isDisposed: () => false,
    signal: new AbortController().signal,
    own: (cleanup: () => void) => cleanups.push(cleanup),
  } as unknown as GameRenderer;
  const depth = new RenderLayer(), ground = new RenderLayer(), bounds = new WeakMap<Container, WorldBounds>();
  const critters = createWorldCritters(game, { depth, ground }, bounds, light);
  return { critters, depth, ground, bounds, requests };
};
const meadow = (habitat: CritterHabitat): CritterSectorInput => ({
  sector: 301,
  key: "301:v1",
  position: { x: 1000, y: 0 },
  tile,
  spots: () => Array.from({ length: 64 }, (_, index) => ({ x: (index % 8) * 40, y: Math.floor(index / 8) * 20, habitat })),
});
const frame = (now: number, reducedMotion = false) => ({ now, delta: 0.05, reducedMotion });
const view = { minX: 900, maxX: 1500, minY: -100, maxY: 300 };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const members = (depth: RenderLayer) => depth.renderLayerChildren.filter((child) => child.label.startsWith("critter:"));

describe("world critters", () => {
  it("joins the depth layer, shows groups in view and publishes their bounds", async () => {
    const { critters, depth, bounds, requests } = fixture();
    const window = new Map([[301, meadow("ground")]]);
    critters.update(frame(0), window, view, true);
    const roots = members(depth);
    expect(roots.length).toBeGreaterThan(0);
    expect(roots.length).toBeLessThanOrEqual(8);
    expect(roots.every((root) => !root.visible)).toBe(true);
    await settle();
    critters.update(frame(16), window, view, true);
    expect(roots.every((root) => root.visible)).toBe(true);
    for (const root of roots) {
      expect(root.zIndex).toBe(-root.y);
      expect(bounds.get(root)?.minY).toBe(root.y);
      expect(root.x).toBeGreaterThanOrEqual(1000 - 40);
    }
    // One move and one idle sheet per species in view, loaded once.
    expect(new Set(requests).size).toBe(requests.length);
  });

  it("pauses and hides groups out of view, and hides everything when wildlife is off", async () => {
    const { critters, depth } = fixture();
    const window = new Map([[301, meadow("snow")]]);
    critters.update(frame(0), window, view, true);
    await settle();
    critters.update(frame(16), window, view, true);
    const roots = members(depth);
    const positions = roots.map((root) => [root.x, root.y]);
    critters.update(frame(32), window, { minX: -9000, maxX: -8000, minY: -9000, maxY: -8000 }, true);
    expect(roots.every((root) => !root.visible)).toBe(true);
    for (let now = 48; now < 3000; now += 50)
      critters.update(frame(now), window, { minX: -9000, maxX: -8000, minY: -9000, maxY: -8000 }, true);
    critters.update(frame(3000, true), window, view, true);
    expect(roots.map((root) => [root.x, root.y])).toEqual(positions);
    critters.update(frame(3016), window, view, false);
    expect(roots.every((root) => !root.visible)).toBe(true);
  });

  it("replans a sector whose terrain changed, drops sectors that left the window and caps performance mode", async () => {
    const { critters, depth } = fixture(true);
    critters.update(frame(0), new Map([[301, meadow("ground")]]), view, true);
    expect(members(depth).length).toBeLessThanOrEqual(3);
    const first = members(depth);
    critters.update(frame(16), new Map([[301, { ...meadow("dessert"), key: "301:v2" }]]), view, true);
    expect(first.every((root) => root.destroyed)).toBe(true);
    expect(members(depth).every((root) => root.label.startsWith("critter:301"))).toBe(true);
    critters.update(frame(32), new Map(), view, true);
    expect(members(depth)).toEqual([]);
  });

  it("swaps a body texture only when its frame changes", async () => {
    const { critters, depth } = fixture();
    const window = new Map([[301, meadow("ground")]]);
    critters.update(frame(0, true), window, view, true);
    await settle();
    critters.update(frame(0, true), window, view, true);
    const body = (members(depth)[0] as Container).children[1] as Sprite;
    const texture = body.texture;
    critters.update(frame(10, true), window, view, true);
    expect(body.texture).toBe(texture);
  });
});
