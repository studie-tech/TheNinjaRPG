import { afterEach, describe, expect, it, vi } from "bun:test";
import { Assets, BufferImageSource, Sprite, Container, RenderLayer, Texture } from "pixi.js";
import { createWorldSprites } from "@/libs/rendering/primitives/sprites";
import * as shadows from "@/libs/rendering/primitives/shadow";
import { WORLD_DAY_BRIGHTNESS, WORLD_NIGHT_BRIGHTNESS } from "@/drizzle/constants";
import type { GameRenderer } from "@/libs/rendering/runtime";
import { WOODLAND_DECORATIONS } from "@/libs/rendering/worldArt";
import * as maskedTextures from "@/libs/rendering/maskedTextures";
import type { WorldSpriteDescription } from "@/libs/rendering/sectorSprites";
import { sampleWorldWind } from "@/libs/rendering/worldWind";
import { createSceneAssets } from "@/libs/rendering/assets";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.restoreAllMocks(); });

describe("world sprite atlas ownership", () => {
  it("retains authored character frames so material coordinates keep their published dimensions", async () => {
    const pixels = new Uint8Array(8 * 8 * 4); pixels[4 * (2 * 8 + 2) + 3] = 255;
    const texture = new Texture({ source: new BufferImageSource({ resource: pixels, width: 8, height: 8 }) });
    vi.spyOn(Assets, "load").mockImplementation(async () => texture);
    const game = { own() {}, signal: new AbortController().signal } as unknown as GameRenderer;
    const art = await createWorldSprites(game, [{ id: "authored-ai", kind: "aiAvatar", image: "/world-art/training-dummy.webp", size: 16, x: 10, y: 20, groundY: 0, shadowCaster: "character" }]);
    cleanups.push(() => { art.dispose(); texture.destroy(true); });
    expect((art.entries[0]!.sprite as Sprite).texture).toBe(texture);
    expect(art.entries[0]!.bounds).toMatchObject({ minX: 2, maxX: 18, minY: 12, maxY: 28 });
  });
  it("grounds padded character cutouts without moving or rescaling their visible pixels, including mirrored poses", async () => {
    const pixels = new Uint8Array(8 * 8 * 4);
    for (let y = 1; y < 6; y++) for (let x = 1; x < 4; x++) pixels[(y * 8 + x) * 4 + 3] = 255;
    const texture = new Texture({ source: new BufferImageSource({ resource: pixels, width: 8, height: 8 }) });
    vi.spyOn(Assets, "load").mockImplementation(async () => texture);
    const game = { own() {}, signal: new AbortController().signal } as unknown as GameRenderer;
    const art = await createWorldSprites(game, [{ id: "padded-ai", kind: "aiAvatar", image: "padded-cutout.png", size: 16, x: 10, y: 20, groundY: 0, shadowCaster: "character" }]);
    cleanups.push(() => { art.dispose(); texture.destroy(true); });
    const entry = art.entries[0]!, sprite = entry.sprite as Sprite;
    expect(sprite.texture.frame).toMatchObject({ x: 1, y: 1, width: 3, height: 5 });
    expect(sprite.scale).toMatchObject({ x: 2, y: -2 });
    expect(entry.bounds).toMatchObject({ minX: 4, maxX: 10, minY: 16, maxY: 26 });
    for (const facing of [1, -1]) {
      sprite.scale.x = 2 * facing;
      sprite.updateLocalTransform();
      const pixel = sprite.localTransform.apply({ x: 1.5 - sprite.anchor.x * 3, y: 2.5 - sprite.anchor.y * 5 });
      expect(pixel.x).toBeCloseTo(10 + facing * ((1 + 1.5 - 4) * 2));
      expect(pixel.y).toBeCloseTo(20 - (1 + 2.5 - 4) * 2);
      const foot = sprite.localTransform.apply({ x: 3 * (0.5 - sprite.anchor.x), y: 5 * (1 - sprite.anchor.y) });
      expect(foot.x).toBeCloseTo(10 - 3 * facing);
      expect(foot.y).toBeCloseTo(16);
    }
    const view = sprite.texture;
    art.dispose();
    expect(view.destroyed).toBe(true);
    expect(texture.destroyed).toBe(false);
    expect(texture.source.destroyed).toBe(false);
  });
  it("preserves native source URLs while positive rendition widths use the image CDN", async () => {
    const load = vi.spyOn(Assets, "load").mockImplementation(async () => Texture.WHITE);
    const assets = createSceneAssets();
    cleanups.push(() => assets.dispose());
    const image = "https://ui0arpl8sm.ufs.sh/f/native-material-source-test.png";
    await assets.texture(image, 0, "nearest");
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ src: `${image}#tnr-nearest` }));
    await assets.texture(image, 64, "nearest");
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ src: "https://uploadthing.b-cdn.net/f/native-material-source-test.png?width=64#tnr-nearest" }));
  });
  it("retains wind transforms between subpixel steps and restores a still pose for reduced motion", async () => {
    const texture = new Texture({ source: new BufferImageSource({ resource: new Uint8Array(16 * 16 * 4), width: 16, height: 16 }) });
    vi.spyOn(Assets, "load").mockImplementation(async () => texture);
    const game = { own() {}, signal: new AbortController().signal, renderer: { width: 800, height: 600 } } as unknown as GameRenderer;
    const art = await createWorldSprites(game, [{
      id: "pixel-wind", kind: "decoration", image: "wind-pixel-grid.png", size: 20,
      x: 8, y: 12, groundY: 12, anchorY: 1, wind: 0, nearest: true,
    }]);
    cleanups.push(() => { art.dispose(); texture.destroy(true); });
    const sprite = art.entries[0]!.sprite as Sprite;
    const pose = () => [sprite.x, sprite.y, sprite.skew.x, sprite.scale.y].map((value) => value || 0);
    art.animate({ now: 0, delta: 0, reducedMotion: false }, 1);
    const initial = pose();
    art.animate({ now: 1, delta: 0.001, reducedMotion: false }, 1);
    expect(pose()).toEqual(initial);
    art.animate({ now: 400, delta: 0.399, reducedMotion: false }, 1);
    expect(sprite.skew.x).toBeCloseTo(Math.atan(sampleWorldWind({ now: 400, delta: 0, reducedMotion: false }, 1).large[0]! / 20));
    expect([sprite.x, sprite.y]).toEqual([8, 12]);
    art.animate({ now: 400, delta: 0, reducedMotion: true }, 1);
    expect(pose()).toEqual(initial);
  });

  it.each([0.5, 1])("keeps the source root row fixed at anchor %s while the crown follows the shared gust", async (anchorY) => {
    const texture = new Texture({ source: new BufferImageSource({ resource: new Uint8Array(16 * 16 * 4), width: 16, height: 16 }) });
    vi.spyOn(Assets, "load").mockImplementation(async () => texture);
    const game = { own() {}, signal: new AbortController().signal } as unknown as GameRenderer;
    const art = await createWorldSprites(game, [{
      id: "rooted-wind", kind: "decoration", image: `rooted-wind-${anchorY}.png`, size: 20,
      x: 8, y: 12, groundY: 12, anchorY, wind: 0, rotation: 0.2, shearY: 0.3,
    }]);
    cleanups.push(() => { art.dispose(); texture.destroy(true); });
    const sprite = art.entries[0]!.sprite as Sprite;
    const corners = () => {
      sprite.updateLocalTransform();
      return [0, 1].map((v) => sprite.localTransform.apply({ x: -sprite.anchor.x * 16, y: (v - anchorY) * 16 }));
    };
    const base = corners();
    art.animate({ now: 0, delta: 0, reducedMotion: false }, 1, null, { large: new Float32Array([2, 0, 0, 0]), small: new Float32Array(4), key: "gust" });
    const bent = corners();
    expect(bent[1]!.x).toBeCloseTo(base[1]!.x, 6);
    expect(bent[1]!.y).toBeCloseTo(base[1]!.y, 6);
    expect(bent[0]!.x - base[0]!.x).toBeCloseTo(2, 6);
    expect(bent[0]!.y).toBeCloseTo(base[0]!.y, 6);
    art.animate({ now: 0, delta: 0, reducedMotion: true }, 1);
    expect(corners()).toEqual(base);
  });

  it("keeps location pins outside lighting while retained sectors share painter order and ownership", async () => {
    const texture = new Texture({ source: new BufferImageSource({ resource: new Uint8Array(16 * 16 * 4), width: 16, height: 16 }) });
    vi.spyOn(Assets, "load").mockImplementation(async () => texture);
    vi.spyOn(maskedTextures, "acquireMaskedTexture").mockImplementation(() => ({ resource: Promise.resolve(texture), release() {} }));
    const game = { own() {}, signal: new AbortController().signal } as unknown as GameRenderer;
    const base = { kind: "questStructure", image: "location-layer-art.png", size: 20, x: 8, y: 12, groundY: 12 };
    const recipes: WorldSpriteDescription[] = [
      { ...base, id: "location:near" },
      { ...base, id: "location-pin:near", mask: "location-layer-mask.png", tint: 0xffdf66 },
      { ...base, id: "action", unlit: true, tint: 0x9acddd },
    ];
    const near = await createWorldSprites(game, recipes);
    const far = await createWorldSprites(game, recipes.map((description) => ({ ...description, id: `${description.id}:far` })));
    const world = new Container(), physical = new Container();
    const layers = { world: new RenderLayer(), ui: new RenderLayer() };
    physical.addChild(layers.world);
    world.addChild(near.container, far.container, physical, layers.ui);
    cleanups.push(() => { near.dispose(); far.dispose(); world.destroy({ children: true }); texture.destroy(true); });
    far.container.position.set(50, 30);
    near.attachLayers(layers);
    far.attachLayers(layers, 30);
    expect(layers.world.renderLayerChildren.map((sprite) => sprite.label)).toEqual(["location:near:far", "location:near"]);
    expect(layers.ui.renderLayerChildren.map((sprite) => sprite.label)).toEqual(["location-pin:near:far", "action:far", "location-pin:near", "action"]);
    const pin = far.entries[1]!.sprite;
    expect(pin.parent).toBe(far.container);
    expect(pin.getGlobalPosition()).toMatchObject({ x: 58, y: 42 });
    expect(pin.parentRenderLayer?.parent).toBe(world);
    far.container.position.y = -30;
    far.attachLayers(layers, -30);
    expect(layers.world.renderLayerChildren.map((sprite) => sprite.label)).toEqual(["location:near", "location:near:far"]);
    expect(layers.ui.renderLayerChildren.at(-2)).toBe(pin);
    near.setLighting(WORLD_NIGHT_BRIGHTNESS);
    expect(near.entries[0]!.sprite.tint).not.toBe(0xffffff);
    expect(near.entries[1]!.sprite.tint).toBe(0xffdf66);
    expect(near.entries[2]!.sprite.tint).toBe(0x9acddd);
    far.dispose();
    expect(pin.destroyed).toBe(true);
    expect(layers.world.renderLayerChildren.map((sprite) => sprite.label)).toEqual(["location:near"]);
    expect(layers.ui.renderLayerChildren.map((sprite) => sprite.label)).toEqual(["location-pin:near", "action"]);
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
        expect(frame.x + frame.width <= next.x || next.x + next.width <= frame.x ||
          frame.y + frame.height <= next.y || next.y + next.height <= frame.y).toBe(true);
      }
    }
  });
  it("shares a decoded source while owning independent frame views", async () => {
    const source = new BufferImageSource({ resource: new Uint8Array(32 * 16 * 4), width: 32, height: 16 });
    const original = new Texture({ source });
    vi.spyOn(Assets, "load").mockImplementation(async () => original);
    const owned: (() => void)[] = [];
    const game = { own: (cleanup: () => void) => owned.push(cleanup), signal: new AbortController().signal } as unknown as GameRenderer;
    const base = { kind: "decoration", image: "atlas-ownership.png", size: 20, x: 0, y: 0, groundY: 0, shadow: 0.3 };
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
    expect(shadow?.height).toBeLessThanOrEqual(shadow!.width * .3);
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
  it("shares one contact mask across scopes and releases it after the final owner", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const texture = new Texture({ source: new BufferImageSource({ resource: new Uint8Array(16*16*4), width: 16, height: 16 }) });
    vi.spyOn(Assets, "load").mockImplementation(async () => texture);
    const game = { own() {}, signal: new AbortController().signal } as unknown as GameRenderer;
    const recipe = { id: "contact", kind: "structure", image: "contact-foot.png", size: 40, x: 30, y: 70, groundY: 0, anchorY: .88, shadow: .2, entrance: { x: 20, y: 63, width: 10 } };
    const [first, second] = await Promise.all([createWorldSprites(game, [recipe]), createWorldSprites(game, [recipe])]);
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
    const texture = new Texture({ source: new BufferImageSource({ resource: new Uint8Array(16*16*4), width: 16, height: 16 }) });
    let resolve!: (texture: Texture) => void;
    vi.spyOn(Assets, "load").mockImplementation(() => new Promise<Texture>(done => { resolve = done; }));
    const acquire = vi.spyOn(shadows, "acquireSoftShadowTexture");
    const owned: (() => void)[] = [];
    const game = { own: (cleanup: () => void) => owned.push(cleanup), signal: new AbortController().signal } as unknown as GameRenderer;
    const pending = createWorldSprites(game, [{ id: "late", kind: "decoration", image: "late-contact.png", size: 20, x: 0, y: 0, groundY: 0, shadow: .2 }]);
    for (let i=0; i<10 && !resolve; i++) await Promise.resolve();
    for (const cleanup of owned) cleanup();
    resolve(texture);
    await expect(pending).rejects.toThrow("Scenery cancelled");
    expect(acquire).not.toHaveBeenCalled();
    texture.destroy(true);
  });
  it("keeps movement frames attached to the feet, then restores idle without losing facing", async () => {
    const { art } = await motionFixture();
    const original = art.entries[0]!;
    const entry = { ...original, sprite: original.sprite as Sprite }, idle = entry.sprite.texture;
    const feet = entry.sprite.y, contact = entry.shadow!.texture, contactWidth = entry.shadow!.width;
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
    expect(warning).toHaveBeenCalledWith("Movement artwork unavailable", expect.any(Error));
  });
});

