import published from "@/libs/rendering/bakedWorldSources.json";
import { describe, expect, it, vi } from "bun:test";
import { BufferImageSource, Container, Rectangle, Sprite, Texture } from "pixi.js";
import { DEFAULT_VISUAL_EFFECTS } from "@/libs/visualEffects";
import * as fields from "@/libs/rendering/villageLightField";
import type { GameRenderer } from "@/libs/rendering/runtime";
import { shadowDirectionIndex } from "@/libs/rendering/bakedShadowAtlas";
import {
  createBakedVillageLighting,
  strongestShadowLights,
  type VillageLight,
} from "@/libs/rendering/bakedVillageLighting";
import { deferred } from "../../setup/deferred";

describe("baked village shadow selection", () => {
  it.each(Array.from({ length: 8 }, (_, direction) => direction))(
    "samples compass direction %i without requesting another texture",
    (direction) => {
      const angle = (direction * Math.PI) / 4;
      expect(shadowDirectionIndex(Math.cos(angle), Math.sin(angle))).toBe(direction);
    },
  );

  it("selects one complete silhouette between samples and wraps through east", () => {
    for (let direction = 0; direction < 8; direction++) {
      for (const offset of [-0.49, 0, 0.49]) {
        const angle = ((direction + offset) * Math.PI) / 4;
        expect(shadowDirectionIndex(Math.cos(angle), Math.sin(angle))).toBe(direction);
      }
    }
    expect(shadowDirectionIndex(1, -0.00001)).toBe(0);
  });

  it("gives two equal nearby lights half the shadow opacity each", () => {
    const lights = [
      { x: -10, y: 0, height: 20, reach: 100 },
      { x: 10, y: 0, height: 20, reach: 100 },
    ];
    const result = strongestShadowLights(lights, 0, 0);
    expect(result).toHaveLength(2);
    expect(result[0]!.weight).toBe(0.5);
    expect(result[1]!.weight).toBe(0.5);
  });

  it("keeps the two strongest sources and changes their relative weights as the actor moves", () => {
    const lights = [
      { x: -10, y: 0, height: 20, reach: 100 },
      { x: 10, y: 0, height: 20, reach: 100 },
      { x: 70, y: 0, height: 20, reach: 100 },
    ];
    const result = strongestShadowLights(lights, -5, 0);
    expect(result.map((entry) => entry.light)).toEqual([lights[0]!, lights[1]!]);
    expect(result[0]!.weight).toBeGreaterThan(result[1]!.weight);
    expect(result.reduce((sum, entry) => sum + entry.weight, 0)).toBeCloseTo(1);
  });

  it("fades weak light contributions and ignores invalid or out-of-range sources", () => {
    const lights: VillageLight[] = [
      { x: 90, y: 0, height: 20, reach: 100 },
      { x: 0, y: 0, height: 20, reach: 0 },
      { x: NaN, y: 0, height: 20, reach: 100 },
    ];
    const result = strongestShadowLights(lights, 0, 0);
    expect(result).toHaveLength(1);
    expect(result[0]!.weight).toBeGreaterThan(0);
    expect(result[0]!.weight).toBeLessThan(0.1);
    expect(strongestShadowLights(lights, -1000, 0)).toHaveLength(0);
  });
});

