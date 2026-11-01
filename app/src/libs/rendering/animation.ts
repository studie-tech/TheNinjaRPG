import type { GameAsset } from "@/drizzle/schema";
import type { CharacterAssetConfig } from "@/libs/rendering/characterAssets";
import type {
  CharacterAnimationState,
  SpriteDirection,
} from "@/validators/towerDefense";

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

/** Missing movement/attack art falls back to that direction's rotation without inventing frames. */
export const characterAnimationClip = (
  config: CharacterAssetConfig,
  state: CharacterAnimationState,
  direction: SpriteDirection,
): AnimationClip => {
  const animation = config.animations.find((entry) => entry.state === state);
  const rotation = config.rotations[direction] ?? config.rotations.south;
  const images = animation?.frames[direction]?.length
    ? animation.frames[direction]
    : rotation
      ? [rotation]
      : [];
  if (!images?.length) throw new Error(`Character has no ${direction} artwork`);
  return {
    images: images.map((image) =>
      /^https?:\/\//.test(image) || !config.basePath
        ? image
        : `${config.basePath}/${image}`,
    ),
    columns: 1,
    rows: 1,
    frameCount: images.length,
    frameDurationMs: animation?.frameDurationMs ?? 100,
    loop: animation?.loop ?? true,
  };
};

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
