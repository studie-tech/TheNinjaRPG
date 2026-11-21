import type { CombatBiome } from "@/drizzle/constants";
import type { TerrainHex } from "@/libs/hexgrid";
import {
  decorationShadowShape,
  type WorldSpriteDescription,
} from "@/libs/rendering/sectorSprites";
import {
  resolveWorldDecoration,
  resolveWorldTerrain,
  WORLD_UNDERSTORY,
} from "@/libs/rendering/worldArt";
import type { DecorationAsset } from "@/libs/sector-map/decorations";
import { DECORATION_ASSETS_BY_KEY } from "@/libs/sector-map/decorations";
import { BUILTIN_TERRAINS_BY_KEY } from "@/libs/sector-map/terrains";

/** Resolve atlas views without changing seeded scenery selection. */
const decorationArt = (key: string, biome?: CombatBiome) => {
  const asset = DECORATION_ASSETS_BY_KEY.get(key);
  if (!asset) throw new Error(`Unknown decoration asset ${key}`);
  const art = resolveWorldDecoration(asset, biome);
  return {
    filepath: art.filepath,
    frame: art.frame,
    shadow: art.shadow,
    shadowCaster:
      art.shadow || art.windAffected ? decorationShadowShape(art.key) : undefined,
    heightScale: art.heightScale,
  };
};
const terrain = (key: string, variant: number) => {
  const spec = BUILTIN_TERRAINS_BY_KEY.get(key);
  if (!spec) throw new Error(`Unknown built-in terrain ${key}`);
  return { spec: resolveWorldTerrain(spec), variant };
};

/** A terrain and shade: the look of one level band. */
type TerrainLook = [key: string, variant: number];

/** A biome's looks by rising level: each `below` band, then `top` for everything higher. */
type LevelBands = { below: [limit: number, ...TerrainLook][]; top: TerrainLook };

const LOWLAND_BANDS: LevelBands = {
  below: [
    [0.05, "ocean", 0],
    [0.1, "ocean", 1],
    [0.15, "ocean", 2],
    [0.2, "ground", 2],
    [0.5, "ground", 1],
    [0.8, "ground", 0],
    [0.9, "dessert", 0],
    [0.95, "dessert", 1],
  ],
  top: ["dessert", 2],
};

const FROZEN_BANDS: LevelBands = {
  below: [
    [0.05, "ocean", 2],
    [0.1, "ice", 0],
    [0.2, "ice", 1],
    [0.25, "ice", 2],
    [0.3, "snow", 0],
    [0.6, "snow", 1],
  ],
  top: ["snow", 2],
};

const BIOME_LEVEL_BANDS: Record<CombatBiome, LevelBands> = {
  ocean: {
    below: [
      [0.3, "ocean", 0],
      [0.6, "ocean", 1],
      [0.8, "ocean", 2],
      [0.85, "dessert", 0],
      [0.9, "dessert", 1],
      [0.95, "dessert", 2],
    ],
    top: ["ground", 2],
  },
  ground: LOWLAND_BANDS,
  default: LOWLAND_BANDS,
  arena: LOWLAND_BANDS,
  dessert: {
    below: [
      [0.05, "ocean", 2],
      [0.1, "ground", 2],
      [0.3, "dessert", 0],
      [0.6, "dessert", 1],
    ],
    top: ["dessert", 2],
  },
  ice: FROZEN_BANDS,
  snow: FROZEN_BANDS,
};

/** Retained procedural biome bands shared by combat and tower-defense renderers. */
export const getProceduralTerrain = (
  hex: Pick<TerrainHex, "level">,
  biome: CombatBiome,
) => {
  // A battle without a biome renders as the default.
  const { below, top } = BIOME_LEVEL_BANDS[biome] ?? BIOME_LEVEL_BANDS.default;
  const band = below.find(([limit]) => hex.level < limit);
  const [key, variant] = band ? [band[1], band[2]] : top;
  return terrain(key, variant);
};

type AssetType = {
  filepath: string;
  frame?: DecorationAsset["frame"];
  shadow?: number;
  shadowCaster?: WorldSpriteDescription["shadowCaster"];
  heightScale?: number;
  chance: number;
  scale: number;
  scaleVariation?: number;
  posVariation?: number;
  windAffected?: boolean;
  small?: true;
  randomRotation?: boolean;
};

