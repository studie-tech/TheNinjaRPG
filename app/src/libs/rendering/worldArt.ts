import type { CombatBiome } from "@/drizzle/constants";
import type { TerrainHex } from "@/libs/hexgrid";
import type { WorldMotionDirection } from "@/libs/rendering/sectorSprites";
import {
  DECORATION_ASSETS_BY_KEY,
  type DecorationAsset,
  TRAINING_DUMMY_ASSET,
} from "@/libs/sector-map/decorations";
import { BUILTIN_TERRAINS_BY_KEY, type TerrainSpec } from "@/libs/sector-map/terrains";
import { isBunnyCdnUrl, transformImageUrl } from "@/utils/image";

/** Shared atlas views keep woodland scenery at one pixel density and lighting direction. */
export const WOODLAND_DECORATIONS: DecorationAsset[] = (
  [
    ["oak", 22.5, 38, 124.5, 138, 3.6, 0.25],
    ["golden-tree", 184, 41, 119.5, 137.5, 3.5, 0.225],
    ["cedar", 338.5, 34, 110, 147, 4, 0.275],
    ["bamboo", 497.5, 36.5, 105.5, 143.5, 3.2, 0.15],
    ["dojo", 20, 207.5, 127, 139, 4.8, 0.175],
    ["tea-house", 181, 227, 128.5, 119.5, 3.8, 0.15],
    ["shrine", 341.5, 222, 119, 124, 3.6, 0.15],
    ["torii", 496, 205.5, 115, 142.5, 3.5, 0.11],
    ["rocks", 16.5, 379.5, 133.5, 104, 1.15, 0.12],
    ["flower-bush", 186, 394.5, 112.5, 90.5, 0.85, 0],
    ["lantern", 353, 375, 86, 111.5, 1.1, 0.12],
    ["market", 487, 369, 126.5, 116, 2.8, 0.25],
    ["reeds", 26.5, 507.5, 112.5, 98.5, 1.1, 0],
    ["fence", 186, 519.5, 116, 86.5, 0.9, 0.1],
    ["ninja", 350.5, 512, 72, 95.5, 1.1, 0.18],
    ["stones", 497.5, 521, 103.5, 85, 0.55, 0],
  ] as const
).map(([key, x, y, width, height, renderScale, shadow]) => ({
  key: `woodland.${key}`,
  filepath: "/world-art/woodland-village.webp",
  frame: { x, y, width, height },
  renderScale,
  shadow,
  windAffected: [
    "oak",
    "golden-tree",
    "cedar",
    "bamboo",
    "flower-bush",
    "reeds",
  ].includes(key),
}));

const woodlandByKey = new Map(WOODLAND_DECORATIONS.map((asset) => [asset.key, asset]));

/** Only the bundled Academy target receives pixel artwork; authored AI replacements keep their dimensions. */
export const resolveWorldAiArtwork = (image: string) => {
  const source = transformImageUrl(image);
  if (
    !isBunnyCdnUrl(source) ||
    !new URL(source).pathname.endsWith(
      "/ai-sprite-20261018-ICXb49Z0Jle3GyJ-rosTi-main-5ef5c0a7c909.webp",
    )
  )
    return undefined;
  return {
    image: TRAINING_DUMMY_ASSET.filepath,
    height: TRAINING_DUMMY_ASSET.renderScale,
  };
};

