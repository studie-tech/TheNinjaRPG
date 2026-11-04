import { describe, expect, it, vi } from "bun:test";
import { BufferImageSource, Container, Sprite, Texture } from "pixi.js";
import { DEFAULT_VISUAL_EFFECTS } from "@/libs/visualEffects";
import * as fields from "@/libs/rendering/villageLightField";
import type { GameRenderer } from "@/libs/rendering/runtime";
import { shadowDirectionIndex } from "@/libs/rendering/bakedShadowAtlas";
import { createBakedVillageLighting, strongestShadowLights, type VillageLight } from "@/libs/rendering/bakedVillageLighting";

describe("baked village shadow selection", () => {
  it.each(Array.from({ length: 8 }, (_, direction) => direction))("samples compass direction %i without requesting another texture", direction => {
    const angle = direction * Math.PI / 4;
    expect(shadowDirectionIndex(Math.cos(angle), Math.sin(angle))).toBe(direction);
  });

  it("selects one complete silhouette between samples and wraps through east", () => {
    for (let direction = 0; direction < 8; direction++) {
      for (const offset of [-0.49, 0, 0.49]) {
        const angle = (direction + offset) * Math.PI / 4;
        expect(shadowDirectionIndex(Math.cos(angle), Math.sin(angle))).toBe(direction);
      }
    }
    expect(shadowDirectionIndex(1, -0.00001)).toBe(0);
  });

  it("gives two equal nearby lights half the shadow opacity each", () => {
    const lights = [{ x: -10, y: 0, height: 20, reach: 100 }, { x: 10, y: 0, height: 20, reach: 100 }];
    const result = strongestShadowLights(lights, 0, 0);
    expect(result).toHaveLength(2); expect(result[0]!.weight).toBe(0.5); expect(result[1]!.weight).toBe(0.5);
  });

  it("keeps the two strongest sources and changes their relative weights as the actor moves", () => {
    const lights = [{ x: -10, y: 0, height: 20, reach: 100 }, { x: 10, y: 0, height: 20, reach: 100 }, { x: 70, y: 0, height: 20, reach: 100 }];
    const result = strongestShadowLights(lights, -5, 0);
    expect(result.map(entry => entry.light)).toEqual([lights[0]!, lights[1]!]);
    expect(result[0]!.weight).toBeGreaterThan(result[1]!.weight);
    expect(result.reduce((sum, entry) => sum + entry.weight, 0)).toBeCloseTo(1);
  });

  it("fades weak light contributions and ignores invalid or out-of-range sources", () => {
    const lights: VillageLight[] = [{ x: 90, y: 0, height: 20, reach: 100 }, { x: 0, y: 0, height: 20, reach: 0 }, { x: NaN, y: 0, height: 20, reach: 100 }];
    const result = strongestShadowLights(lights, 0, 0);
    expect(result).toHaveLength(1); expect(result[0]!.weight).toBeGreaterThan(0); expect(result[0]!.weight).toBeLessThan(0.1);
    expect(strongestShadowLights(lights, -1000, 0)).toHaveLength(0);
  });
});

describe("baked character shadow transitions", () => {
  it("overlaps the sun and both lamps through dusk, honors separate switches, and retires departed lights", () => {
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const cleanups: (() => void)[] = [], world = new Container();
    const game = { renderer: { resolution: 1 }, signal: new AbortController().signal,
      visualEffects: { ...DEFAULT_VISUAL_EFFECTS }, own: (cleanup: () => void) => cleanups.push(cleanup), isDisposed: () => false } as unknown as GameRenderer;
    try {
      const lighting = createBakedVillageLighting(game, world);
      world.addChild(lighting.container);
      const lamps = [-10, 10].map(x => { const sprite = new Sprite(Texture.WHITE); sprite.anchor.set(.5); sprite.width = 20; sprite.height = 40; sprite.position.set(x, 0); world.addChild(sprite); return lighting.register(sprite, { id: `lamp:${x}`, kind: "structure", image: "fixture-lamp", size: 40, x, y: 0, groundY: 0, light: 1, shadowCaster: "column" }); });
      const character = new Container(); character.scale.set(32, -32); world.addChild(character);
      const body = new Sprite(Texture.WHITE); character.addChild(body);
      lighting.register(body, { id: "actor", kind: "avatar", image: "fixture-actor", size: 32, x: 0, y: 0, groundY: 0, shadowCaster: "character" }, [], character);
      const view = { minX: -100, maxX: 100, minY: -100, maxY: 100 };
      const sun = { x: 0, y: -.5, z: .866, day: .5 };
      lighting.update(sun, view);
      const ground = lighting.container.children.find(child => child.label === "baked-village-ground");
      expect(ground).toBeDefined();
      const shadows = ground?.children as Sprite[];
      expect(shadows).toHaveLength(3);
      expect(shadows.map(sprite => sprite.visible)).toEqual([true, true, true]);
      expect(shadows[0]?.alpha).toBeCloseTo(.15);
      expect(shadows[1]?.alpha).toBeCloseTo(.075);
      expect(shadows[2]?.alpha).toBeCloseTo(.075);
      game.visualEffects.localLights = false; lighting.update(sun, view);
      expect(shadows.map(sprite => sprite.visible)).toEqual([true, false, false]);
      game.visualEffects.localLights = true; game.visualEffects.sunlight = false; lighting.update(sun, view);
      expect(shadows.map(sprite => sprite.visible)).toEqual([false, true, true]);
      lamps[0]?.(); lighting.update(sun, view);
      expect(shadows[1]?.alpha).toBeCloseTo(.15);
      expect(shadows[2]?.visible).toBe(false);
      game.visualEffects.shadows = false; lighting.update(sun, view);
      expect(shadows.every(sprite => !sprite.visible)).toBe(true);
    } finally { world.destroy({ children: true }); for (const cleanup of cleanups) cleanup(); canvas.mockRestore(); }
  });
});