/** Climate details participate in the same seeded choice and never change traversal cost. */
const groundDetailProps = (assets: DecorationAsset[], chance: number): AssetType[] =>
  assets.map((asset) => ({
    filepath: asset.filepath,
    frame: asset.frame,
    heightScale: asset.renderScale,
    chance,
    scale: 1,
    scaleVariation: 0.15,
    posVariation: 0.3,
    small: true,
    windAffected: asset.windAffected,
    shadowCaster: asset.windAffected ? "canopy" : undefined,
  }));

// Ground assets settings default
const GROUND_ASSETS_PROPS: AssetType[] = [
  ...groundDetailProps(
    WORLD_UNDERSTORY.ground.filter((_, index) => [2, 3, 4, 7].includes(index)),
    0.16,
  ),
  // Small assets
  {
    ...decorationArt("grass.tuft"),
    chance: 0.5,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    windAffected: true,
    small: true,
  },
  {
    ...decorationArt("grass.sprout"),
    chance: 0.3,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    windAffected: true,
    small: true,
  },
  {
    ...decorationArt("grass.flower"),
    chance: 0.1,
    scale: 0.7,
    scaleVariation: 0.2,
    posVariation: 0.25,
    windAffected: true,
    small: true,
  },
  {
    ...decorationArt("grass.pebble"),
    chance: 0.1,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    windAffected: false,
    small: true,
  },
  // Green Trees
  {
    ...decorationArt("tree.green.round"),
    chance: 0.7,
    scale: 2,
    scaleVariation: 0.7,
    posVariation: 0.25,
    windAffected: true,
  },
  {
    ...decorationArt("tree.green.tall"),
    chance: 0.7,
    scale: 2,
    scaleVariation: 0.7,
    posVariation: 0.25,
    windAffected: true,
  },
  {
    ...decorationArt("tree.green.wide"),
    chance: 0.5,
    scale: 2,
    scaleVariation: 0.7,
    posVariation: 0.25,
    windAffected: true,
  },
];

// Desert assets
const DESSERT_ASSET_PROPS: AssetType[] = [
  ...groundDetailProps(WORLD_UNDERSTORY.dessert, 0.3),
  // Cactus
  {
    ...decorationArt("cactus.saguaro"),
    chance: 0.1,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    windAffected: false,
  },
  {
    ...decorationArt("cactus.barrel"),
    chance: 0.1,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    windAffected: false,
  },
  {
    ...decorationArt("cactus.cluster"),
    chance: 0.1,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    windAffected: false,
  },
  // Stones
  {
    ...decorationArt("rock.sand", "dessert"),
    chance: 0.2,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    small: true,
  },
  {
    ...decorationArt("rock.grey", "dessert"),
    chance: 0.1,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    small: true,
  },
  {
    ...decorationArt("rock.slate", "dessert"),
    chance: 0.1,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    small: true,
  },
];

// Ice assets
const ICE_ASSET_PROPS: AssetType[] = [
  {
    ...decorationArt("ice.floe"),
    chance: 0.1,
    scale: 0.9,
    scaleVariation: 0.2,
    posVariation: 0.25,
    small: true,
    randomRotation: true,
  },
];

// Snow assets
const SNOW_ASSET_PROPS: AssetType[] = [
  ...groundDetailProps(WORLD_UNDERSTORY.snow, 0.3),
  // Stones
  {
    ...decorationArt("rock.grey"),
    chance: 0.1,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    small: true,
  },
  {
    ...decorationArt("rock.slate"),
    chance: 0.1,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    small: true,
  },
  // Snow trees
  {
    ...decorationArt("tree.snow.pine"),
    chance: 0.4,
    scale: 2,
    scaleVariation: 0.7,
    posVariation: 0.25,
    windAffected: true,
  },
];

// Ocean assets settings default
const OCEAN_ASSET_PROPS: AssetType[] = [];