it.each([false, true])(
  "preserves building contact until its matching bake settles (failure: %s)",
  async (failed) => {
    const cleanups: (() => void)[] = [],
      world = new Container();
    const page = new Texture({
      source: new BufferImageSource({
        resource: new Uint8Array(1024 * 1024 * 4),
        width: 1024,
        height: 1024,
      }),
    });
    const game = {
      renderer: { resolution: 1 },
      signal: new AbortController().signal,
      visualEffects: { ...DEFAULT_VISUAL_EFFECTS },
      own: (fn: () => void) => cleanups.push(fn),
      isDisposed: () => false,
      invalidate: vi.fn(),
      assets: {
        acquireTexture: () => ({
          resource: failed
            ? Promise.reject(new Error("atlas unavailable"))
            : Promise.resolve(page),
          release() {},
        }),
      },
    } as unknown as GameRenderer;
    const [image, frame, , material] = JSON.parse(Object.keys(published)[0]!);
    const original = new Texture({
      source: new BufferImageSource({
        resource: new Uint8Array(
          Math.ceil(frame.x + frame.width) * Math.ceil(frame.y + frame.height) * 4,
        ),
        width: Math.ceil(frame.x + frame.width),
        height: Math.ceil(frame.y + frame.height),
      }),
    });
    const view = new Texture({
      source: original.source,
      frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
    });
    const source = new Sprite(view);
    world.addChild(source);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const lighting = createBakedVillageLighting(game, world);
      const tree = {
        id: "tree",
        kind: "decoration",
        image: "custom-tree.png",
        size: 40,
        x: 0,
        y: 0,
        groundY: 0,
        shadowCaster: "canopy",
      } as const;
      expect(lighting.contactShadowReplacement(source, tree, world)).toBe("replace");
      expect(lighting.contactShadowReplacement(source, tree)).toBe("preserve");
      expect(
        lighting.contactShadowReplacement(source, { ...tree, small: true }, world),
      ).toBe("preserve");
      expect(
        lighting.contactShadowReplacement(source, { ...tree, unlit: true }, world),
      ).toBe("preserve");
      expect(
        lighting.contactShadowReplacement(
          source,
          { ...tree, shadowCaster: "building" },
          world,
        ),
      ).toBe("preserve");
      const building = {
        ...tree,
        image,
        worldMaterial: material,
        size: frame.height,
        preserveAspect: true,
        shadowCaster: "building",
      } as const;
      expect(lighting.contactShadowReplacement(undefined, building, world)).toBe(
        "preserve",
      );
      const release = lighting.register(source, building);
      expect(lighting.contactShadowReplacement(source, building)).toBe("pending");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(lighting.contactShadowReplacement(source, building)).toBe(
        failed ? "preserve" : "replace",
      );
      release();
      expect(lighting.contactShadowReplacement(source, building)).toBe("preserve");
      view.frame.x += 1;
      const unmatched = lighting.register(source, building);
      expect(lighting.contactShadowReplacement(source, building, world)).toBe(
        "preserve",
      );
      unmatched();
    } finally {
      for (const fn of cleanups) fn();
      world.destroy({ children: true });
      view.destroy(false);
      original.destroy(true);
      page.destroy(true);
      warning.mockRestore();
    }
  },
);

describe("baked character shadow transitions", () => {
  it("overlaps the sun and both lamps through dusk, honors separate switches, and retires departed lights", () => {
    const canvas = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(null);
    const cleanups: (() => void)[] = [],
      world = new Container();
    const game = {
      renderer: { resolution: 1 },
      signal: new AbortController().signal,
      visualEffects: { ...DEFAULT_VISUAL_EFFECTS },
      own: (cleanup: () => void) => cleanups.push(cleanup),
      isDisposed: () => false,
    } as unknown as GameRenderer;
    try {
      const lighting = createBakedVillageLighting(game, world);
      world.addChild(lighting.container);
      const lamps = [-10, 10].map((x) => {
        const sprite = new Sprite(Texture.WHITE);
        sprite.anchor.set(0.5);
        sprite.width = 20;
        sprite.height = 40;
        sprite.position.set(x, 0);
        world.addChild(sprite);
        return lighting.register(sprite, {
          id: `lamp:${x}`,
          kind: "structure",
          image: "fixture-lamp",
          size: 40,
          x,
          y: 0,
          groundY: 0,
          light: 1,
          shadowCaster: "column",
        });
      });
      const character = new Container();
      character.scale.set(32, -32);
      world.addChild(character);
      const body = new Sprite(Texture.WHITE);
      character.addChild(body);
      lighting.register(
        body,
        {
          id: "actor",
          kind: "avatar",
          image: "fixture-actor",
          size: 32,
          x: 0,
          y: 0,
          groundY: 0,
          shadowCaster: "character",
        },
        [],
        character,
      );
      const view = { minX: -100, maxX: 100, minY: -100, maxY: 100 };
      const sun = { x: 0, y: -0.5, z: 0.866, day: 0.5 };
      lighting.update(sun, view);
      const ground = lighting.container.children.find(
        (child) => child.label === "baked-village-ground",
      );
      expect(ground).toBeDefined();
      const shadows = ground?.children as Sprite[];
      expect(shadows).toHaveLength(3);
      expect(shadows.map((sprite) => sprite.visible)).toEqual([true, true, true]);
      expect(shadows[0]?.alpha).toBeCloseTo(0.15);
      expect(shadows[1]?.alpha).toBeCloseTo(0.075);
      expect(shadows[2]?.alpha).toBeCloseTo(0.075);
      game.visualEffects.localLights = false;
      lighting.update(sun, view);
      expect(shadows.map((sprite) => sprite.visible)).toEqual([true, false, false]);
      game.visualEffects.localLights = true;
      game.visualEffects.sunlight = false;
      lighting.update(sun, view);
      expect(shadows.map((sprite) => sprite.visible)).toEqual([false, true, true]);
      lamps[0]?.();
      lighting.update(sun, view);
      expect(shadows[1]?.alpha).toBeCloseTo(0.15);
      expect(shadows[2]?.visible).toBe(false);
      game.visualEffects.shadows = false;
      lighting.update(sun, view);
      expect(shadows.every((sprite) => !sprite.visible)).toBe(true);
    } finally {
      world.destroy({ children: true });
      for (const cleanup of cleanups) cleanup();
      canvas.mockRestore();
    }
  });
});

