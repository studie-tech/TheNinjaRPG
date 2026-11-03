import { Rectangle, Texture } from "pixi.js";
import published from "@/libs/rendering/bakedVillageSources.json";
import type { GameRenderer } from "@/libs/rendering/runtime";
import type { WorldSpriteDescription } from "@/libs/rendering/sectorSprites";

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
export const bakedShadowKey = (source: Texture, description: WorldSpriteDescription) =>
  JSON.stringify([
    description.image,
    source.frame,
    source.orig,
    description.worldMaterial,
  ]);

export const hasBakedShadow = (source: Texture, description: WorldSpriteDescription) =>
  !!sources[bakedShadowKey(source, description)];

/** All compass samples and window emission arrive together, before any direction transition. */
export const loadBakedShadowAtlas = async (game: GameRenderer, key: string) => {
  const source = sources[key];
  if (!source) throw new Error("No authored shadow bake for this asset version");
  const [atlas, emission] = await Promise.all([
    game.assets.texture(source.atlas, 0, "linear"),
    game.assets.texture(source.emission, 0, "nearest"),
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
  };
};

export type BakedShadowAtlas = Awaited<ReturnType<typeof loadBakedShadowAtlas>>;
type BakedSource = {
  aspect: number;
  minX: number;
  minY: number;
  width: number;
  height: number;
  bytes: number;
  emitters: { x: number; y: number; height: number }[];
  atlas: string;
  emission: string;
};
