import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { CompressedTexture, Group, NearestFilter, RGBA_ETC2_EAC_Format, RGBA_S3TC_DXT5_Format, Sprite, SRGBColorSpace, Texture, TextureLoader, type WebGLRenderer } from "three";
import type { CharacterAnimation } from "@/libs/spriteAnimations";
import { acquireAnimationTexture, animationTextureKey, animationTextureUrl, clearUnusedAnimationTextures } from "@/libs/threejs/animationTextures";
import { updateCharacterAnimation } from "@/libs/threejs/characterAnimation";
import * as compressedAtlases from "@/libs/threejs/compressedAnimationTextures";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import variants from "@/libs/threejs/animationTextureVariants.json";

const leases: Array<{ release: () => void }> = [];
const sprites: Sprite[] = [];
let sequence = 0;
const sheet = (patch: Partial<CharacterAnimation> = {}): CharacterAnimation => ({
  id: "atlas", name: "Atlas", url: `https://uploadthing.b-cdn.net/f/test-${sequence++}.png`,
  columns: 8, rows: 8, frameCount: 64, fps: 12.5, facing: "left", ...patch,
});
const acquire = (animation: CharacterAnimation, cellSize = 256, renderer?: WebGLRenderer) => {
  const lease = acquireAnimationTexture(animation, cellSize, renderer);
  if (lease) leases.push(lease);
  return lease;
};
const pendingLargeSheets = () => {
  const loads: Array<{ texture: Texture<HTMLImageElement>; finish: () => void; fail: () => void }> = [];
  vi.spyOn(TextureLoader.prototype, "load").mockImplementation((_url, onLoad, _progress, onError) => {
    const texture = new Texture<HTMLImageElement>();
    loads.push({ texture, finish: () => {
      texture.image = document.createElement("img");
      texture.image.width = 8 * 256;
      texture.image.height = 9 * 256;
      onLoad?.(texture);
    }, fail: () => onError?.(new Error("Unavailable atlas")) });
    return texture;
  });
  return loads;
};
beforeEach(() => {
  vi.spyOn(TextureLoader.prototype, "load").mockImplementation(() => new Texture());
});