it("adds artwork-shaped local scenery shadows lazily and releases emissive fixtures without destroying shared art", () => {
  const canvas = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue(null);
  const world = new Container(),
    cleanups: (() => void)[] = [];
  const game = {
    renderer: { resolution: 1 },
    signal: new AbortController().signal,
    visualEffects: { ...DEFAULT_VISUAL_EFFECTS },
    own: (fn: () => void) => cleanups.push(fn),
    isDisposed: () => false,
  } as unknown as GameRenderer;
  try {
    const lighting = createBakedVillageLighting(game, world);
    world.addChild(lighting.container);
    const tree = new Sprite(Texture.WHITE);
    tree.anchor.set(0.5);
    tree.width = 20;
    tree.height = 40;
    world.addChild(tree);
    const releaseTree = lighting.register(
      tree,
      {
        id: "tree",
        kind: "decoration",
        image: "fixture-tree",
        size: 40,
        x: 0,
        y: 0,
        groundY: 0,
        shadowCaster: "conifer",
      },
      [],
      undefined,
      world,
    );
    const lamp = new Sprite(Texture.WHITE);
    lamp.position.set(30, 0);
    lamp.width = 20;
    lamp.height = 40;
    world.addChild(lamp);
    const releaseLamp = lighting.register(lamp, {
      id: "lamp",
      kind: "structure",
      image: "fixture-lamp",
      size: 40,
      x: 30,
      y: 0,
      groundY: 0,
      light: 1,
      shadowCaster: "column",
    });
    const ground = lighting.container.children.find(
      (child) => child.label === "baked-village-local-ground",
    )!;
    const view = { minX: -100, maxX: 100, minY: -100, maxY: 100 };
    lighting.update({ x: 0, y: 1, z: 1, day: 1 }, view);
    expect(ground.visible).toBe(false);
    expect(ground.isRenderGroup).toBe(true);
    lighting.update({ x: 0, y: 1, z: 1, day: 0 }, view);
    const local = ground.children.filter(
      (child) => child.label === "baked-scenery-local-shadow",
    ) as Sprite[];
    expect(local).toHaveLength(2);
    expect(local[0]!.texture).toBe(tree.texture);
    expect(local[0]!.visible).toBe(true);
    lighting.update(
      { x: 0, y: 1, z: 1, day: 0 },
      { minX: 1000, maxX: 1100, minY: 1000, maxY: 1100 },
    );
    expect(local.every((shadow) => !shadow.visible)).toBe(true);
    lighting.update({ x: 0, y: 1, z: 1, day: 0 }, view);
    expect(
      ground.children.filter((child) => child.label === "baked-scenery-local-shadow"),
    ).toEqual(local);
    expect(local[0]!.visible).toBe(true);
    releaseLamp();
    lighting.update({ x: 0, y: 1, z: 1, day: 0 }, view);
    expect(local.every((shadow) => !shadow.visible)).toBe(true);
    releaseTree();
    expect(local.every((shadow) => shadow.destroyed)).toBe(true);
    expect(Texture.WHITE.destroyed).toBe(false);
  } finally {
    world.destroy({ children: true });
    for (const fn of cleanups) fn();
    canvas.mockRestore();
  }
});

