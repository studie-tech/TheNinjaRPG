import { DEFAULT_VISUAL_EFFECTS } from "@/libs/visualEffects";
import { describe, expect, it, vi } from "bun:test";
import { BufferImageSource, Container, Rectangle, Sprite, Texture } from "pixi.js";
import published from "@/libs/rendering/bakedWorldSources.json";
import { createProjectedWorldLighting } from "@/libs/rendering/projectedWorldLighting";
import type { GameRenderer } from "@/libs/rendering/runtime";
import { worldSunlight } from "@/libs/rendering/worldSunlight";

const viewport = { minX: 0, maxX: 100, minY: 0, maxY: 100 };
const fixture = () => {
  const cleanups: (() => void)[] = [];
  const game = {
    visualEffects: { ...DEFAULT_VISUAL_EFFECTS },
    renderer: { resolution: 1 },
    own: (cleanup: () => void) => cleanups.push(cleanup),
  } as unknown as GameRenderer;
  const world = new Container(),
    owner = new Container();
  const lighting = createProjectedWorldLighting(game, world);
  world.addChild(owner, lighting.container);
  const source = new Sprite(Texture.WHITE);
  source.anchor.set(0.5);
  source.position.set(20, 30);
  source.width = 20;
  source.height = 40;
  source.scale.y *= -1;
  owner.addChild(source);
  const register = () =>
    lighting.register(source, {
      id: "tree",
      kind: "decoration",
      image: "tree.png",
      x: 20,
      y: 30,
      size: 40,
      groundY: 10,
      shadowCaster: "canopy",
    });
  return {
    game,
    world,
    owner,
    source,
    lighting,
    register,
    dispose: () => {
      for (const cleanup of cleanups) cleanup();
      world.destroy({ children: true });
    },
  };
};