/** A whole journey's dominant heading keeps alternating hex steps from flipping the pose. */
export const worldMotionHeading = (
  from: Pick<TerrainHex, "center">,
  to: Pick<TerrainHex, "center">,
): { direction: WorldMotionDirection; facing: 1 | -1 } => {
  const dx = from.center.x - to.center.x,
    dy = from.center.y - to.center.y;
  return {
    direction: Math.abs(dx) >= Math.abs(dy) ? "horizontal" : dy > 0 ? "north" : "south",
    facing: dx < 0 ? -1 : 1,
  };
};
/** Small foliage and climate silhouettes use the same pixel scale as the woodland canopy. */
export const BIOME_DECORATIONS: DecorationAsset[] = (
  [
    ["grass.tuft", 31, 54, 117.5, 98.5],
    ["grass.sprout", 181, 52, 119, 102],
    ["grass.flower", 334, 66.5, 114.5, 92.5],
    ["grass.pebble", 486.5, 83, 109.5, 71],
    ["cactus.saguaro", 33.5, 177, 101, 138.5],
    ["cactus.barrel", 190, 226, 92.5, 90],
    ["cactus.cluster", 341.5, 208, 105, 108],
    ["rock.sand", 484, 226, 123, 89.5],
    ["rock.grey", 23.5, 382.5, 119.5, 81],
    ["rock.slate", 178, 366.5, 122, 94.5],
    ["ice.floe", 332.5, 389, 123.5, 78.5],
    ["tree.snow.pine", 486.5, 337, 117, 130.5],
    ["world.reeds", 25, 489.5, 119.5, 114.5],
    ["world.shrub", 177, 512, 118.5, 89.5],
    ["world.stump", 327.5, 512, 116, 89.5],
    ["world.log", 474, 523.5, 136.5, 78],
  ] as const
).map(([key, x, y, width, height]) => ({
  key,
  filepath: "/world-art/biome-scenery.webp",
  frame: { x: x - 1, y: y - 1, width: width + 2, height: height + 2 },
  shadow: key.startsWith("tree.") || key.startsWith("cactus.") ? 0.1 : 0,
  windAffected: key.startsWith("tree.") || ["world.reeds", "world.shrub"].includes(key),
}));
const biomeByKey = new Map(BIOME_DECORATIONS.map((asset) => [asset.key, asset]));
/** Dry mineral views share one small atlas; damp regions retain their moss-covered rocks. */
const desertRockArt = new Map<string, DecorationAsset>(
  (
    [
      ["grass.pebble", 2, 112, 73],
      ["rock.sand", 130, 125, 92],
      ["rock.grey", 258, 122, 83],
      ["rock.slate", 386, 124, 97],
    ] as const
  ).map(([key, x, width, height]) => [
    key,
    {
      key,
      shadow: 0,
      filepath: "/world-art/desert-rocks.webp",
      frame: { x, y: 2, width, height },
    },
  ]),
);
/** Low ground details retain native pixels in one compact, shared cutout atlas. */
export const GROUND_DETAIL_ART: DecorationAsset[] = (
  [
    ["grass", 5, 11, 38, 30, 0.3],
    ["fern", 53, 11, 38, 30, 0.36],
    ["moss", 101, 19, 38, 22, 0.23],
    ["leaves", 149, 14, 38, 27, 0.23],
    ["twigs", 5, 59, 38, 30, 0.22],
    ["pebbles", 53, 61, 38, 28, 0.23],
    ["flowers", 101, 59, 38, 30, 0.3],
    ["roots", 149, 61, 38, 28, 0.25],
    ["snow-grass", 5, 108, 38, 29, 0.28],
    ["snow-pebbles", 53, 113, 38, 24, 0.22],
    ["snow-needles", 101, 111, 38, 26, 0.23],
    ["snow-juniper", 149, 111, 38, 26, 0.28],
    ["dry-grass", 5, 158, 38, 27, 0.28],
    ["sand-pebbles", 53, 161, 38, 24, 0.22],
    ["desert-sprig", 101, 160, 38, 25, 0.27],
    ["dry-twigs", 149, 161, 38, 24, 0.22],
  ] as const
).map(([key, x, y, width, height, renderScale]) => ({
  key: `ground-detail.${key}`,
  filepath: "/world-art/ground-details.webp",
  frame: { x, y, width, height },
  renderScale,
  shadow: 0,
  small: true,
  windAffected: [
    "grass",
    "fern",
    "flowers",
    "snow-grass",
    "snow-juniper",
    "dry-grass",
    "desert-sprig",
  ].includes(key),
}));
const groundDetailByKey = new Map(GROUND_DETAIL_ART.map((asset) => [asset.key, asset]));
const groundDetails = (keys: string[]) =>
  keys.map((key) => {
    const asset = groundDetailByKey.get(`ground-detail.${key}`);
    if (!asset) throw new Error(`Unknown ground detail ${key}`);
    return asset;
  });
