import { afterEach, describe, expect, it, vi } from "bun:test";
import { Assets, BufferImageSource, Sprite, Texture, TextureSource } from "pixi.js";
import { spriteGroundContact, textureGroundContact } from "@/libs/rendering/assets";
import {
  acquireAnimationTexture,
  animationTextureUrl,
  clearUnusedAnimationTextures,
} from "@/libs/rendering/animationTextures";
import { createCharacterAnimation } from "@/libs/rendering/characterAnimation";
import type { CharacterAnimation } from "@/libs/spriteAnimations";
import { deferred } from "../setup/deferred";
const idle: CharacterAnimation = {
  id: "idle",
  name: "Idle",
  url: "https://uploadthing.b-cdn.net/f/idle.webp",
  smallUrl: null,
  columns: 2,
  rows: 2,
  frameCount: 4,
  fps: 4,
  facing: "left",
};
const atlas = () =>
  new Texture({ source: new TextureSource({ width: 256, height: 256 }) });
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
afterEach(async () => {
  clearUnusedAnimationTextures();
  await flush();
  vi.restoreAllMocks();
});
describe("Pixi AI atlases", () => {
  it("grounds padded frames at the static feet, retains jumps, mirrors, and restores placement", async () => {
    const pixels = new Uint8Array(256 * 256 * 4);
    // Rest foot at row 110; the next cell lifts it by ten pixels.
    for (const [left, bottom] of [
      [0, 110],
      [128, 100],
    ])
      for (let y = 20; y < bottom!; y++)
        for (let x = 40; x < 80; x++) pixels[(y * 256 + left! + x) * 4 + 3] = 255;
    const texture = new Texture({
      source: new BufferImageSource({ resource: pixels, width: 256, height: 256 }),
    });
    vi.spyOn(Assets, "load").mockImplementation(async () => texture);
    vi.spyOn(Assets, "unload").mockResolvedValue(undefined);
    const original = new Texture({
      source: new BufferImageSource({
        resource: new Uint8Array([0, 0, 0, 255]),
        width: 1,
        height: 1,
      }),
    });
    const sprite = new Sprite(original);
    sprite.anchor.set(0.5);
    sprite.position.set(7, 90);
    sprite.scale.set(100, -100);
    const player = createCharacterAnimation(sprite, 128, { idle });
    const render = (now: number, facing: "left" | "right" = "left", enabled = true) =>
      player.render({
        now,
        moving: false,
        enabled,
        facing,
        sourceFacing: "left",
        reducedMotion: false,
      });
    render(0);
    await flush();
    render(0);
    const worldFoot = () => {
      sprite.updateLocalTransform();
      const p = spriteGroundContact(sprite);
      return sprite.localTransform.apply({
        x: p.x - sprite.anchor.x * sprite.texture.orig.width,
        y: p.y - sprite.anchor.y * sprite.texture.orig.height,
      });
    };
    expect(worldFoot()).toMatchObject({ x: 7, y: 40 });
    expect(sprite.anchor.y).toBeCloseTo(110 / 128);
    render(250);
    expect(worldFoot()).toMatchObject({ x: 7, y: 40 });
    expect(textureGroundContact(sprite.texture).y).toBe(100); // Actual pixels still lift; the ground does not follow them.
    render(250, "right");
    expect(worldFoot()).toMatchObject({ x: 7, y: 40 });
    expect(sprite.scale.x).toBeLessThan(0);
    render(300, "right", false);
    expect(sprite.position).toMatchObject({ x: 7, y: 90 });
    expect(sprite.anchor.y).toBe(0.5);
    expect(sprite.texture).toBe(original);
    player.dispose();
    sprite.destroy();
    original.destroy(true);
    texture.destroy(true);
  });
  it("deduplicates pending loads and keeps leases alive until release", async () => {
    const texture = atlas();
    const load = vi.spyOn(Assets, "load").mockImplementation(async () => texture);
    const unload = vi.spyOn(Assets, "unload").mockResolvedValue(undefined);
    const a = acquireAnimationTexture(idle)!;
    const b = acquireAnimationTexture(idle)!;
    expect(await a.resource).toBe(texture);
    expect(await b.resource).toBe(texture);
    expect(load).toHaveBeenCalledTimes(1);
    a.release();
    clearUnusedAnimationTextures();
    expect(unload).not.toHaveBeenCalled();
    b.release();
    clearUnusedAnimationTextures();
    await flush();
    expect(unload).toHaveBeenCalledTimes(1);
  });
  it("keeps a shared source alive across compatible grid leases", async () => {
    const texture = new Texture({
      source: new TextureSource({ width: 1024, height: 1024 }),
    });
    vi.spyOn(Assets, "load").mockImplementation(async () => texture);
    const unload = vi.spyOn(Assets, "unload").mockResolvedValue(undefined);
    const a = acquireAnimationTexture(
      { ...idle, columns: 8, rows: 8, frameCount: 64, fps: 8 },
      128,
    )!;
    const b = acquireAnimationTexture(
      { ...idle, columns: 4, rows: 4, frameCount: 16, fps: 8 },
      256,
    )!;
    await Promise.all([a.resource, b.resource]);
    a.release();
    clearUnusedAnimationTextures();
    await flush();
    expect(unload).not.toHaveBeenCalled();
    b.release();
    clearUnusedAnimationTextures();
    await flush();
    expect(unload).toHaveBeenCalledTimes(1);
  });
  it("reserves pending and active images within the 32 MiB budget", async () => {
    const { promise: pending, resolve } = deferred<Texture>();
    vi.spyOn(Assets, "load").mockImplementation(() => pending);
    vi.spyOn(Assets, "unload").mockResolvedValue(undefined);
    const big = { ...idle, columns: 8, rows: 8, frameCount: 64, fps: 8 };
    const leases = Array.from({ length: 8 }, (_, i) =>
      acquireAnimationTexture(
        { ...big, id: String(i), url: `https://example.com/${i}.webp` },
        128,
      ),
    );
    expect(leases.every(Boolean)).toBe(true);
    expect(
      acquireAnimationTexture(
        { ...big, url: "https://example.com/overflow.webp" },
        128,
      ),
    ).toBeUndefined();
    for (const lease of leases) lease?.release();
    clearUnusedAnimationTextures();
    expect(
      acquireAnimationTexture(
        { ...big, url: "https://example.com/still-pending.webp" },
        128,
      ),
    ).toBeUndefined();
    resolve(new Texture({ source: new TextureSource({ width: 1024, height: 1024 }) }));
    await Promise.all(leases.map((lease) => lease!.resource));
    await flush();
  });
  it("retains failed requests and rejects malformed grid dimensions", async () => {
    vi.spyOn(Assets, "load").mockImplementation(
      async () =>
        new Texture({ source: new TextureSource({ width: 255, height: 256 }) }),
    );
    vi.spyOn(Assets, "unload").mockResolvedValue(undefined);
    const a = acquireAnimationTexture(idle)!;
    await expect(a.resource).rejects.toThrow("dimensions");
    const b = acquireAnimationTexture(idle)!;
    expect(a.resource).toBe(b.resource);
    a.release();
    b.release();
  });
  it("uses prepared sizes directly and bounds long existing clips", () => {
    const prepared = {
      ...idle,
      url: "https://utfs.io/f/large",
      smallUrl: "https://uploadthing.b-cdn.net/f/small",
    };
    expect(animationTextureUrl(prepared, 128)).toBe(
      "https://uploadthing.b-cdn.net/f/small",
    );
    expect(animationTextureUrl(prepared, 256)).toBe(
      "https://uploadthing.b-cdn.net/f/large",
    );
    const long = { ...idle, columns: 9, rows: 18, frameCount: 160, fps: 12.5 };
    expect(acquireAnimationTexture(long, 256)).toBeUndefined();
    expect(acquireAnimationTexture(long, 128, 1024)).toBeUndefined();
  });
  it("uses a stable bounded WebP rendition", () => {
    const url = new URL(animationTextureUrl(idle, 128));
    expect(url.searchParams.get("width")).toBe("256");
    expect(url.searchParams.get("height")).toBe("256");
    expect(url.searchParams.get("format")).toBe("webp");
  });
  it("plays movement before queued actions, preserves facing, and restores static art when disabled", async () => {
    vi.spyOn(Assets, "load").mockImplementation(async () => atlas());
    vi.spyOn(Assets, "unload").mockResolvedValue(undefined);
    const original = new Texture({
      source: new TextureSource({ width: 128, height: 128 }),
    });
    const sprite = new Sprite(original);
    const move = { ...idle, id: "move", url: "https://example.com/move.webp" };
    const attack = { ...idle, id: "attack", url: "https://example.com/attack.webp" };
    const player = createCharacterAnimation(sprite, 100, {
      idle,
      move,
      "jutsu:fire": attack,
    });
    const render = (
      now: number,
      moving = false,
      event?: { id: string; actionKey: string },
      enabled = true,
    ) =>
      player.render({
        now,
        moving,
        event,
        enabled,
        facing: "right",
        sourceFacing: "left",
        reducedMotion: false,
      });
    render(0);
    await flush();
    render(0);
    const first = sprite.texture;
    render(250);
    expect(sprite.texture).not.toBe(first);
    expect(sprite.scale.x).toBeLessThan(0);
    render(350, false, { id: "unassigned", actionKey: "jutsu:missing" });
    const event = { id: "cast", actionKey: "jutsu:fire" };
    render(500, true, event);
    await flush();
    render(1500, true, event);
    render(2000, false, event);
    await flush();
    render(2000, false, event);
    const attackFirst = sprite.texture;
    render(2250, false, event);
    expect(sprite.texture).not.toBe(attackFirst);
    render(3100, false, event);
    await flush();
    render(3100, false, event);
    expect(sprite.texture).not.toBe(attackFirst);
    render(4000, false, event, false);
    expect(sprite.texture).toBe(original);
    player.dispose();
    sprite.destroy();
  });
  it("keeps the displayed clip on screen until the next sheet is ready", async () => {
    const attack = { ...idle, id: "attack", url: "https://example.com/attack.webp" };
    const idleAtlas = atlas(),
      attackAtlas = atlas(),
      attackLoad = deferred<Texture>();
    vi.spyOn(Assets, "load").mockImplementation(((asset: { src: string }) =>
      asset.src.includes("attack")
        ? attackLoad.promise
        : Promise.resolve(idleAtlas)) as never);
    vi.spyOn(Assets, "unload").mockResolvedValue(undefined);
    const original = new Texture({
      source: new TextureSource({ width: 128, height: 128 }),
    });
    const sprite = new Sprite(original);
    const player = createCharacterAnimation(sprite, 100, {
      idle,
      "jutsu:fire": attack,
    });
    const frame = async (now: number, event?: { id: string; actionKey: string }) => {
      player.render({
        now,
        moving: false,
        event,
        enabled: true,
        facing: "left",
        sourceFacing: "left",
        reducedMotion: false,
      });
      const drawn = sprite.texture;
      await flush();
      return drawn;
    };
    await frame(0);
    expect((await frame(0)).source).toBe(idleAtlas.source);
    // Idle keeps looping for as long as the action's sheet is downloading.
    const cast = { id: "cast", actionKey: "jutsu:fire" };
    const waiting = await frame(100, cast),
      stillWaiting = await frame(350, cast);
    expect(waiting.source).toBe(idleAtlas.source);
    expect(stillWaiting.source).toBe(idleAtlas.source);
    expect(stillWaiting).not.toBe(waiting);
    attackLoad.resolve(attackAtlas);
    await flush();
    // The action clock starts on its first visible frame, so a slow download costs no frames.
    const attackFirst = await frame(600, cast);
    expect(attackFirst.source).toBe(attackAtlas.source);
    const attackLast = await frame(1400, cast);
    expect(attackLast.source).toBe(attackAtlas.source);
    expect(attackLast).not.toBe(attackFirst);
    // A cached sheet still settles after the frame that requests it; the action holds its pose.
    expect(await frame(1600, cast)).toBe(attackLast);
    expect((await frame(1616, cast)).source).toBe(idleAtlas.source);
    const again = { id: "again", actionKey: "jutsu:fire" };
    for (const now of [2000, 2016, 2032])
      expect(await frame(now, again)).not.toBe(original);
    expect(sprite.texture.source).toBe(attackAtlas.source);
    player.dispose();
    sprite.destroy();
  });
  it("shows the static image once a sheet fails or cannot fit", async () => {
    const broken = { ...idle, id: "broken", url: "https://example.com/broken.webp" };
    const huge = {
      ...idle,
      id: "huge",
      columns: 8,
      rows: 8,
      frameCount: 64,
      url: "https://example.com/huge.webp",
    };
    vi.spyOn(Assets, "load").mockImplementation(((asset: { src: string }) =>
      asset.src.includes("broken")
        ? Promise.reject(new Error("offline"))
        : Promise.resolve(atlas())) as never);
    vi.spyOn(Assets, "unload").mockResolvedValue(undefined);
    const original = new Texture({
      source: new TextureSource({ width: 128, height: 128 }),
    });
    const sprite = new Sprite(original);
    const player = createCharacterAnimation(
      sprite,
      100,
      { idle, "jutsu:broken": broken, "jutsu:huge": huge },
      { maxTextureSize: 512 },
    );
    const render = (now: number, event?: { id: string; actionKey: string }) =>
      player.render({
        now,
        moving: false,
        event,
        enabled: true,
        facing: "left",
        sourceFacing: "left",
        reducedMotion: false,
      });
    render(0);
    await flush();
    render(0);
    expect(sprite.texture).not.toBe(original);
    render(100, { id: "one", actionKey: "jutsu:broken" });
    expect(sprite.texture).not.toBe(original);
    await flush();
    render(116, { id: "one", actionKey: "jutsu:broken" });
    expect(sprite.texture).toBe(original);
    player.dispose();
    const oversized = createCharacterAnimation(
      sprite,
      100,
      { idle, "jutsu:huge": huge },
      { maxTextureSize: 512 },
    );
    const renderOversized = (now: number, event?: { id: string; actionKey: string }) =>
      oversized.render({
        now,
        moving: false,
        event,
        enabled: true,
        facing: "left",
        sourceFacing: "left",
        reducedMotion: false,
      });
    renderOversized(0);
    await flush();
    renderOversized(0);
    expect(sprite.texture).not.toBe(original);
    renderOversized(100, { id: "two", actionKey: "jutsu:huge" });
    expect(sprite.texture).toBe(original);
    oversized.dispose();
    sprite.destroy();
  });
  it("plays a requested clip once it has loaded, then returns to idle", async () => {
    vi.spyOn(Assets, "load").mockImplementation(async () => atlas());
    vi.spyOn(Assets, "unload").mockResolvedValue(undefined);
    const original = new Texture({
      source: new TextureSource({ width: 128, height: 128 }),
    });
    const sprite = new Sprite(original);
    const transform = {
      ...idle,
      id: "transform",
      url: "https://example.com/transform.webp",
    };
    const player = createCharacterAnimation(sprite, 100, { idle, transform });
    const render = (now: number) =>
      player.render({
        now,
        moving: false,
        enabled: true,
        facing: "left",
        sourceFacing: "left",
        reducedMotion: false,
      });
    player.play("missing");
    player.play("transform");
    render(0);
    expect(player.isPlaying("transform")).toBe(false);
    await flush();
    render(0);
    expect(player.isPlaying("transform")).toBe(true);
    render(1100);
    expect(player.isPlaying("transform")).toBe(false);
    player.dispose();
    sprite.destroy();
  });
});
