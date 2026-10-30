import { basename, join } from "node:path";

/** Publication audits read the exact source files whose hashes are pinned in the hosted manifest. */
export const worldArtDirectory = process.env.WORLD_ART_SOURCE_DIR;

/** Runtime unit tests use synthetic materials; decoded-asset audits opt into a local publication cache. */
export const worldArtFile = (image: string) => {
  if (!worldArtDirectory) throw new Error("WORLD_ART_SOURCE_DIR must point to the published world-art source cache");
  return join(worldArtDirectory, basename(image));
};