export const WORLD_UNDERSTORY = {
  ground: groundDetails([
    "grass",
    "fern",
    "moss",
    "leaves",
    "twigs",
    "pebbles",
    "flowers",
    "roots",
  ]),
  snow: groundDetails(["snow-grass", "snow-pebbles", "snow-needles", "snow-juniper"]),
  dessert: groundDetails(["dry-grass", "sand-pebbles", "desert-sprig", "dry-twigs"]),
};
const stockGroundDetailArt = (key: string, biome?: CombatBiome) => {
  const index = ["grass.tuft", "grass.sprout", "grass.flower", "grass.pebble"].indexOf(
    key,
  );
  if (index < 0) return undefined;
  const palette =
    biome === "dessert"
      ? ["dry-grass", "desert-sprig", "desert-sprig", "sand-pebbles"]
      : biome === "snow" || biome === "ice"
        ? ["snow-grass", "snow-juniper", "snow-juniper", "snow-pebbles"]
        : ["grass", "fern", "flowers", "pebbles"];
  return groundDetailByKey.get(`ground-detail.${palette[index]}`);
};
const stockDecorationArt: Record<string, string> = {
  "tree.green.round": "woodland.oak",
  "tree.green.tall": "woodland.cedar",
  "tree.green.wide": "woodland.golden-tree",
};

/** Skin bundled scenery while retaining authored sizes and creator-supplied replacements. */
export const resolveWorldDecoration = (
  asset: DecorationAsset,
  biome?: CombatBiome,
): DecorationAsset => {
  const replacement =
    stockGroundDetailArt(asset.key, biome) ??
    (biome === "dessert" ? desertRockArt.get(asset.key) : undefined) ??
    biomeByKey.get(asset.key) ??
    woodlandByKey.get(stockDecorationArt[asset.key] ?? "");
  if (
    !replacement ||
    asset.filepath !== DECORATION_ASSETS_BY_KEY.get(asset.key)?.filepath
  )
    return asset;
  return {
    ...asset,
    filepath: replacement.filepath,
    frame: replacement.frame,
    shadow: replacement.shadow ?? 0,
    heightScale: DECORATION_HEIGHTS[asset.key] ?? 1.2,
    windAffected: replacement.windAffected ?? asset.key.startsWith("tree."),
    randomRotation: false,
  };
};

const DECORATION_HEIGHTS: Record<string, number> = {
  "grass.tuft": 0.28,
  "grass.sprout": 0.34,
  "grass.flower": 0.3,
  "grass.pebble": 0.22,
  "cactus.saguaro": 1.2,
  "cactus.barrel": 0.45,
  "cactus.cluster": 0.7,
  "rock.sand": 0.4,
  "rock.grey": 0.35,
  "rock.slate": 0.45,
  "ice.floe": 0.4,
};

/** The shared depth material applies only to the bundled ocean palette and texture. */
export const hasWorldWaterDepth = (spec: TerrainSpec | undefined) =>
  !!spec &&
  spec.key === "ocean" &&
  spec.colors.join(",").toLowerCase() === STOCK_TERRAIN_COLORS.ocean?.source &&
  spec.textureUrl === BUILTIN_TERRAINS_BY_KEY.get("ocean")?.textureUrl;

/** Stock materials share the scenery palette; custom terrain colors remain authoritative. */
export const resolveWorldTerrain = (spec: TerrainSpec) => {
  const stock = STOCK_TERRAIN_COLORS[spec.key];
  return stock && spec.colors.join(",").toLowerCase() === stock.source
    ? {
        ...spec,
        colors: stock.colors,
        depression:
          spec.key === "ocean" ? 0.18 : spec.key === "ice" ? 0 : spec.depression,
      }
    : spec;
};

const STOCK_TERRAIN_COLORS: Record<
  string,
  { source: string; colors: [string, string, string] }
