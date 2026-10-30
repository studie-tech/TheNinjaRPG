import published from "@/libs/rendering/worldAssetSources.json";
import { transformImageUrl } from "@/utils/image";

/** Immutable uploads keep albedo, numerical pixels and topology at the same source resolution. */
export const WORLD_ASSET_SOURCES = published as Record<string, WorldAssetSource>;

const byImage = new Map(
  Object.entries(WORLD_ASSET_SOURCES).flatMap(
    ([key, source]) =>
      [
        [key, source],
        [transformImageUrl(source.image), source],
      ] as const,
  ),
);

/** Logical scenery keys and persisted atlas URLs resolve to the same published material. */
export const worldAssetSource = (image: string) =>
  byImage.get(transformImageUrl(image).split(/[?#]/)[0] ?? image);

export type WorldAssetSource = {
  image: string;
  material: string;
  surfaces: string;
  width: number;
  height: number;
  frames: number[][];
  sha256: { image: string; material: string; surfaces: string };
};
