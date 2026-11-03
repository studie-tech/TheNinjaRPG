import { Matrix, Rectangle, type Sprite, Texture } from "pixi.js";
import published from "@/libs/rendering/bakedWorldSources.json";
import type { GameRenderer } from "@/libs/rendering/runtime";
import type { WorldSpriteDescription } from "@/libs/rendering/sectorSprites";
import type { WorldBounds } from "@/libs/rendering/visibility";
import { worldAssetSource } from "@/libs/rendering/worldAssetSources";

export const SHADOW_DIRECTIONS = 8;
const DIRECTION_STEP = (Math.PI * 2) / SHADOW_DIRECTIONS;
const sources: Readonly<Record<string, BakedSource>> = published;

/** Adjacent compass samples share unit weight, including across the last/first seam. */
export const shadowDirectionBlend = (x: number, y: number) => {
  const angle = (Math.atan2(y, x) + Math.PI * 2) % (Math.PI * 2);
  const sample = angle / DIRECTION_STEP;
  const first = Math.floor(sample) % SHADOW_DIRECTIONS;
  return {
    first,
    second: (first + 1) % SHADOW_DIRECTIONS,
    mix: sample - Math.floor(sample),
  };
};

/** Immutable albedo/material URLs and atlas frames invalidate stale authored bakes together. */
export const bakedShadowKey = (
  source: Texture,
  description: WorldSpriteDescription,
) => {
  const published = worldAssetSource(description.image);
  return JSON.stringify([
    published?.image ?? description.image,
    source.frame,
    source.orig,
    description.worldMaterial ??
      (published
        ? { material: published.material, surfaces: published.surfaces }
        : undefined),
  ]);
};

export const hasBakedShadow = (source: Texture, description: WorldSpriteDescription) =>
  !!sources[bakedShadowKey(source, description)];

/** All compass samples and window emission arrive together, before any direction transition. */
export const loadBakedShadowAtlas = async (game: GameRenderer, key: string) => {
  const source = sources[key];
  if (!source) throw new Error("No authored shadow bake for this asset version");
  const [atlas, emission] = await Promise.all([
    game.assets.texture(source.atlas, 0, "linear"),
    source.emission
      ? game.assets.texture(source.emission, 0, "nearest")
      : Texture.EMPTY,
  ]);
  if (game.isDisposed() || game.signal.aborted)
    throw new DOMException("Lighting cancelled", "AbortError");
  const width = atlas.width / 4,
    height = atlas.height / 2;
  const views = Array.from(
    { length: SHADOW_DIRECTIONS },
    (_, index) =>
      new Texture({
        source: atlas.source,
        frame: new Rectangle(
          (index % 4) * width,
          Math.floor(index / 4) * height,
          width,
          height,
        ),
      }),
  );
  return {
    views,
    cellWidth: width,
    cellHeight: height,
    emission,
    frame: { emitters: source.emitters },
    aspect: source.aspect,
    minX: source.minX,
    minY: source.minY,
    width: source.width,
    height: source.height,
    bytes: source.bytes,
    destroy: () => {
      for (const view of views) view.destroy(false);
    },
    releaseTextures: () => {
      game.assets.releaseTexture(source.atlas, 0, "linear");
      if (source.emission) game.assets.releaseTexture(source.emission, 0, "nearest");
    },
  };
};

export type BakedShadowAtlas = Awaited<ReturnType<typeof loadBakedShadowAtlas>>;

/** A baked ground footprint follows the asset pose; changing light direction never rotates its foundation. */
export const bakedShadowTransform = (
  atlas: BakedShadowAtlas,
  source: Sprite,
  pose: Matrix,
) => {
  const height = source.texture.orig.height;
  const x = (atlas.width * height) / atlas.cellWidth;
  const y = (atlas.height * height) / atlas.cellHeight;
  const origin = pose.apply({
    x: atlas.minX * height - source.anchor.x * source.texture.orig.width,
    y: atlas.minY * height - source.anchor.y * height,
  });
  return new Matrix(pose.a * x, pose.b * x, pose.c * y, pose.d * y, origin.x, origin.y);
};

/** All compass cells share a conservative frame so culling retains shadows cast from offscreen assets. */
export const bakedShadowBounds = (
  atlas: BakedShadowAtlas,
  pose: Matrix,
): WorldBounds => {
  const frame = { width: atlas.cellWidth, height: atlas.cellHeight };
  const corners = [
    pose.apply({ x: 0, y: 0 }),
    pose.apply({ x: frame.width, y: 0 }),
    pose.apply({ x: 0, y: frame.height }),
    pose.apply({ x: frame.width, y: frame.height }),
  ];
  return {
    minX: Math.min(...corners.map((p) => p.x)),
    maxX: Math.max(...corners.map((p) => p.x)),
    minY: Math.min(...corners.map((p) => p.y)),
    maxY: Math.max(...corners.map((p) => p.y)),
  };
};

/** Adjacent cached volume masks blend in a fixed ground frame without live geometry or texture rendering. */
export const placeBakedShadowPair = (
  sprites: readonly Sprite[],
  atlas: BakedShadowAtlas,
  pose: Matrix,
  x: number,
  y: number,
  opacity: number,
) => {
  const sample = shadowDirectionBlend(x, y);
  for (const [i, sprite] of sprites.entries()) {
    const weight = i === 0 ? 1 - sample.mix : sample.mix;
    sprite.visible = opacity * weight > 0.0001;
    if (!sprite.visible) continue;
    sprite.texture =
      atlas.views[i === 0 ? sample.first : sample.second] ?? Texture.EMPTY;
    sprite.anchor.set(0);
    sprite.setFromMatrix(pose);
    sprite.alpha = opacity * weight;
  }
};

type BakedSource = {
  aspect: number;
  minX: number;
  minY: number;
  width: number;
  height: number;
  bytes: number;
  emitters: { x: number; y: number; height: number }[];
  atlas: string;
  emission?: string;
};