describe("compressed character atlases", () => {
  const renderer = { capabilities: { maxTextureSize: 4096 }, extensions: { has: () => true } } as unknown as WebGLRenderer;
  const compressed = (width = 1024, height = 1024) => new CompressedTexture(
    [{ data: new Uint8Array(width * height), width, height }],
    width, height, RGBA_ETC2_EAC_Format,
  );
  const readyWebp = () => {
    vi.spyOn(TextureLoader.prototype, "load").mockImplementation((_url, onLoad) => {
      const texture = new Texture<HTMLImageElement>();
      texture.image = document.createElement("img");
      texture.image.width = texture.image.height = 1024;
      onLoad?.(texture);
      return texture;
    });
  };

  it("shares a pending request and publishes the compressed texture through existing leases", async () => {
    const texture = compressed();
    const load = vi.spyOn(compressedAtlases, "loadCompressedAnimationTexture").mockResolvedValue(texture);
    const animation = sheet();
    const first = acquire(animation, 128, renderer)!;
    const second = acquire(animation, 128, renderer)!;
    expect(first.texture.image).toBeNull();
    await waitFor(() => expect(first.texture).toBe(texture));
    expect(second.texture).toBe(texture);
    expect(load).toHaveBeenCalledTimes(1);
    expect(TextureLoader.prototype.load).not.toHaveBeenCalled();
    expect(texture.minFilter).toBe(NearestFilter);
    expect(texture.generateMipmaps).toBe(false);
    expect(texture.colorSpace).toBe(SRGBColorSpace);
  });

  it("uses WebP without requesting a compressed sheet on unsupported devices", () => {
    const load = vi.spyOn(compressedAtlases, "loadCompressedAnimationTexture");
    acquire(sheet(), 128, { extensions: { has: () => false } } as unknown as WebGLRenderer);
    expect(load).not.toHaveBeenCalled();
    expect(TextureLoader.prototype.load).toHaveBeenCalledTimes(1);
  });

  it.each([{ columns: 9, rows: 6 }, { columns: 6, rows: 9 }])("uses WebP without a KTX2 request when the $columns by $rows atlas exceeds the renderer limit", async (grid) => {
    const animation = sheet({ ...grid, frameCount: 54 });
    const key = animationTextureKey(animation, 256);
    const manifest = variants as Record<string, string>;
    manifest[key] = "https://uploadthing.b-cdn.net/f/oversized-test.ktx2";
    vi.spyOn(KTX2Loader.prototype, "detectSupport").mockReturnThis();
    const texture = compressed(grid.columns * 256, grid.rows * 256);
    texture.colorSpace = SRGBColorSpace;
    const request = vi.spyOn(KTX2Loader.prototype, "loadAsync").mockResolvedValue(texture);
    try {
      const lease = acquire(animation, 256, { ...renderer, capabilities: { maxTextureSize: 2048 } } as WebGLRenderer)!;
      await waitFor(() => expect(TextureLoader.prototype.load).toHaveBeenCalledTimes(1));
      expect(request).not.toHaveBeenCalled();
      expect(lease.texture).not.toBeInstanceOf(CompressedTexture);
      expect(TextureLoader.prototype.load).toHaveBeenCalledWith(animationTextureUrl(animation, 256), expect.any(Function), undefined, expect.any(Function));
    } finally {
      delete manifest[key];
    }
  });

  it("keeps a compressed atlas that fits exactly at the renderer limit", async () => {
    const texture = compressed(1536, 2048);
    const load = vi.spyOn(compressedAtlases, "loadCompressedAnimationTexture").mockResolvedValue(texture);
    const animation = sheet({ columns: 6, rows: 8, frameCount: 48 });
    const lease = acquire(animation, 256, { ...renderer, capabilities: { maxTextureSize: 2048 } } as WebGLRenderer)!;
    await waitFor(() => expect(lease.texture).toBe(texture));
    expect(load).toHaveBeenCalledTimes(1);
    expect(TextureLoader.prototype.load).not.toHaveBeenCalled();
  });

  it.each(["pending", "ready"])("keeps a %s compressed atlas separate from the smaller renderer's WebP cache", async (state) => {
    const texture = compressed(1536, 2304);
    const load = vi.spyOn(compressedAtlases, "loadCompressedAnimationTexture").mockResolvedValue(texture);
    const animation = sheet({ columns: 6, rows: 9, frameCount: 54 });
    const first = acquire(animation, 256, renderer)!;
    if (state === "ready") await waitFor(() => expect(first.texture).toBe(texture));
    const smaller = { ...renderer, capabilities: { maxTextureSize: 2048 } } as WebGLRenderer;
    const fallback = acquire(animation, 256, smaller)!;
    await waitFor(() => expect(first.texture).toBe(texture));
    expect(fallback.texture).not.toBe(texture);
    expect(acquire(animation, 256, smaller)!.texture).toBe(fallback.texture);
    expect(acquire(animation, 256, renderer)!.texture).toBe(texture);
    expect(load).toHaveBeenCalledTimes(1);
    expect(TextureLoader.prototype.load).toHaveBeenCalledTimes(1);
  });

  it("keeps supported and unsupported renderers in separate cache entries", async () => {
    const texture = compressed();
    vi.spyOn(compressedAtlases, "loadCompressedAnimationTexture").mockResolvedValue(texture);
    const animation = sheet();
    const first = acquire(animation, 128, renderer)!;
    const fallback = acquire(animation, 128)!;
    await waitFor(() => expect(first.texture).toBe(texture));
    expect(fallback.texture).not.toBe(texture);
    expect(TextureLoader.prototype.load).toHaveBeenCalledTimes(1);
  });

  it("uses WebP immediately when the browser has no WASM decoder support", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "WebAssembly")!;
    const load = vi.spyOn(compressedAtlases, "loadCompressedAnimationTexture");
    try {
      Object.defineProperty(globalThis, "WebAssembly", { value: undefined });
      acquire(sheet(), 128, renderer);
      expect(load).not.toHaveBeenCalled();
      expect(TextureLoader.prototype.load).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(globalThis, "WebAssembly", descriptor);
    }
  });

  it("falls back to the normal image after a missing or corrupt compressed sheet", async () => {
    readyWebp();
    vi.spyOn(compressedAtlases, "loadCompressedAnimationTexture").mockRejectedValue(new Error("Bad derivative"));
    const lease = acquire(sheet(), 128, renderer)!;
    await waitFor(() => expect(lease.texture.image).toHaveProperty("width", 1024));
    expect(lease.texture).not.toBeInstanceOf(CompressedTexture);
    expect(lease.texture.userData.failed).not.toBe(true);
    expect(TextureLoader.prototype.load).toHaveBeenCalledTimes(1);
  });

  it("disposes a late compressed load after static-only cleanup without reviving the cache", async () => {
    let finish: ((texture: CompressedTexture) => void) | undefined;
    vi.spyOn(compressedAtlases, "loadCompressedAnimationTexture").mockImplementation(() =>
      new Promise((resolve) => { finish = resolve; }));
    const lease = acquire(sheet(), 128, renderer)!;
    await waitFor(() => expect(finish).toBeDefined());
    lease.release(); leases.splice(leases.indexOf(lease), 1);
    clearUnusedAnimationTextures();
    const texture = compressed(); const disposed = vi.spyOn(texture, "dispose");
    finish!(texture);
    await waitFor(() => expect(disposed).toHaveBeenCalledTimes(1));
    expect(TextureLoader.prototype.load).not.toHaveBeenCalled();
  });

  it("falls back when decoding stalls and disposes a later compressed result", async () => {
    let finish: ((texture: CompressedTexture) => void) | undefined;
    vi.spyOn(compressedAtlases, "loadCompressedAnimationTexture").mockImplementation(() =>
      new Promise((resolve) => { finish = resolve; }));
    // Capture the deadline without waiting eight seconds or mocking library decoding.
    let timeout: (() => void) | undefined;
    const original = globalThis.setTimeout;
    const deadline = vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number, ...args: unknown[]) => {
      if (delay === 8000) timeout = callback as () => void;
      return original(callback, delay, ...args);
    }) as typeof setTimeout);
    readyWebp();
    const lease = acquire(sheet(), 128, renderer)!;
    deadline.mockRestore();
    await waitFor(() => expect(finish).toBeDefined());
    timeout!();
    expect(lease.texture).not.toBeInstanceOf(CompressedTexture);
    const fallback = lease.texture;
    const texture = compressed(); const disposed = vi.spyOn(texture, "dispose");
    finish!(texture);
    await waitFor(() => expect(disposed).toHaveBeenCalledTimes(1));
    expect(lease.texture).toBe(fallback);
    expect(TextureLoader.prototype.load).toHaveBeenCalledTimes(1);
  });

  it("keeps compressed frames and mirroring private to each actor", async () => {
    const texture = compressed();
    vi.spyOn(compressedAtlases, "loadCompressedAnimationTexture").mockResolvedValue(texture);
    const animation = sheet();
    const first = new Sprite(); const second = new Sprite(); sprites.push(first, second);
    const info = { animations: { idle: animation }, event: undefined, moving: false,
      staticMap: new Texture(), cellSize: 128, renderer };
    updateCharacterAnimation({ ...info, sprite: first, facing: "left", now: 0 });
    await waitFor(() => expect(compressedAtlases.loadCompressedAnimationTexture).toHaveBeenCalled());
    await Promise.resolve();
    updateCharacterAnimation({ ...info, sprite: first, facing: "left", now: 10 });
    updateCharacterAnimation({ ...info, sprite: second, facing: "right", now: 10 });
    updateCharacterAnimation({ ...info, sprite: first, facing: "left", now: 210 });
    const a = first.material.map!; const b = second.material.map!;
    expect(a).toBeInstanceOf(CompressedTexture); expect(b).toBeInstanceOf(CompressedTexture);
    expect(a).not.toBe(b); expect(a).not.toBe(texture);
    expect(a.image).toBe(texture.image); expect(b.image).toBe(texture.image);
    expect(a.offset.x).toBe(2 / 8); expect(b.offset.x).toBe(1 / 8);
    expect(a.repeat.x).toBe(1 / 8); expect(b.repeat.x).toBe(-1 / 8);
    expect(texture.repeat.x).toBe(1); expect(texture.offset.x).toBe(0);
  });

  it("retains queued actions until WebP fallback is ready", async () => {
    let fail: ((error: Error) => void) | undefined;
    vi.spyOn(compressedAtlases, "loadCompressedAnimationTexture").mockImplementation(() =>
      new Promise((_resolve, reject) => { fail = reject; }));
    const sprite = new Sprite(); sprites.push(sprite);
    const action = sheet();
    const info = { sprite, animations: { "jutsu:fire": action }, moving: false,
      facing: "left" as const, staticMap: new Texture(), cellSize: 128, renderer };
    const event = { id: "cast", actionKey: "jutsu:fire" };
    updateCharacterAnimation({ ...info, event: undefined, now: 0 });
    updateCharacterAnimation({ ...info, event, now: 10 });
    await waitFor(() => expect(fail).toBeDefined());
    fail!(new Error("Unavailable"));
    await waitFor(() => expect(TextureLoader.prototype.load).toHaveBeenCalledTimes(1));
    updateCharacterAnimation({ ...info, event, now: 100 });
    expect(sprite.userData.characterAnimation.events).toEqual([event]);
    expect(sprite.userData.characterAnimation.eventStartedAt).toBeUndefined();
  });

  it("skips the compressed path entirely when character animations are disabled", () => {
    const load = vi.spyOn(compressedAtlases, "loadCompressedAnimationTexture");
    const sprite = new Sprite(); sprites.push(sprite);
    updateCharacterAnimation({ sprite, animations: { idle: sheet() }, event: undefined,
      moving: false, facing: "left", staticMap: new Texture(), now: 0, renderer, enabled: false });
    expect(load).not.toHaveBeenCalled();
    expect(TextureLoader.prototype.load).not.toHaveBeenCalled();
  });
});

