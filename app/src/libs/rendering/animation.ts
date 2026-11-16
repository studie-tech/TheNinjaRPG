import type { GameAsset } from "@/drizzle/schema";

/** Samples elapsed milliseconds; reduced motion holds frame zero without changing one-shot expiry. */
export const sampleAnimationClip = (
  clip: AnimationClip,
  elapsedMs: number,
  reducedMotion = false,
) => {
  const count = Math.max(1, clip.frameCount);
  const elapsed = Math.max(0, elapsedMs);
  const step = Math.floor(elapsed / Math.max(1, clip.frameDurationMs));
  const finished = !clip.loop && step >= count;
  return {
    index: reducedMotion ? 0 : clip.loop ? step % count : Math.min(count - 1, step),
    finished,
  };
};

/** Cruising time per hex; every direction takes the same time, which keeps stride poses even. */
const WALK_TILE_MS = 200;
/** Time spent accelerating, and again braking; short walks never reach full cruise. */
const WALK_RAMP_MS = 130;

/** Milliseconds a fighter takes to cover a path of the given number of hexes. */
export const walkDuration = (tiles: number) =>
  Math.max(1, tiles) * WALK_TILE_MS + WALK_RAMP_MS;

/**
 * Share of a path covered at a share of its duration: accelerates, cruises, then brakes,
 * across the whole path rather than each hex, so longer walks keep their momentum.
 */
export const walkProgress = (time: number, durationMs: number) => {
  const t = Math.min(1, Math.max(0, time));
  const ramp = Math.min(0.5, WALK_RAMP_MS / durationMs);
  const cruise = 1 / (1 - ramp);
  if (t < ramp) return (cruise * t * t) / (2 * ramp);
  if (t > 1 - ramp) return 1 - (cruise * (1 - t) * (1 - t)) / (2 * ramp);
  return cruise * (t - ramp / 2);
};

/** Game effects are vertical sprite sheets; asset.speed is milliseconds per frame. */
export const assetAnimationClip = (
  asset: Pick<GameAsset, "image" | "frames" | "speed">,
  loop = false,
): AnimationClip => ({
  images: [asset.image],
  columns: 1,
  rows: Math.max(1, asset.frames),
  frameCount: Math.max(1, asset.frames),
  frameDurationMs: Math.max(1, asset.speed),
  loop,
});

/** One sheet uses columns/rows in row-major order; multiple images supply one frame each. */
export type AnimationClip = {
  images: string[];
  columns: number;
  rows: number;
  frameCount: number;
  frameDurationMs: number;
  loop: boolean;
};

/** Square combat effect frames fit one hex height at every battlefield scale. */
export const EFFECT_ANIMATION_HEX_RATIO = 1;