describe("projected world lighting", () => {
  it("changes authored compass masks without rebuilding stationary asset poses", async () => {
    const f = fixture();
    const original = new Texture({
      source: new BufferImageSource({
        resource: new Uint8Array(4),
        width: 627,
        height: 627,
      }),
    });
    const view = new Texture({
      source: original.source,
      frame: new Rectangle(22.5, 38, 124.5, 138),
    });
    const atlas = new Texture({
      source: new BufferImageSource({
        resource: new Uint8Array(16 * 8 * 4),
        width: 16,
        height: 8,
      }),
    });
    Object.assign(f.game, {
      assets: {
        acquireTexture: () => ({ resource: Promise.resolve(atlas), release: vi.fn() }),
      },
      signal: new AbortController().signal,
      isDisposed: () => false,
      invalidate: vi.fn(),
    });
    f.source.texture = view;
    const update = vi.spyOn(f.source, "updateLocalTransform");
    try {
      const release = f.lighting.register(f.source, {
        id: "authored-tree",
        kind: "decoration",
        image: "/world-art/woodland-village.webp",
        preserveAspect: true,
        x: 20,
        y: 30,
        size: 40,
        groundY: 10,
        shadowCaster: "canopy",
      });
      await release.ready;
      const wide = { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 };
      f.lighting.update({ x: 1, y: 0, z: 0.5, day: 1 }, wide);
      const ground = f.lighting.container.children[0]!;
      expect(ground.children).toHaveLength(1);
      const shadow = ground.children[0] as Sprite;
      shadow.updateLocalTransform();
      const anchored = shadow.localTransform.clone();
      for (const angle of [
        Math.PI / 8 - 0.01,
        Math.PI / 8 + 0.01,
        Math.PI / 4,
        Math.PI / 2,
      ]) {
        f.lighting.update(
          { x: Math.cos(angle), y: Math.sin(angle), z: 0.5, day: 1 },
          wide,
        );
        expect(ground.children).toHaveLength(1);
        expect(shadow.alpha).toBe(0.3);
        shadow.updateLocalTransform();
        expect(shadow.localTransform).toEqual(anchored);
      }

      update.mockClear();
      f.lighting.update({ x: 0, y: 1, z: 0.5, day: 1 }, wide);
      expect(update).not.toHaveBeenCalled();
      f.lighting.invalidate();
      f.lighting.update({ x: 0, y: 1, z: 0.5, day: 1 }, wide);
      expect(update).toHaveBeenCalled();
      release();
    } finally {
      update.mockRestore();
      f.dispose();
      view.destroy(false);
      original.destroy(true);
      atlas.destroy(true);
    }
  });
  it("keeps active atlas leases alive while evicting idle baked masks under pressure", async () => {
    const f = fixture();
    const atlasTexture = new Texture({
      source: new BufferImageSource({
        resource: new Uint8Array(16 * 8 * 4),
        width: 16,
        height: 8,
      }),
    });
    const releaseTexture = vi.fn();
    Object.assign(f.game, {
      assets: {
        acquireTexture: () => ({
          resource: Promise.resolve(atlasTexture),
          release: releaseTexture,
        }),
      },
      signal: new AbortController().signal,
      isDisposed: () => false,
    });
    const keys = Object.keys(published).slice(0, 8);
    const held = f.lighting.acquireAtlas(keys[0]!),
      shared = f.lighting.acquireAtlas(keys[0]!);
    const pressure = keys.slice(1).map((key) => f.lighting.acquireAtlas(key));
    try {
      const [first] = await Promise.all([
        held.resource,
        shared.resource,
        ...pressure.map((lease) => lease.resource),
      ]);
      held.release();
      for (const lease of pressure) lease.release();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(releaseTexture).toHaveBeenCalled();
      expect(first!.views.every((view) => !view.destroyed)).toBe(true);
      expect(await shared.resource).toBe(first);
      shared.release();
    } finally {
      held.release();
      shared.release();
      for (const lease of pressure) lease.release();
      f.dispose();
      atlasTexture.destroy(true);
    }
  });

  it.each(["canopy", "conifer", "column"] as const)(
    "keeps padded %s roots fixed for custom art and failed bakes in every sun direction",
    async (shadowCaster) => {
      for (const failedBake of [false, true]) {
        const key = Object.keys(published).find(
          (key) => JSON.parse(key)[1].width === 124.5,
        )!;
        const [image, authoredFrame, , material] = JSON.parse(key);
        const frame = failedBake
          ? authoredFrame
          : { x: 0, y: 0, width: 16, height: 16 };
        const width = failedBake ? 627 : 16,
          height = width;
        const pixels = new Uint8Array(width * height * 4);
        const footX = Math.floor(frame.x + frame.width * 0.65),
          footY = Math.floor(frame.y + frame.height) - 5;
        for (let y = Math.ceil(frame.y) + 2; y < footY; y++)
          for (let x = Math.ceil(frame.x) + 2; x < frame.x + frame.width - 2; x++)
            pixels[(y * width + x) * 4 + 3] = 255;
        pixels[(footY * width + footX) * 4 + 3] = 255;
        const original = new Texture({
          source: new BufferImageSource({ resource: pixels, width, height }),
        });
        const view = new Texture({
          source: original.source,
          frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
        });
        const f = fixture();
        f.source.texture = view;
        f.source.anchor.set(0.31, 0.67);
        f.source.scale.set(-2, -2);
        f.owner.position.set(12, -8);
        f.owner.rotation = 0.2;
        const load = vi.fn(() => ({
          resource: Promise.reject(new Error("unavailable atlas")),
          release() {},
        }));
        Object.assign(f.game, {
          assets: { acquireTexture: load },
          signal: new AbortController().signal,
          isDisposed: () => false,
          invalidate: vi.fn(),
        });
        const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
        const release = f.lighting.register(f.source, {
          id: "padded",
          kind: "decoration",
          image: failedBake ? image : "padded-unknown.png",
          worldMaterial: failedBake ? material : undefined,
          preserveAspect: true,
          size: frame.height * 2,
          x: f.source.x,
          y: f.source.y,
          groundY: f.source.y - frame.height,
          shadowCaster,
        });
        try {
          await release.ready;
          expect(load).toHaveBeenCalledTimes(failedBake ? 1 : 0);
          const contact = { x: footX + 0.5 - frame.x, y: footY + 1 - frame.y };
          f.source.updateLocalTransform();
          f.owner.updateLocalTransform();
          const foot = f.owner.localTransform.apply(
            f.source.localTransform.apply({
              x: contact.x - f.source.anchor.x * frame.width,
              y: contact.y - f.source.anchor.y * frame.height,
            }),
          );
          const read = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
          for (let direction = 0; direction < 8; direction++) {
            const angle = (direction * Math.PI) / 4;
            f.lighting.update(
              { x: Math.cos(angle), y: Math.sin(angle), z: 0.5, day: 1 },
              { minX: -2000, maxX: 2000, minY: -2000, maxY: 2000 },
            );
            const shadow = f.lighting.container.children[0]!.children[0] as Sprite;
            shadow.updateLocalTransform();
            const root = shadow.localTransform.apply({
              x: contact.x - shadow.anchor.x * frame.width,
              y: contact.y - shadow.anchor.y * frame.height,
            });
            expect(root.x).toBeCloseTo(foot.x, 6);
            expect(root.y).toBeCloseTo(foot.y, 6);
          }
          expect(read).not.toHaveBeenCalled();
          read.mockRestore();
        } finally {
          release();
          warning.mockRestore();
          f.dispose();
          view.destroy(false);
          original.destroy(true);
        }
      }
    },
  );

  it.each(["building", "wall"] as const)(
    "preserves the explicit %s entrance plane for fallback artwork",
    (shadowCaster) => {
      const f = fixture();
      try {
        f.source.anchor.set(0.37, 0.8);
        f.lighting.register(f.source, {
          id: "foundation",
          kind: "structure",
          image: "custom-foundation.png",
          size: 40,
          x: 20,
          y: 30,
          groundY: 10,
          entrance: { x: 20, y: 17, width: 10 },
          shadowCaster,
        });
        for (const x of [-1, 1]) {
          f.lighting.update(
            { x, y: 0, z: 0.5, day: 1 },
            { minX: -100, maxX: 100, minY: -100, maxY: 100 },
          );
          const shadow = f.lighting.container.children[0]!.children[0] as Sprite;
          shadow.updateLocalTransform();
          expect(shadow.localTransform.tx).toBe(20);
          expect(shadow.localTransform.ty).toBe(17);
        }
      } finally {
        f.dispose();
      }
    },
  );

  it("keeps unknown upright foliage from collapsing edge-on at horizontal light angles", () => {
    const f = fixture();
    try {
      f.register();
      f.lighting.update({ x: 1, y: 0, z: 0.5, day: 1 }, viewport);
      const shadow = f.lighting.container.children[0]!.children[0] as Sprite;
      shadow.updateLocalTransform();
      const m = shadow.localTransform;
      expect(Math.abs(m.a * m.d - m.b * m.c)).toBeGreaterThan(0.01);
    } finally {
      f.dispose();
    }
  });
  it("allocates sunlight silhouettes only when needed and releases offscreen GPU objects", () => {
    const f = fixture();
    try {
      const release = f.register();
      const ground = f.lighting.container.children[0]!;
      f.lighting.update({ ...worldSunlight(), day: 0 }, viewport);
      expect(ground.children).toHaveLength(0);
      f.lighting.update(worldSunlight(), viewport);
      const shadow = ground.children[0] as Sprite;
      f.lighting.update(worldSunlight(), { minX: 10, maxX: 110, minY: 0, maxY: 100 });
      expect(ground.children[0]).toBe(shadow);
      f.lighting.update(worldSunlight(), {
        minX: 1000,
        maxX: 1100,
        minY: 0,
        maxY: 100,
      });
      expect(ground.children).toHaveLength(0);
      expect(shadow.destroyed).toBe(true);
      expect(f.source.texture.destroyed).toBe(false);
      f.lighting.update(worldSunlight(), viewport);
      const replacement = ground.children[0] as Sprite;
      expect(replacement).not.toBe(shadow);
      release();
      expect(replacement.destroyed).toBe(true);
    } finally {
      f.dispose();
    }
  });
  it("retains projected pixels that enter the viewport from an offscreen caster", () => {
    const f = fixture();
    try {
      f.source.position.set(-110, 200);
      f.source.height = 200;
      f.lighting.register(f.source, {
        id: "long-tree",
        kind: "decoration",
        image: "tree.png",
        x: -110,
        y: 200,
        size: 200,
        groundY: 100,
        shadowCaster: "canopy",
      });
      f.lighting.update(
        { x: -1, y: 0, z: 0.5, day: 1 },
        { minX: 0, maxX: 100, minY: 80, maxY: 180 },
      );
      const ground = f.lighting.container.children[0]!;
      expect(ground.children).toHaveLength(1);
      expect((ground.children[0] as Sprite).x).toBe(-110);
    } finally {
      f.dispose();
    }
  });
  it("restores painter order when a previously offscreen silhouette re-enters", () => {
    const f = fixture();
    try {
      f.register();
      const far = new Sprite(Texture.WHITE);
      far.anchor.set(0.5);
      far.width = 20;
      far.height = 40;
      far.position.set(300, 30);
      f.owner.addChild(far);
      f.lighting.register(far, {
        id: "far-tree",
        kind: "decoration",
        image: "tree.png",
        x: 300,
        y: 30,
        size: 40,
        groundY: 10,
        shadowCaster: "canopy",
      });
      const ground = f.lighting.container.children[0]!;
      f.lighting.update(worldSunlight(), viewport);
      f.lighting.update(worldSunlight(), { minX: 250, maxX: 350, minY: 0, maxY: 100 });
      expect(ground.children).toHaveLength(1);
      expect(ground.children[0]!.x).toBe(300);
      f.lighting.update(worldSunlight(), { minX: 0, maxX: 350, minY: 0, maxY: 100 });
      expect(ground.children.map((shadow) => shadow.x)).toEqual([20, 300]);
    } finally {
      f.dispose();
    }
  });
  it("keeps night colors, warm emitters and sunlight independently configurable", () => {
    const f = fixture(),
      light = { ...worldSunlight(), day: 0 };
    try {
      f.register();
      const filter = f.lighting.container.filters![0]!,
        uniforms = filter.resources.night.uniforms;
      f.game.visualEffects.localLights = false;
      f.lighting.update(light, viewport);
      expect(uniforms.uNight).toBe(1);
      expect(uniforms.uLocalNight).toBe(0);
      f.game.visualEffects.dayNight = false;
      f.game.visualEffects.localLights = true;
      f.lighting.update(light, viewport);
      expect(uniforms.uNight).toBe(0);
      expect(uniforms.uLocalNight).toBe(1);
      expect(filter.enabled).toBe(true);
      f.game.visualEffects.localLights = false;
      f.lighting.update(light, viewport);
      expect(filter.enabled).toBe(false);
    } finally {
      f.dispose();
    }
  });
  it("retains a shared artwork silhouette while camera transforms change", async () => {
    const f = fixture();
    try {
      const release = f.register();
      await release.ready;
      f.lighting.update(worldSunlight(), viewport);
      const shadow = f.lighting.container.children[0]!.children[0] as Sprite;
      shadow.updateLocalTransform();
      const pose = shadow.localTransform.clone();
      expect(shadow.texture).toBe(f.source.texture);
      f.world.position.set(-100, 80);
      f.world.scale.set(2, -2);
      f.lighting.update(worldSunlight(), viewport);
      shadow.updateLocalTransform();
      expect(shadow.localTransform.equals(pose)).toBe(true);
      release();
      expect(shadow.destroyed).toBe(true);
      expect(f.source.texture.destroyed).toBe(false);
    } finally {
      f.dispose();
    }
  });
  it("tracks translated owners after invalidation and keeps shadows below scenery", () => {
    const f = fixture();
    try {
      f.register();
      f.lighting.container.addChild(new Container(), new Container());
      f.lighting.update(worldSunlight(), viewport);
      const ground = f.lighting.container.children[1]!;
      const shadow = ground.children[0] as Sprite;
      const x = shadow.x,
        y = shadow.y;
      f.owner.position.set(120, 70);
      f.lighting.invalidate();
      f.lighting.update(worldSunlight(), viewport);
      expect(shadow.x).toBeCloseTo(x + 120);
      expect(shadow.y).toBeCloseTo(y + 70);
      expect(f.lighting.container.children[1]).toBe(ground);
    } finally {
      f.dispose();
    }
  });
  it("honors shadow and lighting preferences without allocating physical targets", () => {
    const f = fixture();
    try {
      f.register();
      f.lighting.update(worldSunlight(), viewport);
      const ground = f.lighting.container.children[0]!;
      expect(ground.visible).toBe(true);
      f.game.visualEffects.shadows = false;
      f.lighting.update(worldSunlight(), viewport);
      expect(ground.visible).toBe(false);
      f.game.visualEffects.shadows = true;
      f.game.visualEffects.sunlight = false;
      f.lighting.update(worldSunlight(), viewport);
      expect(ground.visible).toBe(false);
      expect(f.lighting.container.filters?.[0]?.enabled).toBe(false);
    } finally {
      f.dispose();
    }
  });
  it("samples sun direction by minute while preserving dawn and dusk luminance", () => {
    const first = worldSunlight(new Date(451000), 60000),
      second = worldSunlight(new Date(479000), 60000);
    expect([second.x, second.y, second.z]).toEqual([first.x, first.y, first.z]);
    const before = worldSunlight(new Date(885000), 60000),
      after = worldSunlight(new Date(899000), 60000);
    expect([before.x, before.y, before.z]).toEqual([after.x, after.y, after.z]);
    expect(after.day).toBeLessThan(before.day);
  });
});
