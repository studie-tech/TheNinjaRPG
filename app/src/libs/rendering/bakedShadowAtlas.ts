import { Matrix, Rectangle, type Sprite, Texture } from "pixi.js";
import { stabilizeNearestTexture } from "@/libs/rendering/assets";
import published from "@/libs/rendering/bakedWorldSources.json";
import type { GameRenderer } from "@/libs/rendering/runtime";
import type { WorldSpriteDescription } from "@/libs/rendering/sectorSprites";
import type { WorldBounds } from "@/libs/rendering/visibility";
import { worldAssetSource } from "@/libs/rendering/worldAssetSources";

export const SHADOW_DIRECTIONS = 8;
const DIRECTION_STEP = (Math.PI * 2) / SHADOW_DIRECTIONS;
const sources = published as unknown as Readonly<Record<string, BakedSource>>;

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
  const key: unknown[] = [
    // Identity uses the canonical source URL; CDN rewriting belongs to texture delivery.
    published?.image ?? description.image,
    source.frame,
    source.orig,
    description.worldMaterial ??
      (published
        ? { material: published.material, surfaces: published.surfaces }
        : undefined),
  ];
  const basis = bakedShadowBasis(source, description);
  if (basis[0] !== 1 || basis[1] !== 0 || basis[2] !== 0 || basis[3] !== -1)
    key.push(basis);
  return JSON.stringify(key);
};

/** Normalize the artwork pose by physical height; positional and camera changes do not change its bake. */
export const bakedShadowBasis = (
  source: Texture,
  description: WorldSpriteDescription,
) => {
  const size = description.size;
  if (!(size > 0)) return [1, 0, 0, -1] as const;
  const ratio =
    ((description.width ??
      (description.preserveAspect
        ? (size * source.orig.width) / source.orig.height
        : size)) *
      source.orig.height) /
    (size * source.orig.width);
  const angle = description.rotation ?? 0,
    shear = description.shearY ?? 0;
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return [ratio * (c - s * shear), ratio * (s + c * shear), s, -c].map(
    (value) => Math.round(value * 1_000_000) / 1_000_000,
  ) as [number, number, number, number];
};

/** Test the canonical artwork/frame/material identity before acquiring any bake textures. */
export const hasBakedShadow = (source: Texture, description: WorldSpriteDescription) =>
  !!sources[bakedShadowKey(source, description)];

/**
 * Acquire all compass samples and optional window emission before direction transitions.
 * destroy() disposes derived views; releaseTextures() separately returns the shared page leases.
 */
export const loadBakedShadowAtlas = async (
  game: GameRenderer,
  key: string,
  includeEmission = true,
) => {
  const source = sources[key];
  if (!source) throw new Error("No authored shadow bake for this asset version");
  const atlasLease = game.assets.acquireTexture(source.atlas, 0, "linear");
  const emissionLease =
    includeEmission && source.emission
      ? game.assets.acquireTexture(source.emission, 0, "nearest")
      : null;
  let atlas: Texture, emissionSource: Texture;
  try {
    [atlas, emissionSource] = await Promise.all([
      atlasLease.resource,
      emissionLease?.resource ?? Texture.EMPTY,
    ]);
  } catch (error) {
    atlasLease.release();
    emissionLease?.release();
    throw error;
  }
  if (game.isDisposed() || game.signal.aborted) {
    atlasLease.release();
    emissionLease?.release();
    throw new DOMException("Lighting cancelled", "AbortError");
  }
  const emission =
    emissionLease && source.emissionFrame && source.emissionTrim
      ? stabilizeNearestTexture(
          new Texture({
            source: emissionSource.source,
            frame: new Rectangle(...source.emissionFrame),
            orig: new Rectangle(0, 0, ...(source.emissionSize ?? [1, 1])),
            trim: new Rectangle(...source.emissionTrim),
          }),
        )
      : emissionSource;
  const width = source.cellWidth,
    height = source.cellHeight;
  const views = source.directions.map(
    (direction) =>
      new Texture({
        source: atlas.source,
        frame: new Rectangle(...direction.frame),
        orig: new Rectangle(0, 0, width, height),
        trim: new Rectangle(...direction.trim),
      }),
  );
  return {
    views,
    cellWidth: width,
    cellHeight: height,
    emission,
    frame: { emitters: source.emitters, footprints: source.footprints ?? [] },
    basis: source.basis ?? ([1, 0, 0, -1] as const),
    aspect: source.aspect,
    minX: source.minX,
    minY: source.minY,
    width: source.width,
    height: source.height,
    bytes: source.bytes - (includeEmission ? 0 : (source.emissionBytes ?? 0)),
    destroy: () => {
      for (const view of views) view.destroy(false);
      if (emission !== emissionSource) emission.destroy(false);
    },
    releaseTextures: () => {
      atlasLease.release();
      emissionLease?.release();
    },
  };
};

/** Borrowed page textures and instance-owned views with separate cleanup operations. */
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
  const basis = atlas.basis;
  const residual = pose.clone().append(new Matrix(...basis).invert());
  const anchor = pose.apply({
    x: -source.anchor.x * source.texture.orig.width,
    y: -source.anchor.y * height,
  });
  const px = atlas.minX * height,
    py = -atlas.minY * height;
  return new Matrix(
    residual.a * x,
    residual.b * x,
    -residual.c * y,
    -residual.d * y,
    anchor.x + residual.a * px + residual.c * py,
    anchor.y + residual.b * px + residual.d * py,
  );
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

/** Published atlas frames use pixel units; footprints and emitters are normalized by artwork height. */
type BakedSource = {
  aspect: number;
  minX: number;
  minY: number;
  width: number;
  height: number;
  bytes: number;
  emitters: {
    x: number;
    y: number;
    height: number;
    color?: [number, number, number];
    normal?: [number, number];
  }[];
  atlas: string;
  cellWidth: number;
  cellHeight: number;
  directions: {
    frame: [number, number, number, number];
    trim: [number, number, number, number];
  }[];
  emission?: string;
  emissionFrame?: [number, number, number, number];
  emissionTrim?: [number, number, number, number];
  emissionSize?: [number, number];
  emissionBytes?: number;
  basis?: [number, number, number, number];
  footprints?: { points: [number, number][]; height: number }[];
};
