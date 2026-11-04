import { Rectangle, Sprite, Texture } from "pixi.js";
import { type AnimationClip, sampleAnimationClip } from "@/libs/rendering/animation";
import { stabilizeNearestTexture } from "@/libs/rendering/assets";
import type { GameRenderer } from "@/libs/rendering/runtime";

/** Each animation owns texture views; decoded image sources remain leased and immutable. */
export const createClipTextures = async (
  game: GameRenderer,
  clip: AnimationClip,
  options: { size: number; rendition?: number; nearest?: boolean },
) => {
  const sources = await Promise.all(
    clip.images.map((url) =>
      game.assets.texture(
        url,
        options.rendition ?? 50,
        options.nearest ? "nearest" : "linear",
      ),
    ),
  );
  if (game.isDisposed() || game.signal.aborted)
    throw new DOMException("Animation cancelled", "AbortError");
  const views = Array.from({ length: clip.frameCount }, (_, index) => {
    const source = sources.length === 1 ? sources[0] : sources[index];
    if (!source) throw new Error(`Animation source ${index} is missing`);
    const frame = sources.length === 1 ? index : 0;
    const width = source.width / clip.columns,
      height = source.height / clip.rows;
    return stabilizeNearestTexture(
      new Texture({
        source: source.source,
        frame: new Rectangle(
          (frame % clip.columns) * width,
          Math.floor(frame / clip.columns) * height,
          width,
          height,
        ),
      }),
    );
  });
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const view of views) view.destroy(false);
  };
  game.own(dispose);
  return { clip, views, dispose };
};

/**
 * Owns a Y-up square sprite and its frame views. size is world units; rendition
 * selects source pixels. renderAt samples elapsed milliseconds and hides finished clips.
 */
export const createSpriteClip = async (
  game: GameRenderer,
  clip: AnimationClip,
  options: { size: number; rendition?: number; nearest?: boolean },
) => {
  const frames = await createClipTextures(game, clip, options);
  if (game.isDisposed() || game.signal.aborted)
    throw new DOMException("Animation cancelled", "AbortError");
  const views = frames.views;
  const sprite = new Sprite(views[0]);
  sprite.anchor.set(0.5);
  sprite.width = options.size;
  sprite.height = options.size;
  sprite.scale.y *= -1;
  let disposed = false,
    index = -1;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (!sprite.destroyed) sprite.destroy({ texture: false, textureSource: false });
    frames.dispose();
  };
  game.own(dispose);
  return {
    sprite,
    dispose,
    renderAt: (elapsedMs: number, reducedMotion = false) => {
      const sample = sampleAnimationClip(clip, elapsedMs, reducedMotion);
      if (disposed) return sample;
      if (index !== sample.index) {
        index = sample.index;
        sprite.texture = views[index] ?? Texture.EMPTY;
      }
      sprite.visible = !sample.finished;
      return sample;
    },
  };
};