it("adds artwork-shaped local scenery shadows lazily and releases emissive fixtures without destroying shared art", () => {
  const canvas = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const world = new Container(), cleanups: (() => void)[] = [];
  const game = { renderer: { resolution: 1 }, signal: new AbortController().signal, visualEffects: { ...DEFAULT_VISUAL_EFFECTS },
    own: (fn: () => void) => cleanups.push(fn), isDisposed: () => false } as unknown as GameRenderer;
  try {
    const lighting = createBakedVillageLighting(game, world); world.addChild(lighting.container);
    const tree = new Sprite(Texture.WHITE); tree.anchor.set(.5); tree.width = 20; tree.height = 40; world.addChild(tree);
    const releaseTree = lighting.register(tree, { id: "tree", kind: "decoration", image: "fixture-tree", size: 40, x: 0, y: 0, groundY: 0, shadowCaster: "conifer" }, [], undefined, world);
    const lamp = new Sprite(Texture.WHITE); lamp.position.set(30, 0); lamp.width = 20; lamp.height = 40; world.addChild(lamp);
    const releaseLamp = lighting.register(lamp, { id: "lamp", kind: "structure", image: "fixture-lamp", size: 40, x: 30, y: 0, groundY: 0, light: 1, shadowCaster: "column" });
    const ground = lighting.container.children.find(child => child.label === "baked-village-local-ground")!;
    const view = { minX: -100, maxX: 100, minY: -100, maxY: 100 };
    lighting.update({ x: 0, y: 1, z: 1, day: 1 }, view); expect(ground.visible).toBe(false); expect(ground.isRenderGroup).toBe(true);
    lighting.update({ x: 0, y: 1, z: 1, day: 0 }, view);
    const local = ground.children.filter(child => child.label === "baked-scenery-local-shadow") as Sprite[];
    expect(local).toHaveLength(2); expect(local[0]!.texture).toBe(tree.texture); expect(local[0]!.visible).toBe(true);
    lighting.update({ x: 0, y: 1, z: 1, day: 0 }, { minX: 1000, maxX: 1100, minY: 1000, maxY: 1100 });
    expect(local.every(shadow => !shadow.visible)).toBe(true);
    lighting.update({ x: 0, y: 1, z: 1, day: 0 }, view);
    expect(ground.children.filter(child => child.label === "baked-scenery-local-shadow")).toEqual(local);
    expect(local[0]!.visible).toBe(true);
    releaseLamp(); lighting.update({ x: 0, y: 1, z: 1, day: 0 }, view);
    expect(local.every(shadow => !shadow.visible)).toBe(true);
    releaseTree(); expect(local.every(shadow => shadow.destroyed)).toBe(true); expect(Texture.WHITE.destroyed).toBe(false);
  } finally { world.destroy({ children: true }); for (const fn of cleanups) fn(); canvas.mockRestore(); }
});


