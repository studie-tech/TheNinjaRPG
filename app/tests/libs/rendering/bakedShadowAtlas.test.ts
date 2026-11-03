import { describe, expect, it, mock, vi } from "bun:test";
import { readFileSync } from "node:fs";
import { BufferImageSource, Container, Rectangle, Sprite, Texture } from "pixi.js";
import { DEFAULT_VISUAL_EFFECTS } from "@/libs/visualEffects";
import { createBakedVillageLighting } from "@/libs/rendering/bakedVillageLighting";
import sources from "@/libs/rendering/bakedVillageSources.json";
import { hasBakedShadow, loadBakedShadowAtlas } from "@/libs/rendering/bakedShadowAtlas";
import type { GameRenderer } from "@/libs/rendering/runtime";
import type { WorldSpriteDescription } from "@/libs/rendering/sectorSprites";

const first = () => { const entry = Object.entries(sources)[0]; if (!entry) throw Error("Baked asset fixture missing"); return entry; };
const texture = (width: number, height: number) => new Texture({ source: new BufferImageSource({ resource: new Uint8Array(width * height * 4), width, height }) });

describe("prebaked village assets", () => {
  it("publishes complete eight-direction PNG atlases and matching warm overlays within WebGL 1 texture limits", () => {
    for (const source of Object.values(sources)) {
      const atlas = readFileSync(new URL(`../../../public${source.atlas}`, import.meta.url));
      const emission = readFileSync(new URL(`../../../public${source.emission}`, import.meta.url));
      for (const png of [atlas, emission]) { expect(png.subarray(1, 4).toString()).toBe("PNG"); expect(png.readUInt32BE(16)).toBeLessThanOrEqual(4096); expect(png.readUInt32BE(20)).toBeLessThanOrEqual(4096); }
      const width = atlas.readUInt32BE(16), height = atlas.readUInt32BE(20);
      expect(width % 4).toBe(0); expect(height % 2).toBe(0);
      expect(source.bytes).toBe((width * height + emission.readUInt32BE(16) * emission.readUInt32BE(20)) * 4);
      expect(source.emitters.length).toBeGreaterThan(0);
    }
  });

  it("invalidates a bake when artwork, material metadata, or the atlas frame changes", () => {
    const [key] = first(), [image, frame, orig, material] = JSON.parse(key);
    const source = texture(frame.x + frame.width, frame.y + frame.height);
    const view = new Texture({ source: source.source, frame: new Rectangle(frame.x, frame.y, frame.width, frame.height), orig: new Rectangle(orig.x, orig.y, orig.width, orig.height) });
    const description: WorldSpriteDescription = { id: "building", kind: "structure", image, worldMaterial: material, size: 1, x: 0, y: 0, groundY: 0 };
    try {
      expect(hasBakedShadow(view, description)).toBe(true);
      expect(hasBakedShadow(view, { ...description, image: `${image}-changed` })).toBe(false);
      expect(hasBakedShadow(view, { ...description, worldMaterial: { ...material, surfaces: `${material.surfaces}-changed` } })).toBe(false);
      view.frame.x += 1;
      expect(hasBakedShadow(view, description)).toBe(false);
    } finally { view.destroy(false); source.destroy(true); }
  });

  it("loads every direction together without a renderer or live shadow calculation and releases only its views", async () => {
    const [key, metadata] = first(), atlas = texture(16, 8), emission = texture(4, 4);
    const load = mock(async (path: string) => path === metadata.atlas ? atlas : emission);
    const game = { assets: { texture: load }, signal: new AbortController().signal, isDisposed: () => false } as unknown as GameRenderer;
    try {
      const result = await loadBakedShadowAtlas(game, key);
      expect(load.mock.calls.map(([path]) => path)).toEqual([metadata.atlas, metadata.emission]);
      expect(result.views).toHaveLength(8); expect(new Set(result.views.map(view => view.source)).size).toBe(1);
      expect(result.views.map(view => [view.frame.x, view.frame.y])).toEqual([[0, 0], [4, 0], [8, 0], [12, 0], [0, 4], [4, 4], [8, 4], [12, 4]]);
      result.destroy(); expect(result.views.every(view => view.destroyed)).toBe(true);
      expect(atlas.destroyed).toBe(false); expect(emission.destroyed).toBe(false);
    } finally { atlas.destroy(true); emission.destroy(true); }
  });

  it("rejects unsupported asset versions before loading textures", async () => {
    const load = mock(async () => Texture.WHITE);
    await expect(loadBakedShadowAtlas({ assets: { texture: load } } as unknown as GameRenderer, "unknown-version")).rejects.toThrow("No authored shadow bake");
    expect(load).not.toHaveBeenCalled();
  });

  it("installs cached building masks and warm spill after background loading without a render pass", async () => {
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const [key, metadata] = first(), [image, frame, orig, material] = JSON.parse(key);
    const original = texture(frame.x + frame.width, frame.y + frame.height);
    const view = new Texture({ source: original.source, frame: new Rectangle(frame.x, frame.y, frame.width, frame.height), orig: new Rectangle(orig.x, orig.y, orig.width, orig.height) });
    const atlas = texture(16, 8), emission = texture(4, 4), world = new Container(), cleanups: (() => void)[] = [];
    const game = { renderer: { resolution: 1 }, assets: { texture: async (path: string) => path === metadata.atlas ? atlas : emission },
      visualEffects: { ...DEFAULT_VISUAL_EFFECTS }, signal: new AbortController().signal, isDisposed: () => false,
      own: (cleanup: () => void) => cleanups.push(cleanup) } as unknown as GameRenderer;
    try {
      const lighting = createBakedVillageLighting(game, world), building = new Sprite(view); building.anchor.set(.5); world.addChild(lighting.container, building);
      const release = lighting.register(building, { id: "building", kind: "structure", image, worldMaterial: material, shadowCaster: "building", light: 1, size: orig.height, x: 0, y: 0, groundY: 0 });
      await new Promise(resolve => setTimeout(resolve, 0));
      lighting.update({ x: 0, y: -.5, z: .866, day: 0 }, { minX: -10000, maxX: 10000, minY: -10000, maxY: 10000 });
      expect(building.children).toHaveLength(1); expect(building.children[0]?.visible).toBe(true);
      const glow = lighting.container.children.find(child => child.label === "baked-village-glow"); expect(glow?.children).toHaveLength(1);
      release(); expect(building.children).toHaveLength(0); expect(glow?.children).toHaveLength(0);
    } finally { world.destroy({ children: true }); for (const cleanup of cleanups) cleanup(); view.destroy(false); original.destroy(true); atlas.destroy(true); emission.destroy(true); canvas.mockRestore(); }
  });
});