describe("published compressed rendition contract", () => {
  const key = "test-published-rendition";
  const manifest = variants as Record<string, string>;
  const renderer = {} as WebGLRenderer;
  afterEach(() => { delete manifest[key]; });

  it("requests only exact published keys and leaves unknown grids to WebP", async () => {
    manifest[key] = "https://uploadthing.b-cdn.net/f/immutable-test.ktx2";
    vi.spyOn(KTX2Loader.prototype, "detectSupport").mockReturnThis();
    const texture = new CompressedTexture([{ data: new Uint8Array(16), width: 4, height: 4 }], 4, 4, RGBA_ETC2_EAC_Format);
    texture.colorSpace = SRGBColorSpace;
    const load = vi.spyOn(KTX2Loader.prototype, "loadAsync").mockResolvedValue(texture);
    expect(await compressedAtlases.loadCompressedAnimationTexture(`${key}:wrong-grid`, renderer, 4, 4)).toBeUndefined();
    expect(load).not.toHaveBeenCalled();
    expect(await compressedAtlases.loadCompressedAnimationTexture(key, renderer, 4, 4)).toBe(texture);
    expect(load).toHaveBeenCalledWith(manifest[key]);
  });

  it.each(["dimensions", "format", "color", "mipmaps"])("rejects and disposes an invalid derivative: %s", async (invalid) => {
    manifest[key] = "https://uploadthing.b-cdn.net/f/invalid-test.ktx2";
    vi.spyOn(KTX2Loader.prototype, "detectSupport").mockReturnThis();
    const texture = new CompressedTexture([{ data: new Uint8Array(16), width: 4, height: 4 }], 4, 4, RGBA_ETC2_EAC_Format);
    texture.colorSpace = SRGBColorSpace;
    if (invalid === "dimensions") texture.image.width = 8;
    if (invalid === "format") texture.format = RGBA_S3TC_DXT5_Format;
    if (invalid === "color") texture.colorSpace = "";
    if (invalid === "mipmaps") texture.mipmaps = [];
    vi.spyOn(KTX2Loader.prototype, "loadAsync").mockResolvedValue(texture);
    const disposed = vi.spyOn(texture, "dispose");
    await expect(compressedAtlases.loadCompressedAnimationTexture(key, renderer, 4, 4)).rejects.toThrow("Invalid compressed animation rendition");
    expect(disposed).toHaveBeenCalledTimes(1);
  });
});
afterEach(() => {
  for (const sprite of sprites.splice(0)) sprite.userData.disposeCharacterAnimation?.();
  for (const lease of leases.splice(0)) lease.release();
  clearUnusedAnimationTextures();
  vi.restoreAllMocks();
});

