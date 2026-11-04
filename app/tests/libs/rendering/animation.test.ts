import { describe, expect, it } from "bun:test";
import { assetAnimationClip, characterAnimationClip, sampleAnimationClip } from "@/libs/rendering/animation";
import {
  type CharacterAssetConfig,
  type SpriteDirection,
  spriteDirections,
} from "@/validators/towerDefense";

const rotations = () =>
  Object.fromEntries(
    spriteDirections.map((direction) => [direction, `rotations/${direction}.png`]),
  ) as CharacterAssetConfig["rotations"];
const frames = (name: string, count: number) =>
  Object.fromEntries(
    spriteDirections.map((direction) => [
      direction,
      Array.from({ length: count }, (_, index) => `${name}/${direction}/frame_00${index}.png`),
    ]),
  ) as CharacterAssetConfig["animations"][number]["frames"];

const PLAYER_ASSET_CONFIG: CharacterAssetConfig = {
  rotations: rotations(),
  animations: [
    { name: "idle", state: "idle", frameDurationMs: 100, loop: true, frames: frames("idle", 8) },
    { name: "throw", state: "throw", frameDurationMs: 60, loop: false, frames: frames("throw", 7) },
  ],
};
const LIGHT_ENEMY_ASSET_CONFIG: CharacterAssetConfig = {
  rotations: rotations(),
  animations: [
    { name: "running", state: "moving", frameDurationMs: 80, loop: true, frames: frames("running", 6) },
  ],
};

describe("shared animation clips", () => {
  it("preserves vertical game-asset frame order and authored timing", () => {
    const clip = assetAnimationClip({ image: "effect.png", frames: 8, speed: 60 });
    expect(clip).toMatchObject({ images: ["effect.png"], columns: 1, rows: 8 });
    expect(sampleAnimationClip(clip, 0)).toEqual({ index: 0, finished: false });
    expect(sampleAnimationClip(clip, 119)).toEqual({ index: 1, finished: false });
    expect(sampleAnimationClip(clip, 479)).toEqual({ index: 7, finished: false });
    expect(sampleAnimationClip(clip, 480)).toEqual({ index: 7, finished: true });
  });
  it("catches up after a long frame and wraps looping clips without accumulating drift", () => {
    const clip = assetAnimationClip({ image: "effect.png", frames: 8, speed: 60 }, true);
    expect(sampleAnimationClip(clip, 10_000)).toEqual({ index: 6, finished: false });
    expect(sampleAnimationClip(clip, -10)).toEqual({ index: 0, finished: false });
  });
  it("freezes decorative frames for reduced motion while retaining effect lifetime", () => {
    const clip = assetAnimationClip({ image: "effect.png", frames: 8, speed: 60 });
    expect(sampleAnimationClip(clip, 200, true)).toEqual({ index: 0, finished: false });
    expect(sampleAnimationClip(clip, 480, true)).toEqual({ index: 0, finished: true });
  });
  it("keeps all eight authored directions and their phase when direction changes", () => {
    for (const direction of Object.keys(PLAYER_ASSET_CONFIG.rotations) as SpriteDirection[]) {
      const clip = characterAnimationClip(PLAYER_ASSET_CONFIG, "idle", direction);
      expect(clip.frameCount).toBe(8);
      expect(clip.images[3]).toContain(`/${direction}/frame_003.png`);
      expect(sampleAnimationClip(clip, 350).index).toBe(3);
    }
  });
  it("falls back to a rotation and keeps configured one-shot behavior", () => {
    const missing = characterAnimationClip(PLAYER_ASSET_CONFIG, "moving", "east");
    expect(missing.images).toEqual(["rotations/east.png"]);
    expect(characterAnimationClip(LIGHT_ENEMY_ASSET_CONFIG, "moving", "south").frameDurationMs).toBe(80);
    expect(characterAnimationClip(PLAYER_ASSET_CONFIG, "throw", "south").loop).toBe(false);
  });
});
