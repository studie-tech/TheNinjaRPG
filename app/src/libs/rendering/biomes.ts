import { COMBAT_BIOMES, type CombatBiome } from "@/drizzle/constants";
import { resolveWorldTerrain } from "@/libs/rendering/worldArt";
import { BUILTIN_TERRAINS_BY_KEY } from "@/libs/sector-map/terrains";
import type { GlobalTile } from "@/libs/sector-map/world-types";
import { getBiomeFromGlobalTile } from "@/libs/travel";

const hexToInt = (hex: string) => Number.parseInt(hex.replace("#", ""), 16);

/** Built-in spec colors as ints, for background-color lookups */
const builtinColors = (key: string) => {
  const spec = BUILTIN_TERRAINS_BY_KEY.get(key);
  if (!spec) throw new Error(`Unknown built-in terrain ${key}`);
  return resolveWorldTerrain(spec).colors.map(hexToInt) as [number, number, number];
};

/**
 * Returns the background color for a given tile
 * @param tile - The tile to get the background color for
 * @returns The background color for the given tile
 */
export const getBackgroundColor = (tile: GlobalTile | CombatBiome) => {
  const biome: CombatBiome =
    typeof tile === "object"
      ? getBiomeFromGlobalTile(tile)
      : COMBAT_BIOMES.find((a) => a === tile)
        ? (tile as CombatBiome)
        : "default";
  switch (biome) {
    case "ocean":
      return { color: builtinColors("ocean")[0] };
    case "dessert":
      return { color: builtinColors("dessert")[2] };
    case "ice":
    case "snow":
      return { color: builtinColors("ice")[2] };
    case "ground":
      return { color: builtinColors("ground")[1] };
  }
  return { color: builtinColors("ground")[1] };
};