it("anchors both local fallback shadows to an asymmetric opaque foot", () => {
  const pixels = new Uint8Array(16 * 16 * 4);
  for (let y = 2; y < 9; y++)
    for (let x = 3; x < 13; x++) pixels[(y * 16 + x) * 4 + 3] = 255;
  pixels[(9 * 16 + 11) * 4 + 3] = 255;
  const texture = new Texture({
    source: new BufferImageSource({ resource: pixels, width: 16, height: 16 }),
  });
  const cleanups: (() => void)[] = [],
    world = new Container(),
    owner = new Container();
  world.addChild(owner);
  const game = {
    renderer: { resolution: 1 },
    signal: new AbortController().signal,
    visualEffects: { ...DEFAULT_VISUAL_EFFECTS },
    own: (fn: () => void) => cleanups.push(fn),
    isDisposed: () => false,
    invalidate: vi.fn(),
  } as unknown as GameRenderer;
  const canvas = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue(null);
  try {
    const lighting = createBakedVillageLighting(game, world);
    world.addChild(lighting.container);
    const tree = new Sprite(texture);
    tree.anchor.set(0.5);
    tree.scale.set(2, -2);
    owner.addChild(tree);
    lighting.register(
      tree,
      {
        id: "padded-tree",
        kind: "decoration",
        image: "padded-local-unknown.png",
        size: 32,
        x: 0,
        y: 0,
        groundY: -16,
        shadowCaster: "canopy",
      },
      [],
      undefined,
      owner,
    );
    for (const x of [-20, 20]) {
      const lamp = new Sprite(Texture.WHITE);
      lamp.anchor.set(0.5);
      lamp.width = 20;
      lamp.height = 40;
      lamp.scale.y *= -1;
      lamp.position.set(x, 20);
      world.addChild(lamp);
      lighting.register(lamp, {
        id: `lamp:${x}`,
        kind: "structure",
        image: "custom-lamp",
        size: 40,
        x,
        y: 20,
        groundY: 0,
        light: 1,
        shadowCaster: "column",
      });
    }
    lighting.update(
      { x: 0, y: 1, z: 1, day: 0 },
      { minX: -200, maxX: 200, minY: -200, maxY: 200 },
    );
    const shadows = lighting.container
      .getChildByLabel("baked-village-local-ground")!
      .children.filter(
        (child) => child.label === "baked-scenery-local-shadow",
      ) as Sprite[];
    expect(shadows).toHaveLength(2);
    const read = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    for (const shadow of shadows) {
      expect(shadow.visible).toBe(true);
      shadow.updateLocalTransform();
      const root = shadow.localTransform.apply({
        x: 11.5 - shadow.anchor.x * 16,
        y: 10 - shadow.anchor.y * 16,
      });
      expect(root.x).toBeCloseTo(7, 6);
      expect(root.y).toBeCloseTo(-4, 6);
    }
    lighting.invalidate();
    lighting.update(
      { x: 1, y: 0, z: 1, day: 0 },
      { minX: -200, maxX: 200, minY: -200, maxY: 200 },
    );
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
  } finally {
    world.destroy({ children: true });
    for (const fn of cleanups) fn();
    texture.destroy(true);
    canvas.mockRestore();
  }
});

