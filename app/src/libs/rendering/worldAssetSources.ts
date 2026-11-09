import published from "@/libs/rendering/worldAssetSources.json";
import splitSurfaces from "@/libs/rendering/worldSurfaceFrames.json";
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

/**
 * Each published `surfaces` file split into one immutable file per atlas frame, so scenes
 * download only the frames they draw. Keyed by the whole-atlas URL, which stays the identity
 * that authored bakes and light-pool fingerprints are built from.
 */
const SURFACE_FRAMES = splitSurfaces as Record<string, WorldSurfaceFrame[]>;

/** The per-frame copy of an atlas frame's surfaces; undefined when the atlas is not split. */
export const worldSurfaceFrameUrl = (surfaces: string, rect: readonly number[]) =>
  SURFACE_FRAMES[surfaces]?.find(({ frame }) =>
    frame.every((value, axis) => value === rect[axis]),
  )?.url;

/** Whether an atlas publishes per-frame surfaces instead of shipping them as one file. */
export const hasWorldSurfaceFrames = (surfaces: string) => surfaces in SURFACE_FRAMES;

export type WorldSurfaceFrame = { frame: number[]; url: string; sha256: string };
export type WorldAssetSource = {
  image: string;
  material: string;
  surfaces: string;
  width: number;
  height: number;
  frames: number[][];
  sha256: { image: string; material: string; surfaces: string };
};