it("retains a matching pool through cold artwork, replaces it at runtime, and clears an unknown layout", async () => {
  const canvas = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const texture = new Texture({ source: new BufferImageSource({ resource: new Uint8Array(4), width: 1, height: 1 }) });
  const field = { texture, bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 } };
  const preload = { resource: Promise.resolve(field), release: vi.fn() };
  const unknown = { resource: Promise.resolve(null), release: vi.fn() };
  const acquire = vi.spyOn(fields, "acquirePrebakedVillageLightField").mockReturnValue(preload);
  const runtime = { resource: Promise.resolve({ ...field, texture: Texture.WHITE }), release: vi.fn() };
  const runtimeAcquire = vi.spyOn(fields, "acquireVillageLightField").mockImplementation(lights => lights.length ? runtime : null);
  let timer: (() => void) | null = null;
  const schedule = vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => { timer = fn; return 1; }) as never);
  const clear = vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => {});
  const cleanups: (() => void)[] = [], world = new Container();
  const game = { renderer: { resolution: 1 }, signal: new AbortController().signal, visualEffects: { ...DEFAULT_VISUAL_EFFECTS },
    own: (fn: () => void) => cleanups.push(fn), isDisposed: () => false, invalidate: vi.fn() } as unknown as GameRenderer;
  try {
    const lighting = createBakedVillageLighting(game, world); world.addChild(lighting.container);
    const filter = lighting.container.filters![0]!;
    const update = () => lighting.update({ x: 0, y: 1, z: 1, day: 0 }, field.bounds);
    await lighting.preloadField("matching-layout", { x: 0, y: 0 });
    update(); expect(timer).not.toBeNull(); timer!();
    expect(filter.resources.uWarmMap).toBe(texture.source);
    expect(preload.release).not.toHaveBeenCalled();
    const lamp = new Sprite(Texture.WHITE); lamp.width = 20; lamp.height = 40; world.addChild(lamp);
    const releaseLamp = lighting.register(lamp, { id: "lamp", kind: "structure", image: "fixture-lamp", size: 40, x: 0, y: 0, groundY: 0, light: 1, shadowCaster: "column" });
    update(); timer!(); await Promise.resolve();
    expect(filter.resources.uWarmMap).toBe(Texture.WHITE.source);
    expect(preload.release).toHaveBeenCalledTimes(1);
    releaseLamp(); update(); timer!();
    expect(filter.resources.uWarmMap).toBe(Texture.EMPTY.source);
    await lighting.preloadField("another-matching-layout", { x: 0, y: 0 });
    expect(filter.resources.uWarmMap).toBe(texture.source);
    acquire.mockReturnValue(unknown);
    await lighting.preloadField("unknown-layout", { x: 0, y: 0 });
    expect(filter.resources.uWarmMap).toBe(Texture.EMPTY.source);
  } finally {
    for (const fn of cleanups) fn(); world.destroy({ children: true }); texture.destroy(true);
    canvas.mockRestore(); acquire.mockRestore(); runtimeAcquire.mockRestore(); schedule.mockRestore(); clear.mockRestore();
  }
});

it("ignores stale and disposed pool preloads", async () => {
  const canvas = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  let resolve!: (field: { texture: Texture; bounds: { minX: number; maxX: number; minY: number; maxY: number } }) => void;
  const pending = new Promise<Parameters<typeof resolve>[0]>(done => { resolve = done; });
  const stale = { resource: pending, release: vi.fn() };
  const unknown = { resource: Promise.resolve(null), release: vi.fn() };
  const acquire = vi.spyOn(fields, "acquirePrebakedVillageLightField").mockReturnValueOnce(stale).mockReturnValueOnce(unknown).mockReturnValueOnce(stale);
  const cleanups: (() => void)[] = [], world = new Container();
  const game = { renderer: { resolution: 1 }, signal: new AbortController().signal, visualEffects: { ...DEFAULT_VISUAL_EFFECTS },
    own: (fn: () => void) => cleanups.push(fn), isDisposed: () => false, invalidate: vi.fn() } as unknown as GameRenderer;
  try {
    const lighting = createBakedVillageLighting(game, world); world.addChild(lighting.container);
    const filter = lighting.container.filters![0]!;
    const first = lighting.preloadField("stale-layout", { x: 0, y: 0 });
    await lighting.preloadField("unknown-layout", { x: 0, y: 0 });
    resolve({ texture: Texture.WHITE, bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 } });
    await first;
    expect(filter.resources.uWarmMap).toBe(Texture.EMPTY.source);
    expect(stale.release).toHaveBeenCalledTimes(1);
    const last = lighting.preloadField("disposed-layout", { x: 0, y: 0 });
    for (const fn of cleanups.splice(0)) fn();
    (game.invalidate as ReturnType<typeof vi.fn>).mockClear();
    await last;
    expect(game.invalidate).not.toHaveBeenCalled();
    expect(stale.release).toHaveBeenCalledTimes(2);
  } finally { for (const fn of cleanups) fn(); world.destroy({ children: true }); canvas.mockRestore(); acquire.mockRestore(); }
});
