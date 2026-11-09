import { afterEach, describe, expect, it, vi } from "bun:test";
import {
  Assets,
  BufferImageSource,
  Container,
  Rectangle,
  RenderLayer,
  Sprite,
  Texture,
} from "pixi.js";
import { WORLD_DAY_BRIGHTNESS, WORLD_NIGHT_BRIGHTNESS } from "@/drizzle/constants";
import {
  createSceneAssets,
  NEAREST_TEXTURE_UV_BIAS,
  stabilizeNearestTexture,
  textureGroundContact,
  textureOpaqueFrame,
} from "@/libs/rendering/assets";
import * as maskedTextures from "@/libs/rendering/maskedTextures";
import * as shadows from "@/libs/rendering/primitives/shadow";
import { createWorldSprites } from "@/libs/rendering/primitives/sprites";
import type { GameRenderer } from "@/libs/rendering/runtime";
import type { WorldSpriteDescription } from "@/libs/rendering/sectorSprites";
import { WOODLAND_DECORATIONS } from "@/libs/rendering/worldArt";
import { WORLD_ASSET_SOURCES } from "@/libs/rendering/worldAssetSources";
import type { WorldShadows } from "@/libs/rendering/worldShadows";
import { sampleWorldWind } from "@/libs/rendering/worldWind";
import { textureImageUrl } from "@/utils/image";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
});

