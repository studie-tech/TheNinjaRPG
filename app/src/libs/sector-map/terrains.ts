import type { CombatBiome } from "@/drizzle/constants";
import { IMG_BG_ICE, IMG_BG_OCEAN, IMG_BG_SNOW } from "@/drizzle/constants";

/**
 * The terrain registry: every kind of ground a sector tile can be made of.
 *
 * Terrain is CONTENT - the shared library lives in the MapTerrain table where
 * the content team can add and edit kinds (colors, texture, water behaviour,
 * walk cost, combat arena), and it rides to the client with the sector window
 * exactly like the decoration sprite library. The five specs below are the
 * built-in defaults: they seed the table, keep combat/tower-defense arenas
 * rendering without a database round-trip, and act as the fallback if a DB row
 * is missing. The built-in KEYS are protected - the globe generator (ocean/
 * ground/dessert/ice) and legacy maps reference them - but their looks are
 * editable through the database rows, which win over these on merge.
 */
export interface TerrainSpec {
  key: string;
  name: string;
  /** Three-shade palette [light, mid, dark] driving the tile materials */
  colors: [string, string, string];
  /** Optional texture blended over the palette (e.g. ocean waves) */
  textureUrl: string | null;
  /** Solid representative color for the Tiled editor palette */
  swatchColor: string;
  /** Combat arena background for battles started on this terrain */
  battleBiome: CombatBiome;
  /** Water: recessed + animated waves + swim cost + lake variant in Tiled */
  isWater: boolean;
  /** Tile face depression below ground level, as a fraction of the tile edge */
  depression: number;
  defaultWalkCost: number;
}

export const BUILTIN_TERRAINS: TerrainSpec[] = [
  {
    key: "ground",
    name: "Grassland",
    colors: ["#48bd48", "#37aa37", "#239623"],
    textureUrl: null,
    swatchColor: "#37aa37",
    battleBiome: "ground",
    isWater: false,
    depression: 0,
    defaultWalkCost: 1,
  },
  {
    key: "ocean",
    name: "Ocean",
    colors: ["#184695", "#1c54b5", "#2767d7"],
    textureUrl: IMG_BG_OCEAN,
    swatchColor: "#1c54b5",
    battleBiome: "ocean",
    isWater: true,
    depression: 0.5,
    defaultWalkCost: 3,
  },
  {
    key: "dessert",
    name: "Desert",
    colors: ["#f9e79f", "#fad7a0", "#f5cba7"],
    textureUrl: null,
    swatchColor: "#f2d59a",
    battleBiome: "dessert",
    isWater: false,
    depression: 0,
    defaultWalkCost: 1,
  },
  {
    key: "ice",
    name: "Ice Sheet",
    colors: ["#9febf7", "#89cde0", "#98dfe8"],
    textureUrl: IMG_BG_ICE,
    swatchColor: "#cfe8ff",
    battleBiome: "ice",
    isWater: false,
    depression: 0.25,
    defaultWalkCost: 1,
  },
  {
    key: "snow",
    name: "Snowfield",
    colors: ["#ffffff", "#eeeeee", "#fefefe"],
    textureUrl: IMG_BG_SNOW,
    swatchColor: "#eef4fb",
    battleBiome: "snow",
    isWater: false,
    depression: 0,
    defaultWalkCost: 2,
  },
];

export const BUILTIN_TERRAINS_BY_KEY = new Map(
  BUILTIN_TERRAINS.map((spec) => [spec.key, spec]),
);

/** The terrain every unknown key falls back to; guaranteed built-in */
export const FALLBACK_TERRAIN_KEY = "ground";

/**
 * The land terrain drawn under structures per sector biome, overriding the
 * authored tile. Structure sprites carry baked ground patches (snow, grass,
 * sand) that must blend with the tiles beneath; water biomes get a sand
 * island so shrines anchored in the ocean don't float on waves.
 */
export const STRUCTURE_GROUND_TERRAIN: Record<CombatBiome, string> = {
  ocean: "dessert",
  ground: "ground",
  dessert: "dessert",
  ice: "snow",
  snow: "snow",
  arena: "ground",
  default: "ground",
};

/**
 * Built-ins overlaid with the database terrain library: DB rows win on key
 * collision (so edits to the built-in looks take effect), creator-added kinds
 * extend the map.
 */
export const mergeTerrainSpecs = (
  dbTerrains: TerrainSpec[],
): Map<string, TerrainSpec> => {
  const merged = new Map<string, TerrainSpec>(BUILTIN_TERRAINS_BY_KEY);
  dbTerrains.forEach((row) => {
    merged.set(row.key, { ...row });
  });
  return merged;
};

/**
 * Depression of a built-in terrain by key (combat and tower-defense arenas
 * always render the built-in looks; battle backgrounds are a closed enum)
 */
export const builtinTerrainDepression = (key: string): number => {
  return BUILTIN_TERRAINS_BY_KEY.get(key)?.depression ?? 0;
};

/** Registry lookup that never misses: unknown keys resolve to ground */
export const resolveTerrainSpec = (
  key: string | undefined,
  registry: Map<string, TerrainSpec>,
): TerrainSpec => {
  const spec = key ? registry.get(key) : undefined;
  return (
    spec ??
    registry.get(FALLBACK_TERRAIN_KEY) ??
    (BUILTIN_TERRAINS_BY_KEY.get(FALLBACK_TERRAIN_KEY) as TerrainSpec)
  );
};