it("retains a matching pool through cold artwork, replaces it at runtime, and clears an unknown layout", async () => {
  const canvas = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue(null);
  const texture = new Texture({
    source: new BufferImageSource({ resource: new Uint8Array(4), width: 1, height: 1 }),
  });
  const field = { texture, bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 } };
  const preload = { resource: Promise.resolve(field), release: vi.fn() };
  const unknown = { resource: Promise.resolve(null), release: vi.fn() };
  const acquire = vi
    .spyOn(fields, "acquirePrebakedVillageLightField")
    .mockReturnValue(preload);
  const runtime = {
    resource: Promise.resolve({ ...field, texture: Texture.WHITE }),
    release: vi.fn(),
  };
  const runtimeAcquire = vi
    .spyOn(fields, "acquireVillageLightField")
    .mockImplementation((lights) => (lights.length ? runtime : null));
  let timer: (() => void) | null = null;
  const schedule = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
    fn: () => void,
  ) => {
    timer = fn;
    return 1;
  }) as never);
  const clear = vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => {});
  const cleanups: (() => void)[] = [],
    world = new Container();
  const game = {
    renderer: { resolution: 1 },
    signal: new AbortController().signal,
    visualEffects: { ...DEFAULT_VISUAL_EFFECTS },
    own: (fn: () => void) => cleanups.push(fn),
    isDisposed: () => false,
    invalidate: vi.fn(),
  } as unknown as GameRenderer;
  try {
    const lighting = createBakedVillageLighting(game, world);
    world.addChild(lighting.container);
    const filter = lighting.container.filters![0]!;
    const update = () => lighting.update({ x: 0, y: 1, z: 1, day: 0 }, field.bounds);
    await lighting.preloadField("matching-layout", { x: 0, y: 0 });
    update();
    expect(timer).not.toBeNull();
    timer!();
    expect(filter.resources.uWarmMap).toBe(texture.source);
    expect(preload.release).not.toHaveBeenCalled();
    const lamp = new Sprite(Texture.WHITE);
    lamp.width = 20;
    lamp.height = 40;
    world.addChild(lamp);
    const releaseLamp = lighting.register(lamp, {
      id: "lamp",
      kind: "structure",
      image: "fixture-lamp",
      size: 40,
      x: 0,
      y: 0,
      groundY: 0,
      light: 1,
      shadowCaster: "column",
    });
    update();
    timer!();
    await Promise.resolve();
    expect(filter.resources.uWarmMap).toBe(Texture.WHITE.source);
    expect(preload.release).toHaveBeenCalledTimes(1);
    releaseLamp();
    update();
    timer!();
    expect(filter.resources.uWarmMap).toBe(Texture.EMPTY.source);
    await lighting.preloadField("another-matching-layout", { x: 0, y: 0 });
    expect(filter.resources.uWarmMap).toBe(texture.source);
    acquire.mockReturnValue(unknown);
    await lighting.preloadField("unknown-layout", { x: 0, y: 0 });
    expect(filter.resources.uWarmMap).toBe(Texture.EMPTY.source);
  } finally {
    for (const fn of cleanups) fn();
    world.destroy({ children: true });
    texture.destroy(true);
    canvas.mockRestore();
    acquire.mockRestore();
    runtimeAcquire.mockRestore();
    schedule.mockRestore();
    clear.mockRestore();
  }
});

it("ignores stale and disposed pool preloads", async () => {
  const canvas = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue(null);
  const { promise: pending, resolve } = deferred<{
    texture: Texture;
    bounds: { minX: number; maxX: number; minY: number; maxY: number };
  }>();
  const stale = { resource: pending, release: vi.fn() };
  const unknown = { resource: Promise.resolve(null), release: vi.fn() };
  const acquire = vi
    .spyOn(fields, "acquirePrebakedVillageLightField")
    .mockReturnValueOnce(stale)
    .mockReturnValueOnce(unknown)
    .mockReturnValueOnce(stale);
  const cleanups: (() => void)[] = [],
    world = new Container();
  const game = {
    renderer: { resolution: 1 },
    signal: new AbortController().signal,
    visualEffects: { ...DEFAULT_VISUAL_EFFECTS },
    own: (fn: () => void) => cleanups.push(fn),
    isDisposed: () => false,
    invalidate: vi.fn(),
  } as unknown as GameRenderer;
  try {
    const lighting = createBakedVillageLighting(game, world);
    world.addChild(lighting.container);
    const filter = lighting.container.filters![0]!;
    const first = lighting.preloadField("stale-layout", { x: 0, y: 0 });
    await lighting.preloadField("unknown-layout", { x: 0, y: 0 });
    resolve({
      texture: Texture.WHITE,
      bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
    });
    await first;
    expect(filter.resources.uWarmMap).toBe(Texture.EMPTY.source);
    expect(stale.release).toHaveBeenCalledTimes(1);
    const last = lighting.preloadField("disposed-layout", { x: 0, y: 0 });
    for (const fn of cleanups.splice(0)) fn();
    (game.invalidate as ReturnType<typeof vi.fn>).mockClear();
    await last;
    expect(game.invalidate).not.toHaveBeenCalled();
    expect(stale.release).toHaveBeenCalledTimes(2);
  } finally {
    for (const fn of cleanups) fn();
    world.destroy({ children: true });
    canvas.mockRestore();
    acquire.mockRestore();
  }
});
