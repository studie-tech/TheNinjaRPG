import { Rectangle, Sprite, Texture } from "pixi.js";
import { type AnimationClip, sampleAnimationClip } from "@/libs/rendering/animation";
import {
  readTextureFramePixels,
  stabilizeNearestTexture,
} from "@/libs/rendering/assets";
import type { GameRenderer } from "@/libs/rendering/runtime";

/** Each animation owns texture views; decoded image sources remain leased and immutable. */
export const createClipTextures = async (
  game: GameRenderer,
  clip: AnimationClip,
  options: { size: number; height?: number; rendition?: number; nearest?: boolean },
) => {
  const sources = await Promise.all(
    clip.images.map((url) =>
      game.assets.texture(
        url,
        // Packed frames share pixel boundaries; resizing the atlas can blend adjacent frames.
        clip.columns > 1 || clip.rows > 1 ? 0 : (options.rendition ?? 50),
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
  options: {
    size: number;
    height?: number;
    rendition?: number;
    nearest?: boolean;
    fitContent?: boolean;
  },
) => {
  const frames = await createClipTextures(game, clip, options);
  if (game.isDisposed() || game.signal.aborted)
    throw new DOMException("Animation cancelled", "AbortError");
  const views = frames.views;
  const sprite = new Sprite(views[0]);
  sprite.anchor.set(0.5);
  sprite.width = options.size;
  sprite.height = options.height ?? options.size;
  sprite.scale.y *= -1;
  if (options.fitContent) {
    const bounds = animationContentBounds(views);
    const extent = Math.max(bounds.width, bounds.height);
    sprite.width = (sprite.texture.width * options.size) / extent;
    sprite.height = (sprite.texture.height * options.size) / extent;
    sprite.scale.y = -Math.abs(sprite.scale.y);
    sprite.anchor.set(
      (bounds.x + bounds.width / 2) / sprite.texture.width,
      (bounds.y + bounds.height / 2) / sprite.texture.height,
    );
  }
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
    loop: clip.loop,
    frameRate: 1000 / clip.frameDurationMs,
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

const contentBounds = new WeakMap<Texture["source"], Map<string, Rectangle>>();

/** One union across the flight cycle removes atlas padding without frame-to-frame size jitter. */
const animationContentBounds = (views: Texture[]) => {
  const first = views[0];
  if (!first) return new Rectangle(0, 0, 1, 1);
  const key = views
    .map(({ frame }) => `${frame.x},${frame.y},${frame.width},${frame.height}`)
    .join(":");
  const shared = views.every((view) => view.source === first.source);
  const cached = shared && contentBounds.get(first.source)?.get(key);
  if (cached) return cached;
  let left = 1,
    top = 1,
    right = 0,
    bottom = 0;
  try {
    for (const view of views) {
      const scale = Math.min(1, 256 / Math.max(view.width, view.height));
      const width = Math.max(1, Math.round(view.width * scale));
      const height = Math.max(1, Math.round(view.height * scale));
      const pixels = readTextureFramePixels(view, 256);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          if ((pixels[(y * width + x) * 4 + 3] ?? 0) >= 8) {
            left = Math.min(left, x / width);
            top = Math.min(top, y / height);
            right = Math.max(right, (x + 1) / width);
            bottom = Math.max(bottom, (y + 1) / height);
          }
    }
  } catch {
    // Unreadable artwork retains its authored frame dimensions.
  }
  const bounds =
    right > left && bottom > top
      ? new Rectangle(
          left * first.width,
          top * first.height,
          (right - left) * first.width,
          (bottom - top) * first.height,
        )
      : new Rectangle(0, 0, first.width, first.height);
  if (shared) {
    const cache = contentBounds.get(first.source) ?? new Map<string, Rectangle>();
    cache.set(key, bounds);
    contentBounds.set(first.source, cache);
  }
  return bounds;
};