> = {
  ground: {
    source: "#48bd48,#37aa37,#239623",
    colors: ["#7f9455", "#788d50", "#657b49"],
  },
  ocean: {
    source: "#184695,#1c54b5,#2767d7",
    colors: ["#658a85", "#5b807e", "#4d7277"],
  },
  dessert: {
    source: "#f9e79f,#fad7a0,#f5cba7",
    colors: ["#cfb787", "#c3a977", "#b6a06f"],
  },
  ice: { source: "#9febf7,#89cde0,#98dfe8", colors: ["#b0cdd4", "#aac8d0", "#9ebec9"] },
  snow: {
    source: "#ffffff,#eeeeee,#fefefe",
    colors: ["#cedcde", "#c6d6d9", "#b7cbd0"],
  },
};

/** Landmark planting and street materials distinguish settlements without altering their entrances. */
export const VILLAGE_ART: Record<number, VillageArt> = {
  724: {
    understory: ["#847955", "#7c7252", "#72694b"],
    court: ["#bfc0aa", "#b6b79f", "#acae98"],
    grove: "woodland.cedar",
    garden: ["woodland.torii", "woodland.flower-bush", "woodland.lantern"],
    roads: ["#b09f74", "#a7966a", "#9d8c61"],
  },
  1490: {
    understory: ["#75816a", "#6d7962", "#64705c"],
    court: ["#b2bdb4", "#a7b3ab", "#9eaaa2"],
    grove: "woodland.bamboo",
    garden: ["woodland.bamboo", "woodland.rocks", "woodland.lantern"],
    roads: ["#b0b4a3", "#a6ad9e", "#9ca493"],
  },
  555: {
    shrinePrecinct: true,
    understory: ["#8b8160", "#847a5b", "#797252"],
    court: ["#c8bb9d", "#bfb193", "#b5a88c"],
    grove: "woodland.golden-tree",
    garden: ["woodland.flower-bush", "woodland.fence", "woodland.lantern"],
    roads: ["#c5b38b", "#bda780", "#b2a077"],
  },
  301: {
    understory: ["#7c8065", "#74785e", "#6b7055"],
    court: ["#b4b0a0", "#aaa796", "#a09f8d"],
    grove: "woodland.cedar",
    garden: ["woodland.rocks", "woodland.bamboo", "woodland.fence"],
    roads: ["#a49270", "#9a8968", "#91815f"],
  },
  222: {
    submergedShelf: [3, 4],
    understory: ["#8d8967", "#847f60", "#797559"],
    court: ["#c4b89c", "#bcae93", "#b1a389"],
    garden: ["woodland.torii", "woodland.flower-bush", "world.reeds"],
    roads: ["#b9ad8b", "#b0a481", "#a39876"],
  },
  1335: {
    understory: ["#737d69", "#6b7562", "#626d5b"],
    court: ["#bdaf99", "#b2a690", "#a79b87"],
    garden: ["world.reeds", "woodland.rocks", "woodland.lantern"],
    roads: ["#b8a685", "#af9e7d", "#a69576"],
  },
  177: {
    court: ["#b6c0c0", "#aab7b9", "#a1afb1"],
    garden: ["tree.snow.pine", "ice.floe", "ice.floe"],
    roads: ["#a8b0af", "#9ea8a8", "#939f9f"],
  },
  1538: {
    court: ["#c9b18f", "#bea784", "#b59d7a"],
    garden: ["cactus.saguaro", "cactus.barrel", "rock.sand"],
    roads: ["#b9a17d", "#b09874", "#a58e6c"],
  },
  1062: {
    court: ["#bba88e", "#b4a085", "#aa947c"],
    garden: ["rock.slate", "cactus.cluster", "cactus.barrel"],
    roads: ["#9d8873", "#947e6a", "#8c7663"],
  },
  352: {
    understory: ["#897c63", "#80735b", "#756a53"],
    court: ["#b7b6a7", "#aaa99b", "#a19f91"],
    grove: "woodland.cedar",
    garden: ["woodland.tea-house", "woodland.rocks", "world.reeds"],
    roads: ["#a4957e", "#9b8b73", "#91826c"],
  },
};

type VillageArt = {
  /** A stock-water formation in a village's quiet coastal cove. */
  submergedShelf?: readonly [number, number];
  grove?: string;
  shrinePrecinct?: boolean;
  understory?: readonly [string, string, string];
  garden: readonly [string, string, string];
  roads: readonly [string, string, string];
  court: readonly [string, string, string];
};
