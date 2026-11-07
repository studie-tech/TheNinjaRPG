import type { CombatBiome } from "@/drizzle/constants";
import { resolveWorldTerrain } from "@/libs/rendering/worldArt";
import { BUILTIN_TERRAINS_BY_KEY } from "@/libs/sector-map/terrains";

const hexToInt = (hex: string) => Number.parseInt(hex.replace("#", ""), 16);

/** Built-in spec colors as ints, for background-color lookups */
const builtinColors = (key: string) => {
  const spec = BUILTIN_TERRAINS_BY_KEY.get(key);
  if (!spec) throw new Error(`Unknown built-in terrain ${key}`);
  return resolveWorldTerrain(spec).colors.map(hexToInt) as [number, number, number];
};

/**
 * Returns the background color for a given biome
 * @param biome - The biome to get the background color for
 * @returns The background color for the given biome
 */
export const getBackgroundColor = (biome: CombatBiome) => {
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