describe("world sprite atlas ownership", () => {
  it("stabilizes nearest UVs without changing frame identity, trim, source bytes or linear sampling", () => {
    const source = new BufferImageSource({
      resource: new Uint8Array(8 * 8 * 4),
      width: 8,
      height: 8,
      scaleMode: "nearest",
    });
    const texture = new Texture({
      source,
      frame: new Rectangle(0.5, 1, 3.5, 4),
      orig: new Rectangle(0, 0, 8, 8),
      trim: new Rectangle(2, 1, 3.5, 4),
    });
    const metadata = JSON.stringify([texture.frame, texture.orig, texture.trim]);
    const pixels = source.resource;
    stabilizeNearestTexture(texture);
    expect(texture.uvs.x0).toBe(0.5 / 8 + NEAREST_TEXTURE_UV_BIAS);
    expect(texture.uvs.y2).toBe(5 / 8 + NEAREST_TEXTURE_UV_BIAS);
    const uvs = { ...texture.uvs };
    stabilizeNearestTexture(texture);
    expect(texture.uvs).toEqual(uvs);
    expect(JSON.stringify([texture.frame, texture.orig, texture.trim])).toBe(metadata);
    expect(source.resource).toBe(pixels);
    texture.destroy(true);
    const linear = new Texture({
      source: new BufferImageSource({
        resource: new Uint8Array(4),
        width: 1,
        height: 1,
        scaleMode: "linear",
      }),
    });
    const linearUvs = { ...linear.uvs };
    stabilizeNearestTexture(linear);
    expect(linear.uvs).toEqual(linearUvs);
    linear.destroy(true);
  });
  it("applies stable sampling to fractional scenery atlas views while preserving their source/frame contract", async () => {
    const texture = new Texture({
      source: new BufferImageSource({
        resource: new Uint8Array(8 * 8 * 4),
        width: 8,
        height: 8,
        scaleMode: "nearest",
      }),
    });
    vi.spyOn(Assets, "load").mockImplementation(async () => texture);
    const art = await createWorldSprites(
      { own() {}, signal: new AbortController().signal } as unknown as GameRenderer,
      [
        {
          id: "seam-tree",
          kind: "tree",
          image: "nearest-seam-atlas.png",
          frame: { x: 0.5, y: 1, width: 3.5, height: 4 },
          x: 0,
          y: 0,
          groundY: 0,
          size: 16,
          nearest: true,
        },
      ],
    );
    cleanups.push(() => {
      art.dispose();
      texture.destroy(true);
    });
    const view = (art.entries[0]!.sprite as Sprite).texture;
    expect(view.source).toBe(texture.source);
    expect(view.frame).toMatchObject({ x: 0.5, y: 1, width: 3.5, height: 4 });
    expect(view.uvs.x0).toBe(0.5 / 8 + NEAREST_TEXTURE_UV_BIAS);
    expect(view.uvs.y2).toBe(5 / 8 + NEAREST_TEXTURE_UV_BIAS);
  });
  it("keeps clock-driven lamps independent of ambient/contact shading and updates a live preference at the same brightness", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.spyOn(Assets, "load").mockImplementation(async () => Texture.WHITE);
    const visualEffects = { dayNight: false, shadows: true, localLights: true };
    const game = {
      visualEffects,
      own() {},
      signal: new AbortController().signal,
    } as unknown as GameRenderer;
    const provider = {
      kind: "projected",
      register: () => Object.assign(() => {}, { ready: Promise.resolve() }),
      invalidate() {},
    } as never;
    const art = await createWorldSprites(
      game,
      [
        {
          id: "lamp",
          kind: "avatar",
          image: "lamp-test.png",
          size: 20,
          x: 0,
          y: 0,
          groundY: 0,
          shadow: 0.2,
          light: 0.6,
        },
      ],
      provider,
    );
    cleanups.push(art.dispose);
    const light = art.entries[0]!.light!.parent!,
      shadow = art.entries[0]!.shadow!.parent!;
    art.setLighting(WORLD_NIGHT_BRIGHTNESS);
    expect(light.visible).toBe(true);
    expect(light.alpha).toBeCloseTo(0.8);
    expect(shadow.alpha).toBe(1);
    visualEffects.dayNight = true;
    art.setLighting(WORLD_NIGHT_BRIGHTNESS);
    expect(light.alpha).toBeCloseTo(0.8);
    expect(shadow.alpha).toBeCloseTo(0.25);
    visualEffects.dayNight = false;
    art.setLighting(WORLD_NIGHT_BRIGHTNESS);
    expect(shadow.alpha).toBe(1);
  });

  it("retires one derived texture binding without releasing another scene's active lease", async () => {
    const resource = new Texture({
      source: new BufferImageSource({
        resource: new Uint8Array(4),
        width: 4096,
        height: 4096,
      }),
    });
    const load = vi.spyOn(Assets, "load").mockImplementation(async () => resource);
    const unload = vi.spyOn(Assets, "unload").mockResolvedValue(undefined);
    const first = createSceneAssets(),
      second = createSceneAssets(),
      pressure = createSceneAssets();
    const path = "/world-shadows/active-lease.png",
      other = "/world-shadows/idle-pressure.png";
    try {
      const a = first.acquireTexture(path, 0),
        b = second.acquireTexture(path, 0);
      await Promise.all([a.resource, b.resource]);
      a.release();
      first.dispose();
      await pressure.texture(other, 0);
      pressure.dispose();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unload.mock.calls.map(([url]) => url)).not.toContain(path);
      expect(await b.resource).toBe(resource);
      expect(
        load.mock.calls.filter(
          ([input]) => (input as unknown as { src: string }).src === path,
        ),
      ).toHaveLength(1);
    } finally {
      first.dispose();
      second.dispose();
      pressure.dispose();
      resource.destroy(true);
    }
  });
  it("removes daylight emitter batches and applies independent effect switches without animation", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.spyOn(Assets, "load").mockImplementation(async () => Texture.WHITE);
    const visualEffects = { shadows: true, localLights: true };
    const game = {
      visualEffects,
      own() {},
      signal: new AbortController().signal,
    } as unknown as GameRenderer;
    const art = await createWorldSprites(game, [
      {
        id: "emitter",
        kind: "avatar",
        image: "actor-emitter.png",
        size: 20,
        x: 0,
        y: 0,
        groundY: 0,
        shadow: 0.2,
        light: 0.6,
      },
    ]);
    cleanups.push(art.dispose);
    const light = art.entries[0]!.light!.parent!;
    const shadow = art.entries[0]!.shadow!.parent!;
    art.setLighting(WORLD_DAY_BRIGHTNESS);
    expect(light.visible).toBe(false);
    art.setLighting(WORLD_NIGHT_BRIGHTNESS);
    expect(light.visible).toBe(true);
    expect(light.alpha).toBeGreaterThan(0);
    visualEffects.localLights = false;
    visualEffects.shadows = false;
    art.setLighting(WORLD_NIGHT_BRIGHTNESS);
    expect(light.visible).toBe(false);
    expect(shadow.visible).toBe(false);
    visualEffects.localLights = true;
    art.setLighting(WORLD_NIGHT_BRIGHTNESS);
    expect(light.visible).toBe(true);
    expect(shadow.visible).toBe(false);
    art.setLighting(WORLD_DAY_BRIGHTNESS);
    expect(light.visible).toBe(false);
  });
  it("keeps boundary scenery visible while panning and removes scenery beyond the retained view", async () => {
    const game = {
      own() {},
      signal: new AbortController().signal,
    } as unknown as GameRenderer;
    vi.spyOn(Assets, "load").mockImplementation(async () => Texture.WHITE);
    const art = await createWorldSprites(game, [
      {
        id: "edge",
        kind: "decoration",
        image: "viewport-edge.png",
        size: 16,
        x: 62,
        y: 30,
        groundY: 0,
      },
      {
        id: "next",
        kind: "decoration",
        image: "viewport-next.png",
        size: 16,
        x: 194,
        y: 30,
        groundY: 0,
      },
    ]);
    cleanups.push(() => art.dispose());
    art.setViewport({ minX: 60, maxX: 64, minY: 16, maxY: 48 }, 0);
    expect(art.entries[0]!.sprite.renderable).toBe(true);
    expect(art.entries[1]!.sprite.renderable).toBe(false);
    art.setViewport({ minX: 64, maxX: 96, minY: 16, maxY: 48 }, 0);
    expect(art.entries[0]!.sprite.renderable).toBe(true);
    art.setViewport({ minX: 124, maxX: 128, minY: 16, maxY: 48 }, 0);
    expect(art.entries[1]!.sprite.renderable).toBe(true);
    art.setViewport({ minX: 384, maxX: 416, minY: 16, maxY: 48 }, 0);
    expect(art.entries.every((entry) => !entry.sprite.renderable)).toBe(true);
  });
  it("fades barely resolved ground cover smoothly, restores it on zoom and keeps offscreen props culled", async () => {
    const game = {
      own() {},
      signal: new AbortController().signal,
    } as unknown as GameRenderer;
    vi.spyOn(Assets, "load").mockImplementation(async () => Texture.WHITE);
    const art = await createWorldSprites(game, [
      {
        id: "ground:fade",
        kind: "decoration",
        image: "ground-fade.png",
        size: 8,
        x: 10,
        y: 10,
        groundY: 0,
        small: true,
        opacity: 0.8,
      },
    ]);
    cleanups.push(() => art.dispose());
    const layers = {
      ground: new RenderLayer(),
      world: new RenderLayer(),
      ui: new RenderLayer(),
    };
    art.attachLayers(layers);
    const sprite = art.entries[0]!.sprite;
    const owner = art.container;
    const frame = { now: 0, delta: 0, reducedMotion: false };
    art.animate(frame, 0.25);
    expect(sprite.alpha).toBe(0);
    expect(sprite.renderable).toBe(false);
    expect(sprite.parent?.parentRenderLayer).toBe(layers.ground);
    expect(sprite.parent?.isRenderGroup).toBe(true);
    expect(sprite.parent?.parent).toBe(owner);
    art.animate(frame, 0.625);
    expect(sprite.alpha).toBeCloseTo(0.4);
    expect(sprite.renderable).toBe(true);
    art.animate(frame, 1);
    expect(sprite.alpha).toBe(0.8);
    art.attachLayers(layers, 25);
    expect(sprite.parent?.parentRenderLayer).toBe(layers.ground);
    expect(sprite.parent?.zIndex).toBe(-25);
    art.container.position.set(40, -30);
    expect(sprite.getGlobalPosition()).toMatchObject({ x: 50, y: -20 });
    art.setViewport({ minX: 200, minY: 200, maxX: 300, maxY: 300 }, 0);
    art.animate(frame, 2);
    expect(sprite.alpha).toBe(0.8);
    expect(sprite.renderable).toBe(false);
    expect(sprite.parent?.parentRenderLayer).toBe(layers.ground);
    expect(sprite.parent?.parent).toBe(owner);
    expect(layers.ground.renderLayerChildren).toHaveLength(1);
    art.animate(frame, 1);
    expect(sprite.parent?.parentRenderLayer).toBe(layers.ground);
    expect(sprite.parent?.parent).toBe(owner);
  });
  it("samples fractional atlas cuts at integer texels and shares occupied bounds between views", () => {
    const pixels = new Uint8Array(16 * 16 * 4);
    for (let y = 2; y < 10; y++)
      for (let x = 3; x < 13; x++) pixels[(y * 16 + x) * 4 + 3] = 255;
    const original = new Texture({
      source: new BufferImageSource({ resource: pixels, width: 16, height: 16 }),
    });
    const first = new Texture({
      source: original.source,
      frame: new Rectangle(0.5, 0.5, 14, 14),
    });
    const second = new Texture({ source: original.source, frame: first.frame.clone() });
    const read = vi.fn(() => pixels);
    try {
      expect(textureOpaqueFrame(first, read)).toMatchObject({
        x: 3,
        y: 2,
        width: 10,
        height: 8,
      });
      expect(textureOpaqueFrame(second, read)).toBe(textureOpaqueFrame(first, read));
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      first.destroy(false);
      second.destroy(false);
      original.destroy(true);
    }
  });

  it("uses the opaque bottom row for foot contact while keeping faint fringes in culling bounds", () => {
    const pixels = new Uint8Array(16 * 16 * 4);
    for (let y = 2; y < 9; y++)
      for (let x = 3; x < 13; x++) pixels[(y * 16 + x) * 4 + 3] = 255;
    pixels[(9 * 16 + 11) * 4 + 3] = 255;
    pixels[14 * 16 * 4 + 3] = 64;
    const original = new Texture({
      source: new BufferImageSource({ resource: pixels, width: 16, height: 16 }),
    });
    try {
      expect(textureGroundContact(original)).toEqual({ x: 11.5, y: 10 });
      expect(textureOpaqueFrame(original)).toMatchObject({
        x: 0,
        y: 2,
        width: 13,
        height: 13,
      });
    } finally {
      original.destroy(true);
    }
  });

  it("sorts padded upright scenery by visible feet while preserving authored structure contacts", async () => {
    const pixels = new Uint8Array(16 * 16 * 4);
    for (let y = 2; y < 10; y++)
      for (let x = 3; x < 13; x++) pixels[(y * 16 + x) * 4 + 3] = 255;
    const original = new Texture({
      source: new BufferImageSource({ resource: pixels, width: 16, height: 16 }),
    });
    vi.spyOn(Assets, "load").mockImplementation(async () => original);
    const game = {
      own() {},
      signal: new AbortController().signal,
    } as unknown as GameRenderer;
    const descriptions = ["decoration", "garden", "structure"].map((kind, i) => ({
      id: kind,
      kind,
      image: "padded-scenery.png",
      size: 32,
      x: i * 40,
      y: 40,
      groundY: 24,
    }));
    const art = await createWorldSprites(game, descriptions);
    const layers = {
      ground: new RenderLayer(),
      world: new RenderLayer(),
      ui: new RenderLayer(),
    };
    art.attachLayers(layers, 100);
    const actor = new Container();
    actor.zIndex = -(30 + 100);
    layers.world.attach(actor);
    layers.world.sortRenderLayerChildren();
    try {
      expect(art.entries.map((e) => e.groundY)).toEqual([36, 36, 24]);
      expect(layers.world.renderLayerChildren.indexOf(actor)).toBeGreaterThan(
        layers.world.renderLayerChildren.indexOf(art.entries[0]!.sprite),
      );
      actor.zIndex = -(40 + 100);
      layers.world.sortRenderLayerChildren();
      expect(layers.world.renderLayerChildren.indexOf(actor)).toBeLessThan(
        layers.world.renderLayerChildren.indexOf(art.entries[0]!.sprite),
      );
      expect(art.entries[0]!.sprite.position).toMatchObject({ x: 0, y: 40 });
      art.attachLayers(layers, -50);
      expect(art.entries[0]!.sprite.zIndex).toBe(14);
    } finally {
      art.dispose();
      actor.destroy();
      original.destroy(true);
    }
  });

  it("retains authored character frames so material coordinates keep their published dimensions", async () => {
    const pixels = new Uint8Array(8 * 8 * 4);
    pixels[4 * (2 * 8 + 2) + 3] = 255;
    const texture = new Texture({
      source: new BufferImageSource({ resource: pixels, width: 8, height: 8 }),
    });
    vi.spyOn(Assets, "load").mockImplementation(async () => texture);
    const game = {
      own() {},
      signal: new AbortController().signal,
    } as unknown as GameRenderer;
    const art = await createWorldSprites(game, [
      {
        id: "authored-ai",
        kind: "aiAvatar",
        image: "/world-art/training-dummy.webp",
        size: 16,
        x: 10,
        y: 20,
        groundY: 0,
        shadowCaster: "character",
      },
    ]);
    cleanups.push(() => {
      art.dispose();
      texture.destroy(true);
    });
    expect((art.entries[0]!.sprite as Sprite).texture).toBe(texture);
    expect(art.entries[0]!.bounds).toMatchObject({
      minX: 2,
      maxX: 18,
      minY: 12,
      maxY: 28,
    });
  });
  it("grounds padded character cutouts without moving or rescaling their visible pixels, including mirrored poses", async () => {
    const pixels = new Uint8Array(8 * 8 * 4);
    for (let y = 1; y < 6; y++)
      for (let x = 1; x < 4; x++) pixels[(y * 8 + x) * 4 + 3] = 255;
    const texture = new Texture({
      source: new BufferImageSource({ resource: pixels, width: 8, height: 8 }),
    });
    vi.spyOn(Assets, "load").mockImplementation(async () => texture);
    const game = {
      own() {},
      signal: new AbortController().signal,
    } as unknown as GameRenderer;
    const art = await createWorldSprites(game, [
      {
        id: "padded-ai",
        kind: "aiAvatar",
        image: "padded-cutout.png",
        size: 16,
        x: 10,
        y: 20,
        groundY: 0,
        shadowCaster: "character",
      },
    ]);
    cleanups.push(() => {
      art.dispose();
      texture.destroy(true);
    });
    const entry = art.entries[0]!,
      sprite = entry.sprite as Sprite;
    expect(sprite.texture.frame).toMatchObject({ x: 1, y: 1, width: 3, height: 5 });
    expect(sprite.scale).toMatchObject({ x: 2, y: -2 });
    expect(entry.bounds).toMatchObject({ minX: 4, maxX: 10, minY: 16, maxY: 26 });
    for (const facing of [1, -1]) {
      sprite.scale.x = 2 * facing;
      sprite.updateLocalTransform();
      const pixel = sprite.localTransform.apply({
        x: 1.5 - sprite.anchor.x * 3,
        y: 2.5 - sprite.anchor.y * 5,
      });
      expect(pixel.x).toBeCloseTo(10 + facing * ((1 + 1.5 - 4) * 2));
      expect(pixel.y).toBeCloseTo(20 - (1 + 2.5 - 4) * 2);
      const foot = sprite.localTransform.apply({
        x: 3 * (0.5 - sprite.anchor.x),
        y: 5 * (1 - sprite.anchor.y),
      });
      expect(foot.x).toBeCloseTo(10 - 3 * facing);
      expect(foot.y).toBeCloseTo(16);
    }
    const view = sprite.texture;
    art.dispose();
    expect(view.destroyed).toBe(true);
    expect(texture.destroyed).toBe(false);
    expect(texture.source.destroyed).toBe(false);
  });
  it("resolves logical scenery keys to native Bunny textures for both asset lease APIs", async () => {
    const load = vi.spyOn(Assets, "load").mockImplementation(async () => Texture.WHITE);
    const assets = createSceneAssets();
    cleanups.push(() => assets.dispose());
    const source = WORLD_ASSET_SOURCES["/world-art/woodland-village.webp"]!;
    const lease = assets.acquireTexture("/world-art/woodland-village.webp", 128);
    try {
      await lease.resource;
      await assets.texture(source.material, 0, "nearest");
      expect(load).toHaveBeenCalledWith(
        expect.objectContaining({ src: textureImageUrl(source.image, 0) }),
      );
      expect(load).toHaveBeenCalledWith(
        expect.objectContaining({
          src: `${textureImageUrl(source.material, 0)}#tnr-nearest`,
        }),
      );
    } finally {
      lease.release();
    }
  });
  it("routes native sources and renditions through the image CDN", async () => {
    const load = vi.spyOn(Assets, "load").mockImplementation(async () => Texture.WHITE);
    const assets = createSceneAssets();
    cleanups.push(() => assets.dispose());
    const image = "https://ui0arpl8sm.ufs.sh/f/native-material-source-test.png";
    await assets.texture(image, 0, "nearest");
    expect(load).toHaveBeenCalledWith(
      expect.objectContaining({
        src: "https://uploadthing.b-cdn.net/f/native-material-source-test.png#tnr-nearest",
      }),
    );
    await assets.texture(image, 64, "nearest");
    expect(load).toHaveBeenCalledWith(
      expect.objectContaining({
        src: "https://uploadthing.b-cdn.net/f/native-material-source-test.png?width=64#tnr-nearest",
      }),
    );
  });
  it("retains wind transforms between subpixel steps and restores a still pose for reduced motion", async () => {
    const texture = new Texture({
      source: new BufferImageSource({
        resource: new Uint8Array(16 * 16 * 4),
        width: 16,
        height: 16,
      }),
    });
    vi.spyOn(Assets, "load").mockImplementation(async () => texture);
    const game = {
      own() {},
      signal: new AbortController().signal,
      renderer: { width: 800, height: 600 },
    } as unknown as GameRenderer;
    const art = await createWorldSprites(game, [
      {
        id: "pixel-wind",
        kind: "decoration",
        image: "wind-pixel-grid.png",
        size: 20,
        x: 8,
        y: 12,
        groundY: 12,
        anchorY: 1,
        wind: 0,
        nearest: true,
      },
    ]);
    cleanups.push(() => {
      art.dispose();
      texture.destroy(true);
    });
    const sprite = art.entries[0]!.sprite as Sprite;
    const pose = () =>
      [sprite.x, sprite.y, sprite.skew.x, sprite.scale.y].map((value) => value || 0);
    art.animate({ now: 0, delta: 0, reducedMotion: false }, 1);
    const initial = pose();
    art.animate({ now: 1, delta: 0.001, reducedMotion: false }, 1);
    expect(pose()).toEqual(initial);
    art.animate({ now: 400, delta: 0.399, reducedMotion: false }, 1);
    expect(sprite.skew.x).toBeCloseTo(
      Math.atan(
        sampleWorldWind({ now: 400, delta: 0, reducedMotion: false }, 1).large[0]! / 20,
      ),
    );
    expect([sprite.x, sprite.y]).toEqual([8, 12]);
    art.animate({ now: 400, delta: 0, reducedMotion: true }, 1);
    expect(pose()).toEqual(initial);
  });

  it.each([0.5, 1])(
    "keeps the source root row fixed at anchor %s while the crown follows the shared gust",
    async (anchorY) => {
      const texture = new Texture({
        source: new BufferImageSource({
          resource: new Uint8Array(16 * 16 * 4),
          width: 16,
          height: 16,
        }),
      });
      vi.spyOn(Assets, "load").mockImplementation(async () => texture);
      const game = {
        own() {},
        signal: new AbortController().signal,
      } as unknown as GameRenderer;
      const art = await createWorldSprites(game, [
        {
          id: "rooted-wind",
          kind: "decoration",
          image: `rooted-wind-${anchorY}.png`,
          size: 20,
          x: 8,
          y: 12,
          groundY: 12,
          anchorY,
          wind: 0,
          rotation: 0.2,
          shearY: 0.3,
        },
      ]);
      cleanups.push(() => {
        art.dispose();
        texture.destroy(true);
      });
      const sprite = art.entries[0]!.sprite as Sprite;
      const corners = () => {
        sprite.updateLocalTransform();
        return [0, 1].map((v) =>
          sprite.localTransform.apply({
            x: -sprite.anchor.x * 16,
            y: (v - anchorY) * 16,
          }),
        );
      };
      const base = corners();
      art.animate({ now: 0, delta: 0, reducedMotion: false }, 1, null, {
        large: new Float32Array([2, 0, 0, 0]),
        small: new Float32Array(4),
        key: "gust",
      });
      const bent = corners();
      expect(bent[1]!.x).toBeCloseTo(base[1]!.x, 6);
      expect(bent[1]!.y).toBeCloseTo(base[1]!.y, 6);
      expect(bent[0]!.x - base[0]!.x).toBeCloseTo(2, 6);
      expect(bent[0]!.y).toBeCloseTo(base[0]!.y, 6);
      art.animate({ now: 0, delta: 0, reducedMotion: true }, 1);
      expect(corners()).toEqual(base);
    },
  );

  it("keeps location pins outside lighting while retained sectors share painter order and ownership", async () => {
    const texture = new Texture({
      source: new BufferImageSource({
        resource: new Uint8Array(16 * 16 * 4),
        width: 16,
        height: 16,
      }),
    });
    vi.spyOn(Assets, "load").mockImplementation(async () => texture);
    vi.spyOn(maskedTextures, "acquireMaskedTexture").mockImplementation(() => ({
      resource: Promise.resolve(texture),
      release() {},
    }));
    const game = {
      own() {},
      signal: new AbortController().signal,
    } as unknown as GameRenderer;
    const base = {
      kind: "questStructure",
      image: "location-layer-art.png",
      size: 20,
      x: 8,
      y: 12,
      groundY: 12,
    };
    const recipes: WorldSpriteDescription[] = [
      { ...base, id: "location:near" },
      {
        ...base,
        id: "location-pin:near",
        mask: "location-layer-mask.png",
        tint: 0xffdf66,
      },
      { ...base, id: "action", unlit: true, tint: 0x9acddd },
    ];
    const near = await createWorldSprites(game, recipes);
    const far = await createWorldSprites(
      game,
      recipes.map((description) => ({ ...description, id: `${description.id}:far` })),
    );
    const world = new Container(),
      physical = new Container();
    const layers = { world: new RenderLayer(), ui: new RenderLayer() };
    physical.addChild(layers.world);
    world.addChild(near.container, far.container, physical, layers.ui);
    cleanups.push(() => {
      near.dispose();
      far.dispose();
      world.destroy({ children: true });
      texture.destroy(true);
    });
    far.container.position.set(50, 30);
    near.attachLayers(layers);
    far.attachLayers(layers, 30);
    expect(layers.world.renderLayerChildren.map((sprite) => sprite.label)).toEqual([
      "location:near:far",
      "location:near",
    ]);
    expect(layers.ui.renderLayerChildren.map((sprite) => sprite.label)).toEqual([
      "location-pin:near:far",
      "action:far",
      "location-pin:near",
      "action",
    ]);
    const pin = far.entries[1]!.sprite;
    expect(pin.parent).toBe(far.container);
    expect(pin.getGlobalPosition()).toMatchObject({ x: 58, y: 42 });
    expect(pin.parentRenderLayer?.parent).toBe(world);
    far.container.position.y = -30;
    far.attachLayers(layers, -30);
    expect(layers.world.renderLayerChildren.map((sprite) => sprite.label)).toEqual([
      "location:near",
      "location:near:far",
    ]);
    expect(layers.ui.renderLayerChildren.at(-2)).toBe(pin);
    near.setLighting(WORLD_NIGHT_BRIGHTNESS);
    expect(near.entries[0]!.sprite.tint).not.toBe(0xffffff);
    expect(near.entries[1]!.sprite.tint).toBe(0xffdf66);
    expect(near.entries[2]!.sprite.tint).toBe(0x9acddd);
    far.dispose();
    expect(pin.destroyed).toBe(true);
    expect(layers.world.renderLayerChildren.map((sprite) => sprite.label)).toEqual([
      "location:near",
    ]);
    expect(layers.ui.renderLayerChildren.map((sprite) => sprite.label)).toEqual([
      "location-pin:near",
      "action",
    ]);
  });
  it("keeps woodland cutouts in separate frames of one shared atlas", () => {
    expect(new Set(WOODLAND_DECORATIONS.map((asset) => asset.filepath)).size).toBe(1);
    for (const [index, asset] of WOODLAND_DECORATIONS.entries()) {
      const frame = asset.frame!;
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.y).toBeGreaterThanOrEqual(0);
      expect(frame.x + frame.width).toBeLessThanOrEqual(1254);
      expect(frame.y + frame.height).toBeLessThanOrEqual(1254);
      for (const other of WOODLAND_DECORATIONS.slice(index + 1)) {
        const next = other.frame!;
        expect(
          frame.x + frame.width <= next.x ||
            next.x + next.width <= frame.x ||
            frame.y + frame.height <= next.y ||
            next.y + next.height <= frame.y,
        ).toBe(true);
      }
    }
  });
  it("shares a decoded source while owning independent frame views", async () => {
    const source = new BufferImageSource({
      resource: new Uint8Array(32 * 16 * 4),
      width: 32,
      height: 16,
    });
    const original = new Texture({ source });
    vi.spyOn(Assets, "load").mockImplementation(async () => original);
    const owned: (() => void)[] = [];
    const game = {
      own: (cleanup: () => void) => owned.push(cleanup),
      signal: new AbortController().signal,
    } as unknown as GameRenderer;
    const base = {
      kind: "decoration",
      image: "atlas-ownership.png",
      size: 20,
      x: 0,
      y: 0,
      groundY: 0,
      shadow: 0.3,
    };
    const art = await createWorldSprites(game, [
      { ...base, id: "left", frame: { x: 0, y: 0, width: 16, height: 16 } },
      { ...base, id: "right", frame: { x: 16, y: 0, width: 16, height: 16 } },
    ]);
    const [left, right] = art.entries.map((entry) => (entry.sprite as Sprite).texture);
    expect(Assets.load).toHaveBeenCalledTimes(1);
    expect(left?.source).toBe(source);
    expect(right?.source).toBe(source);
    expect(left?.frame.x).toBe(0);
    expect(right?.frame.x).toBe(16);
    expect(original.frame.width).toBe(32);
    expect(art.container.children[0]?.label).toBe("scenery-shadows");
    const shadow = art.entries[0]?.shadow;
    expect(shadow?.texture).not.toBe(left);
    expect(shadow?.texture).toBe(art.entries[1]?.shadow?.texture);
    expect(shadow?.skew.x).toBe(0);
    expect(shadow?.height).toBeLessThanOrEqual(shadow!.width * 0.3);
    expect(shadow?.y).toBe(-10);
    const matrix = shadow?.localTransform.clone();
    art.animate({ now: 1000, delta: 1 / 60, reducedMotion: false }, 1);
    expect(shadow?.localTransform).toEqual(matrix);
    art.setViewport({ minX: 1000, minY: 1000, maxX: 2000, maxY: 2000 }, 0);
    expect(art.entries[0]?.sprite.renderable).toBe(false);
    expect(shadow?.renderable).toBe(false);
    art.dispose();
    expect(left?.destroyed).toBe(true);
    expect(right?.destroyed).toBe(true);
    expect(source.destroyed).toBe(false);
    for (const cleanup of owned) cleanup();
    expect(source.destroyed).toBe(false);
    original.destroy(true);
  });
  it.each(["baked", "physical"] as const)(
    "lets %s lighting own scenery footprints without an extra contact shadow",
    async (kind) => {
      const original = new Texture({
        source: new BufferImageSource({
          resource: new Uint8Array(16 * 16 * 4),
          width: 16,
          height: 16,
        }),
      });
      vi.spyOn(Assets, "load").mockImplementation(async () => original);
      const contact = vi
        .spyOn(HTMLCanvasElement.prototype, "getContext")
        .mockReturnValue(null);
      const release = Object.assign(() => {}, { ready: Promise.resolve() });
      const provider = {
        kind,
        register: vi.fn(() => release),
        contactShadowReplacement: (
          _source: Sprite | undefined,
          _description: WorldSpriteDescription,
          owner?: Container,
        ) => (owner ? "replace" : "preserve"),
      } as unknown as WorldShadows;
      const game = {
        own() {},
        signal: new AbortController().signal,
      } as unknown as GameRenderer;
      const art = await createWorldSprites(
        game,
        [
          {
            id: "tree",
            kind: "decoration",
            image: `contact-owner-${kind}.png`,
            size: 40,
            x: 0,
            y: 20,
            groundY: 0,
            shadow: 0.25,
            shadowCaster: "canopy",
          },
        ],
        provider,
        true,
      );
      try {
        expect(provider.register).toHaveBeenCalledTimes(1);
        expect(art.entries[0]?.shadow).toBeUndefined();
        expect(
          art.container.children.some((child) => child.label === "scenery-shadows"),
        ).toBe(false);
        expect(contact).not.toHaveBeenCalled();
      } finally {
        art.dispose();
        original.destroy(true);
        contact.mockRestore();
      }
    },
  );

  it.each(["dynamic", "motion", "unknown-building"] as const)(
    "keeps fallback contact grounding for %s artwork under baked lighting",
    async (scenario) => {
      const original = new Texture({
        source: new BufferImageSource({
          resource: new Uint8Array(16 * 16 * 4),
          width: 16,
          height: 16,
        }),
      });
      vi.spyOn(Assets, "load").mockImplementation(async () => original);
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
      const release = Object.assign(() => {}, { ready: Promise.resolve() });
      const register = vi.fn(
        (..._args: Parameters<WorldShadows["register"]>) => release,
      );
      const provider = {
        kind: "baked",
        register,
        contactShadowReplacement: (
          _source: Sprite | undefined,
          description: WorldSpriteDescription,
          owner?: Container,
        ) =>
          owner && description.shadowCaster !== "building" ? "replace" : "preserve",
      } as unknown as WorldShadows;
      const game = {
        own() {},
        signal: new AbortController().signal,
        isDisposed: () => false,
        assets: { texture: async () => original },
      } as unknown as GameRenderer;
      const description: WorldSpriteDescription = {
        id: scenario,
        kind: "decoration",
        image: `grounding-${scenario}.png`,
        size: 40,
        x: 0,
        y: 20,
        groundY: 0,
        shadow: 0.25,
        shadowCaster: scenario === "unknown-building" ? "building" : "canopy",
        ...(scenario === "motion"
          ? {
              motion: {
                size: 16,
                clip: {
                  images: ["grounding-motion.png"],
                  columns: 1,
                  rows: 1,
                  frameCount: 1,
                  frameDurationMs: 100,
                  loop: true,
                },
                frameOffsets: { horizontal: 0, north: 0, south: 0 },
              },
            }
          : {}),
      };
      const art = await createWorldSprites(
        game,
        [description],
        provider,
        scenario !== "dynamic",
      );
      try {
        expect(art.entries[0]?.shadow).toBeDefined();
        expect(register.mock.calls[0]?.[4]).toBe(
          scenario === "unknown-building" ? art.container : undefined,
        );
      } finally {
        art.dispose();
        original.destroy(true);
      }
    },
  );

  it.each(["replace", "preserve"] as const)(
    "keeps a pending building contact until lighting settles to %s",
    async (settled) => {
      const original = new Texture({
        source: new BufferImageSource({
          resource: new Uint8Array(16 * 16 * 4),
          width: 16,
          height: 16,
        }),
      });
      vi.spyOn(Assets, "load").mockImplementation(async () => original);
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
      let state: "pending" | "replace" | "preserve" = "pending";
      const provider = {
        kind: "baked",
        register: () => Object.assign(() => {}, { ready: Promise.resolve() }),
        contactShadowReplacement: () => state,
        invalidate: vi.fn(),
      } as unknown as WorldShadows;
      const game = {
        own() {},
        signal: new AbortController().signal,
      } as unknown as GameRenderer;
      const art = await createWorldSprites(
        game,
        [
          {
            id: "pending",
            kind: "structure",
            image: `pending-contact-${settled}.png`,
            size: 40,
            x: 0,
            y: 20,
            groundY: 0,
            shadow: 0.25,
            shadowCaster: "building",
          },
        ],
        provider,
        true,
      );
      try {
        const contact = art.entries[0]!.shadow!;
        expect(contact).toBeDefined();
        const layers = {
          ground: new RenderLayer(),
          world: new RenderLayer(),
          ui: new RenderLayer(),
        };
        art.attachLayers(layers);
        expect(layers.ground.renderLayerChildren).toHaveLength(1);
        const frame = { now: 0, delta: 0, reducedMotion: true };
        art.animate(frame, 1);
        expect(contact.destroyed).toBe(false);
        state = settled;
        art.animate(frame, 1);
        expect(contact.destroyed).toBe(settled === "replace");
        expect(!!art.entries[0]!.shadow).toBe(settled === "preserve");
        expect(layers.ground.renderLayerChildren).toHaveLength(
          settled === "replace" ? 0 : 1,
        );
        art.animate(frame, 1);
      } finally {
        art.dispose();
        original.destroy(true);
      }
    },
  );

  it("shares one contact mask across scopes and releases it after the final owner", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const texture = new Texture({
      source: new BufferImageSource({
        resource: new Uint8Array(16 * 16 * 4),
        width: 16,
        height: 16,
      }),
    });
    vi.spyOn(Assets, "load").mockImplementation(async () => texture);
    const game = {
      own() {},
      signal: new AbortController().signal,
    } as unknown as GameRenderer;
    const recipe = {
      id: "contact",
      kind: "structure",
      image: "contact-foot.png",
      size: 40,
      x: 30,
      y: 70,
      groundY: 0,
      anchorY: 0.88,
      shadow: 0.2,
      entrance: { x: 20, y: 63, width: 10 },
    };
    const [first, second] = await Promise.all([
      createWorldSprites(game, [recipe]),
      createWorldSprites(game, [recipe]),
    ]);
    const mask = first.entries[0]!.shadow!.texture;
    expect(second.entries[0]!.shadow!.texture).toBe(mask);
    expect(first.entries[0]!.shadow!.x).toBe(recipe.x);
    expect(first.entries[0]!.shadow!.y).toBe(recipe.entrance.y);
    first.setLighting(WORLD_NIGHT_BRIGHTNESS);
    const night = first.entries[0]!.shadow!.alpha;
    first.setLighting(WORLD_DAY_BRIGHTNESS);
    expect(first.entries[0]!.shadow!.alpha).toBeGreaterThan(night);
    first.dispose();
    expect(mask.destroyed).toBe(false);
    second.dispose();
    expect(mask.destroyed).toBe(true);
    texture.destroy(true);
  });
  it("does not acquire contact resources when its scope ends during image loading", async () => {
    const texture = new Texture({
      source: new BufferImageSource({
        resource: new Uint8Array(16 * 16 * 4),
        width: 16,
        height: 16,
      }),
    });
    let resolve!: (texture: Texture) => void;
    vi.spyOn(Assets, "load").mockImplementation(
      () =>
        new Promise<Texture>((done) => {
          resolve = done;
        }),
    );
    const acquire = vi.spyOn(shadows, "acquireSoftShadowTexture");
    const owned: (() => void)[] = [];
    const game = {
      own: (cleanup: () => void) => owned.push(cleanup),
      signal: new AbortController().signal,
    } as unknown as GameRenderer;
    const pending = createWorldSprites(game, [
      {
        id: "late",
        kind: "decoration",
        image: "late-contact.png",
        size: 20,
        x: 0,
        y: 0,
        groundY: 0,
        shadow: 0.2,
      },
    ]);
    for (let i = 0; i < 10 && !resolve; i++) await Promise.resolve();
    for (const cleanup of owned) cleanup();
    resolve(texture);
    await expect(pending).rejects.toThrow("Scenery cancelled");
    expect(acquire).not.toHaveBeenCalled();
    texture.destroy(true);
  });
  it("keeps movement frames attached to the feet, then restores idle without losing facing", async () => {
    const { art } = await motionFixture();
    const original = art.entries[0]!;
    const entry = { ...original, sprite: original.sprite as Sprite },
      idle = entry.sprite.texture;
    const feet = entry.sprite.y,
      contact = entry.shadow!.texture,
      contactWidth = entry.shadow!.width;
    expect(entry.shadow!.y).toBe(feet);
    entry.sprite.scale.x *= -1;
    art.animate({ now: 100, delta: 0.1, reducedMotion: false }, 1, "horizontal");
    expect(entry.sprite.texture.frame.x).toBe(16);
    expect(entry.shadow?.texture).toBe(contact);
    expect(entry.shadow?.width).toBe(contactWidth);
    expect(entry.sprite.y).toBe(feet);
    expect(entry.sprite.scale.x).toBeLessThan(0);
    expect(entry.shadow?.scale.x).toBeGreaterThan(0);
    art.animate({ now: 100, delta: 0, reducedMotion: false }, 1, "north");
    expect(entry.sprite.texture.frame.x).toBe(16);
    expect(entry.sprite.texture.frame.y).toBe(16);
    const moving = entry.sprite.texture;
    art.animate({ now: 110, delta: 0.01, reducedMotion: false }, 1, "north");
    expect(entry.sprite.texture).toBe(moving);
    art.animate({ now: 120, delta: 0.01, reducedMotion: false }, 1, null);
    expect(entry.sprite.texture).toBe(idle);
    expect(entry.shadow?.texture).toBe(contact);
    expect(entry.shadow?.y).toBe(feet);
    expect(entry.sprite.height).toBe(20);
    expect(entry.sprite.y).toBe(feet);
    art.animate({ now: 220, delta: 0.1, reducedMotion: true }, 1, "horizontal");
    expect(entry.sprite.texture).toBe(idle);
    const views = entry.motion!.views;
    art.dispose();
    expect(views.every((view) => view.destroyed)).toBe(true);
    expect(idle.source.destroyed).toBe(false);
  });
  it("retains the original player pose if optional movement artwork fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { art } = await motionFixture(true);
    expect(art.missing).toBe(0);
    expect(art.entries).toHaveLength(1);
    const idle = (art.entries[0]!.sprite as Sprite).texture;
    art.animate({ now: 100, delta: 0.1, reducedMotion: false }, 1, "horizontal");
    expect((art.entries[0]!.sprite as Sprite).texture).toBe(idle);
    expect(warning).toHaveBeenCalledWith(
      "Movement artwork unavailable",
      expect.any(Error),
    );
  });
});