describe("character atlas cache", () => {
  it("uses stable exact-cell CDN renditions without cache-busting", () => {
    const animation = sheet();
    const url = new URL(animationTextureUrl(animation, 128));
    expect(url.searchParams.get("width")).toBe("1024");
    expect(url.searchParams.get("height")).toBe("1024");
    expect(url.searchParams.get("format")).toBe("webp");
    expect(animationTextureUrl(animation, 128)).toBe(url.toString());
  });
  it("shares pending loads, reuses released sheets and evicts only unused atlases", () => {
    const a = sheet(); const b = sheet(); const c = sheet();
    const first = acquire(a)!;
    const secondActor = acquire(a)!;
    expect(secondActor.texture).toBe(first.texture);
    const second = acquire(b)!;
    expect(acquire(c)).toBeUndefined(); // Two pinned 16 MiB atlases fill the budget.
    first.release(); leases.splice(leases.indexOf(first), 1);
    expect(acquire(c)).toBeUndefined(); // The second actor still uses A.
    secondActor.release(); leases.splice(leases.indexOf(secondActor), 1);
    const disposed = vi.spyOn(first.texture, "dispose");
    expect(acquire(c)).toBeDefined();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(acquire(b)!.texture).toBe(second.texture);
  });
  it("reuses decoded images across repeated battles without loading again", () => {
    const animation = sheet({ columns: 6, rows: 4, frameCount: 24 });
    const first = acquire(animation, 128)!;
    first.release(); leases.splice(leases.indexOf(first), 1);
    const second = acquire(animation, 128)!;
    expect(second.texture).toBe(first.texture);
    expect(TextureLoader.prototype.load).toHaveBeenCalledTimes(1);
  });
  it("swaps individually admissible atlases through static art and starts a lazy action at its first frame", () => {
    const loads = pendingLargeSheets();
    const idle = sheet({ id: "idle", rows: 9 });
    const attack = sheet({ id: "attack", rows: 9 });
    const sprite = new Sprite();
    sprites.push(sprite);
    const staticMap = new Texture();
    const info = { sprite, animations: { idle, "jutsu:fire": attack }, event: undefined,
      moving: false, facing: "left" as const, staticMap, now: 0, cellSize: 256 };
    updateCharacterAnimation(info);
    loads[0]!.finish();
    updateCharacterAnimation({ ...info, now: 100 });
    const idleMap = sprite.material.map!;
    const cloneDisposed = vi.spyOn(idleMap, "dispose");
    const idleDisposed = vi.spyOn(loads[0]!.texture, "dispose").mockImplementation(() => {
      // A released source must not survive eviction through this actor's cloned map.
      expect(sprite.material.map?.image).not.toBe(loads[0]!.texture.image);
    });
    const event = { id: "cast", actionKey: "jutsu:fire" };
    updateCharacterAnimation({ ...info, event, now: 200 });
    expect(loads).toHaveLength(2); // Each atlas is 18 MiB; together they exceed 32 MiB.
    expect(sprite.material.map).toBe(staticMap);
    expect(cloneDisposed).toHaveBeenCalledTimes(1);
    expect(idleDisposed).toHaveBeenCalledTimes(1);
    expect(sprite.userData.characterAnimation.events).toEqual([event]);
    expect(sprite.userData.characterAnimation.eventStartedAt).toBeUndefined();
    updateCharacterAnimation({ ...info, event, now: 9000 });
    expect(loads).toHaveLength(2);
    expect(sprite.userData.characterAnimation.eventStartedAt).toBeUndefined();
    loads[1]!.finish();
    updateCharacterAnimation({ ...info, event, now: 10000 });
    expect(sprite.material.map?.image).toBe(loads[1]!.texture.image);
    expect(sprite.material.map?.offset.x).toBe(0);
    expect(sprite.userData.characterAnimation.eventStartedAt).toBe(10000);
    updateCharacterAnimation({ ...info, event, now: 15120 });
    expect(loads).toHaveLength(3);
    expect(sprite.material.map).toBe(staticMap);
    expect(sprite.userData.characterAnimation.events).toEqual([]);
    loads[2]!.finish();
    updateCharacterAnimation({ ...info, event, now: 15200 });
    expect(sprite.userData.characterAnimation.animationId).toBe("idle");
    expect(sprite.material.map?.image).toBe(loads[2]!.texture.image);
    expect(sprite.userData.characterAnimation.sources.size).toBe(1);
  });
  it("keeps another actor's shared idle pinned when a large action cannot fit", () => {
    const loads = pendingLargeSheets();
    const idle = sheet({ id: "idle", rows: 9 });
    const attack = sheet({ id: "attack", rows: 9 });
    const first = new Sprite(); const second = new Sprite();
    sprites.push(first, second);
    const info = { animations: { idle, "jutsu:fire": attack }, event: undefined,
      moving: false, facing: "left" as const, staticMap: new Texture(), now: 0, cellSize: 256 };
    updateCharacterAnimation({ ...info, sprite: first });
    updateCharacterAnimation({ ...info, sprite: second });
    loads[0]!.finish();
    updateCharacterAnimation({ ...info, sprite: first, now: 100 });
    updateCharacterAnimation({ ...info, sprite: second, now: 100 });
    const secondMap = second.material.map;
    const disposed = vi.spyOn(loads[0]!.texture, "dispose");
    updateCharacterAnimation({ ...info, sprite: first, event: { id: "cast", actionKey: "jutsu:fire" }, now: 200 });
    expect(loads).toHaveLength(1);
    expect(disposed).not.toHaveBeenCalled();
    expect(first.material.map?.image).toBe(loads[0]!.texture.image);
    expect(second.material.map).toBe(secondMap);
    expect(first.userData.characterAnimation.events).toEqual([]);
    first.userData.disposeCharacterAnimation();
    clearUnusedAnimationTextures();
    expect(disposed).not.toHaveBeenCalled();
    expect(second.material.map).toBe(secondMap);
  });
  it("advances past a failed large sheet to another action without retaining its lease", () => {
    const loads = pendingLargeSheets();
    const idle = sheet({ id: "idle", rows: 9 });
    const bad = sheet({ id: "bad", rows: 9 });
    const good = sheet({ id: "good", rows: 9 });
    const sprite = new Sprite();
    sprites.push(sprite);
    const info = { sprite, animations: { idle, "jutsu:bad": bad, "jutsu:good": good },
      moving: false, facing: "left" as const, staticMap: new Texture(), cellSize: 256 };
    updateCharacterAnimation({ ...info, event: undefined, now: 0 });
    loads[0]!.finish();
    updateCharacterAnimation({ ...info, event: undefined, now: 100 });
    updateCharacterAnimation({ ...info, event: { id: "bad", actionKey: "jutsu:bad" }, now: 200 });
    expect(loads).toHaveLength(2);
    loads[1]!.fail();
    updateCharacterAnimation({ ...info, event: { id: "good", actionKey: "jutsu:good" }, now: 300 });
    expect(sprite.userData.characterAnimation.events).toEqual([{ id: "good", actionKey: "jutsu:good" }]);
    const failedDisposed = vi.spyOn(loads[1]!.texture, "dispose");
    updateCharacterAnimation({ ...info, event: undefined, now: 400 });
    expect(loads).toHaveLength(3);
    expect(failedDisposed).toHaveBeenCalledTimes(1);
    clearUnusedAnimationTextures();
    expect(failedDisposed).toHaveBeenCalledTimes(1);
    loads[2]!.finish();
    updateCharacterAnimation({ ...info, event: undefined, now: 9000 });
    expect(sprite.userData.characterAnimation.animationId).toBe("good");
    expect(sprite.userData.characterAnimation.eventStartedAt).toBe(9000);
    expect(sprite.userData.characterAnimation.sources.size).toBe(1);
  });
  it("detaches decoded atlases from hidden actors after cache eviction and clearing", () => {
    vi.spyOn(TextureLoader.prototype, "load").mockImplementation((_url, onLoad) => {
      const texture = new Texture<HTMLImageElement>();
      texture.image = document.createElement("img");
      texture.image.width = texture.image.height = 8 * 256;
      onLoad?.(texture);
      return texture;
    });
    const group = new Group();
    for (let index = 0; index < 5; index++) {
      const sprite = new Sprite();
      sprites.push(sprite);
      group.add(sprite);
      updateCharacterAnimation({ sprite, animations: { idle: sheet() }, event: undefined,
        moving: false, facing: "left", staticMap: new Texture(), now: 0, cellSize: 256 });
      expect(sprite.material.map?.image).toHaveProperty("width", 2048);
      sprite.visible = false;
      group.traverse((child) => child.userData.disposeCharacterAnimation?.());
    }
    clearUnusedAnimationTextures();
    expect(TextureLoader.prototype.load).toHaveBeenCalledTimes(5);
    expect(group.children).toHaveLength(5);
    let retainedBytes = 0;
    group.traverse((child) => {
      if (!(child instanceof Sprite)) return;
      const image = (child.material.map as Texture<HTMLImageElement> | null)?.image;
      if (image) retainedBytes += image.width * image.height * 4;
    });
    expect(retainedBytes).toBe(0);
  });
  it("does not download legacy oversized loops", () => {
    expect(acquire(sheet({ frameCount: 160, rows: 27, columns: 6 }))).toBeUndefined();
    expect(TextureLoader.prototype.load).not.toHaveBeenCalled();
  });
  it("validates external sheets separately when their grids differ", () => {
    const animation = sheet({ url: "https://example.com/shared-grid.png" });
    vi.spyOn(TextureLoader.prototype, "load").mockImplementation((_url, onLoad) => {
      const texture = new Texture<HTMLImageElement>();
      texture.image = document.createElement("img");
      texture.image.width = texture.image.height = 1024;
      onLoad?.(texture);
      return texture;
    });
    const rejected = acquire({ ...animation, columns: 4, rows: 4, frameCount: 16 }, 128)!;
    expect(rejected.texture.userData.failed).toBe(true);
    const accepted = acquire(animation, 128)!;
    expect(accepted.texture).not.toBe(rejected.texture);
    expect(accepted.texture.userData.failed).not.toBe(true);
    expect(accepted.texture.image).toHaveProperty("width", 1024);
    expect(TextureLoader.prototype.load).toHaveBeenCalledTimes(2);
  });
  it("can render an external desktop sheet after the mobile budget rejects it", () => {
    const animation = sheet({ url: "https://example.com/desktop.png", columns: 6, rows: 4, frameCount: 24 });
    const load = vi.spyOn(TextureLoader.prototype, "load").mockImplementation((_url, onLoad) => {
      const texture = new Texture<HTMLImageElement>();
      texture.image = document.createElement("img");
      texture.image.width = 6 * 256;
      texture.image.height = 4 * 256;
      onLoad?.(texture);
      return texture;
    });
    const sprite = new Sprite();
    sprites.push(sprite);
    const staticMap = new Texture();
    const info = { sprite, animations: { idle: animation }, event: undefined,
      moving: false, facing: "left" as const, staticMap, now: 0 };
    updateCharacterAnimation({ ...info, cellSize: 128 });
    expect(sprite.material.map).toBe(staticMap);
    updateCharacterAnimation({ ...info, cellSize: 256, now: 100 });
    expect(sprite.material.map).not.toBe(staticMap);
    expect(sprite.material.map?.image).toHaveProperty("width", 6 * 256);
    expect(sprite.material.map?.userData.failed).not.toBe(true);
    expect(load.mock.calls.map(([url]) => url))
      .toEqual([animation.url, animation.url]);
  });
  it("replaces an actor's external source when its requested cell size changes", () => {
    const animation = sheet({ url: "https://example.com/mobile.png", columns: 6, rows: 4, frameCount: 24 });
    vi.spyOn(TextureLoader.prototype, "load").mockImplementation((_url, onLoad) => {
      const texture = new Texture<HTMLImageElement>();
      texture.image = document.createElement("img");
      texture.image.width = 6 * 128;
      texture.image.height = 4 * 128;
      onLoad?.(texture);
      return texture;
    });
    const sprite = new Sprite();
    sprites.push(sprite);
    const info = { sprite, animations: { idle: animation }, event: undefined,
      moving: false, facing: "left" as const, staticMap: new Texture(), now: 0 };
    updateCharacterAnimation({ ...info, cellSize: 128 });
    const first = sprite.material.map;
    const disposed = vi.spyOn(first!, "dispose");
    updateCharacterAnimation({ ...info, cellSize: 256, now: 100 });
    expect(sprite.material.map).not.toBe(first);
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(sprite.userData.characterAnimation.sources.size).toBe(1);
    expect(TextureLoader.prototype.load).toHaveBeenCalledTimes(2);
  });
});
