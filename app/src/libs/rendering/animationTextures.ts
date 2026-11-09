import { Assets, type Texture } from "pixi.js";
import { SPRITE_ANIMATION_LIMITS } from "@/drizzle/constants";
import { stabilizeNearestTexture } from "@/libs/rendering/assets";
import type { CharacterAnimation } from "@/libs/spriteAnimations";
import { textureImageUrl } from "@/utils/image";

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_SHEETS = 16;
const entries = new Map<string, Atlas>();
let sequence = 0;
let retiringBytes = 0;
let retiringCount = 0;
const unloading = new Map<string, Promise<unknown>>();
const unload = (entry: Atlas) => {
  // Compatible grid declarations may lease the same immutable Pixi source.
  if ([...entries.values()].some((other) => other.url === entry.url)) return;
  retiringBytes += entry.bytes;
  retiringCount++;
  const pending = entry.resource
    .catch(() => {})
    .then(() => Assets.unload(entry.url))
    .catch(() => {});
  unloading.set(entry.url, pending);
  void pending.finally(() => {
    retiringBytes -= entry.bytes;
    retiringCount--;
    if (unloading.get(entry.url) === pending) unloading.delete(entry.url);
  });
};

/** Stable responsive URLs preserve the HTTP cache after decoded atlases are evicted. */
export const animationTextureUrl = (
  animation: CharacterAnimation,
  cellSize: number,
) => {
  // Prepared raw sheets bypass the CDN's asynchronous image optimizer.
  if (animation.smallUrl && cellSize === 128)
    return textureImageUrl(animation.smallUrl, 0);
  if (animation.smallUrl && cellSize === 256) return textureImageUrl(animation.url, 0);
  const url = new URL(textureImageUrl(animation.url, animation.columns * cellSize));
  if (url.hostname === "uploadthing.b-cdn.net") {
    url.searchParams.set("height", String(animation.rows * cellSize));
    url.searchParams.set("format", "webp");
    url.searchParams.set("quality", "90");
  }
  return url.toString();
};

/** Grid identity prevents incompatible library entries sharing one frame layout. */
export const animationTextureKey = (animation: CharacterAnimation, cellSize: number) =>
  `${animation.columns}x${animation.rows}:${cellSize}:${animationTextureUrl(animation, cellSize)}`;

/**
 * Admission includes active and pending RGBA images. Actors own only frame views;
 * the shared source survives until all leases are released and its budget is needed.
 */
export const acquireAnimationTexture = (
  animation: CharacterAnimation,
  cellSize = 128,
  maxTextureSize = Number.POSITIVE_INFINITY,
) => {
  const bytes = animation.columns * animation.rows * cellSize ** 2 * 4;
  if (
    !validAnimation(animation) ||
    bytes > MAX_BYTES ||
    Math.max(animation.columns, animation.rows) * cellSize > maxTextureSize
  )
    return;
  const key = animationTextureKey(animation, cellSize);
  let entry = entries.get(key);
  if (!entry) {
    let plannedBytes = reservedBytes() - retiringBytes;
    let plannedCount = entries.size;
    for (const [oldKey, old] of [...entries].sort(([, a], [, b]) => a.used - b.used)) {
      if (plannedCount < MAX_SHEETS && plannedBytes + bytes <= MAX_BYTES) break;
      if (old.refs !== 0 || !old.settled) continue;
      entries.delete(oldKey);
      plannedBytes -= old.bytes;
      plannedCount--;
      unload(old);
    }
    if (
      entries.size + retiringCount >= MAX_SHEETS ||
      reservedBytes() + bytes > MAX_BYTES
    )
      return;
    // Pixi caches by source; a fragment keeps these nearest atlases apart from linear scene
    // loads of the same file (travel loops), which the HTTP cache still shares.
    const url = `${animationTextureUrl(animation, cellSize)}#tnr-animation`;
    const resource = Promise.resolve(unloading.get(url))
      .then(() =>
        Assets.load<Texture>({
          src: url,
          parser: "loadTextures",
          data: { scaleMode: "nearest" },
        }),
      )
      .then((texture) => {
        const cell = texture.width / animation.columns;
        if (
          !Number.isInteger(cell) ||
          cell !== texture.height / animation.rows ||
          cell > cellSize ||
          cell < 1
        ) {
          throw new Error("Animation atlas dimensions do not match its grid");
        }
        return stabilizeNearestTexture(texture);
      });
    // A failed request stays failed in this cache entry; frames never resubmit it.
    void resource.catch(() => {});
    entry = { resource, bytes, refs: 0, used: ++sequence, url, settled: false };
    const current = entry;
    void resource.then(
      () => {
        current.settled = true;
      },
      () => {
        current.settled = true;
      },
    );
    entries.set(key, entry);
  }
  entry.refs++;
  const current = entry;
  let released = false;
  return {
    resource: current.resource,
    release: () => {
      if (released) return;
      released = true;
      current.refs--;
      current.used = ++sequence;
    },
  };
};

/** Release idle decoded animation sources when the device disables animation. */
export const clearUnusedAnimationTextures = () => {
  for (const [key, entry] of entries) {
    if (entry.refs !== 0) continue;
    entries.delete(key);
    unload(entry);
  }
};

const reservedBytes = () =>
  retiringBytes + [...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
const validAnimation = (animation: CharacterAnimation) =>
  Number.isInteger(animation.columns) &&
  animation.columns > 0 &&
  Number.isInteger(animation.rows) &&
  animation.rows > 0 &&
  Number.isInteger(animation.frameCount) &&
  animation.frameCount >= 2 &&
  animation.frameCount <= SPRITE_ANIMATION_LIMITS.frames &&
  animation.columns * animation.rows <= SPRITE_ANIMATION_LIMITS.cells &&
  animation.frameCount <= animation.columns * animation.rows &&
  Number.isFinite(animation.fps) &&
  animation.fps >= 1 &&
  animation.fps <= 60 &&
  animation.frameCount / animation.fps <= SPRITE_ANIMATION_LIMITS.seconds;

type Atlas = {
  settled: boolean;
  resource: Promise<Texture>;
  url: string;
  bytes: number;
  refs: number;
  used: number;
};