/** A small sheet exercises our movement/idle ownership contract without a renderer or network. */
const motionFixture = async (fail = false) => {
  const texture = new Texture({
    source: new BufferImageSource({
      resource: new Uint8Array(64 * 48 * 4),
      width: 64,
      height: 48,
    }),
  });
  vi.spyOn(Assets, "load").mockImplementation(async () => texture);
  const owned: (() => void)[] = [];
  const game = {
    own: (cleanup: () => void) => owned.push(cleanup),
    signal: new AbortController().signal,
    isDisposed: () => false,
    assets: {
      texture: async () => {
        if (fail) throw new Error("Missing movement sheet");
        return texture;
      },
    },
  } as unknown as GameRenderer;
  cleanups.push(() => {
    for (const cleanup of owned) cleanup();
    texture.destroy(true);
  });
  const clip = {
    images: ["motion-sheet.png"],
    columns: 4,
    rows: 3,
    frameCount: 4,
    frameDurationMs: 100,
    loop: true,
  };
  const art = await createWorldSprites(game, [
    {
      id: "shinobi",
      kind: "character",
      image: `motion-idle-${fail}.png`,
      frame: { x: 0, y: 0, width: 16, height: 16 },
      size: 20,
      x: 0,
      y: 10,
      groundY: 0,
      anchorY: 1,
      shadow: 0.18,
      motion: { size: 16, clip, frameOffsets: { horizontal: 0, north: 4, south: 8 } },
    },
  ]);
  return { art };
};