/** A small sheet exercises our movement/idle ownership contract without a renderer or network. */
const motionFixture = async (fail = false) => {
  const texture = new Texture({ source: new BufferImageSource({ resource: new Uint8Array(64 * 48 * 4), width: 64, height: 48 }) });
  vi.spyOn(Assets, "load").mockImplementation(async () => texture);
  const owned: (() => void)[] = [];
  const game = { own: (cleanup: () => void) => owned.push(cleanup), signal: new AbortController().signal,
    isDisposed: () => false, assets: { texture: async () => { if (fail) throw new Error("Missing movement sheet"); return texture; } },
  } as unknown as GameRenderer;
  cleanups.push(() => { for (const cleanup of owned) cleanup(); texture.destroy(true); });
  const clip = { images: ["motion-sheet.png"], columns: 4, rows: 3, frameCount: 4, frameDurationMs: 100, loop: true };
  const art = await createWorldSprites(game, [{ id: "shinobi", kind: "character", image: `motion-idle-${fail}.png`,
    frame: { x: 0, y: 0, width: 16, height: 16 }, size: 20, x: 0, y: 10, groundY: 0, anchorY: 1, shadow: 0.18,
    motion: { size: 16, clip, frameOffsets: { horizontal: 0, north: 4, south: 8 } },
  }]);
  return { art };
};