/** Seeded art selection and movement cost contain no texture or scene objects. */
export const proceduralDecoration = (
  prng: () => number,
  asset: string,
  hex: TerrainHex,
  /** Only grass, flowers, pebbles and other ground detail, for ground kept walkable. */
  smallOnly = false,
) => {
  const rand = prng();
  const choices =
    asset === "ground"
      ? GROUND_ASSETS_PROPS
      : asset === "dessert"
        ? DESSERT_ASSET_PROPS
        : asset === "ice"
          ? ICE_ASSET_PROPS
          : asset === "snow"
            ? SNOW_ASSET_PROPS
            : OCEAN_ASSET_PROPS;
  // Sample each score once: random comparator calls depend on the browser's sort algorithm.
  const selected = choices
    .filter((choice) => rand < choice.chance && (!smallOnly || choice.small))
    .map((choice) => ({
      choice,
      score: Math.abs(choice.scale / 2 - hex.assetStrength + prng() / 10),
    }))
    .sort((a, b) => a.score - b.score)[0]?.choice;
  const cost =
    hex.cost +
    (asset === "ground" || asset === "dessert" || asset === "ice" || asset === "snow"
      ? 1
      : 5);
  if (!selected) return { cost, description: null };
  const size =
    (selected.scale + (selected.scaleVariation ?? 0) * (prng() - 0.5)) *
    (selected.heightScale ?? 1);
  const x =
    -hex.center.x +
    hex.width / 2 +
    hex.width * (selected.posVariation ?? 0) * (prng() - 0.5);
  const y = -hex.center.y + (size * hex.height) / 2 + 0.1 * hex.height * size;
  const description: WorldSpriteDescription = {
    id: `scenery:${hex.col},${hex.row}`,
    kind: "decoration",
    image: selected.filepath,
    frame: selected.frame,
    shadow: selected.shadow,
    shadowCaster: selected.shadowCaster,
    preserveAspect: !!selected.frame,
    size: size * hex.height,
    x,
    y,
    groundY: y - (size * hex.height) / 2,
    small: selected.small === true,
    // Keep enlarged pixel-art scenery crisp without increasing canvas resolution.
    rendition: selected.small ? 50 : 128,
    nearest: true,
    wind: selected.windAffected ? (Math.floor(rand * 4) * Math.PI) / 2 : null,
    rotation: !selected.frame && selected.randomRotation ? rand * Math.PI * 2 : 0,
  };
  return { cost, description };
};

/** Trees and rocks a simulated battlefield places, by biome, with their base scale. */
const FIELD_OBSTACLE_ART: Record<
  "ground" | "dessert" | "snow",
  Record<"tree" | "rock", { key: string; scale: number; biome?: CombatBiome }[]>
> = {
  ground: {
    tree: [
      { key: "tree.green.round", scale: 2 },
      { key: "tree.green.tall", scale: 2 },
      { key: "tree.green.wide", scale: 1.8 },
    ],
    rock: [
      { key: "rock.grey", scale: 1.3 },
      { key: "rock.slate", scale: 1.3 },
    ],
  },
  dessert: {
    tree: [
      { key: "cactus.saguaro", scale: 1.5 },
      { key: "cactus.cluster", scale: 1.3 },
    ],
    rock: [
      { key: "rock.sand", scale: 1.4, biome: "dessert" },
      { key: "rock.slate", scale: 1.4, biome: "dessert" },
    ],
  },
  snow: {
    tree: [{ key: "tree.snow.pine", scale: 2 }],
    rock: [
      { key: "rock.grey", scale: 1.3 },
      { key: "rock.slate", scale: 1.3 },
    ],
  },
};

/**
 * A tree or rock standing with its base at (x, groundY) in terrain pixels, for
 * battlefields whose obstacles a simulation places. `roll` in [0, 1) picks the art and
 * its size, so a seed always dresses the field the same way.
 */
export const fieldObstacleDescription = (
  kind: "tree" | "rock",
  biome: CombatBiome,
  roll: number,
  x: number,
  groundY: number,
  hexHeight: number,
  id: string,
): WorldSpriteDescription => {
  const set =
    FIELD_OBSTACLE_ART[
      biome === "dessert"
        ? "dessert"
        : biome === "snow" || biome === "ice"
          ? "snow"
          : "ground"
    ][kind];
  const choice = set[Math.floor(roll * set.length)] ?? set[0];
  if (!choice) throw new Error(`No ${kind} art for ${biome}`);
  const art = decorationArt(choice.key, choice.biome);
  const size = choice.scale * (0.85 + roll * 0.3) * (art.heightScale ?? 1);
  const asset = DECORATION_ASSETS_BY_KEY.get(choice.key);
  return {
    id,
    kind: "decoration",
    image: art.filepath,
    frame: art.frame,
    shadow: art.shadow,
    shadowCaster: art.shadowCaster,
    preserveAspect: !!art.frame,
    size: size * hexHeight,
    x,
    y: groundY + (size * hexHeight) / 2,
    groundY,
    small: false,
    rendition: 128,
    nearest: true,
    wind: kind === "tree" && asset?.windAffected ? 0 : null,
    rotation: 0,
  };
};
