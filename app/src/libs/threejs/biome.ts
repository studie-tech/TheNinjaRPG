import {
  AddOperation,
  DoubleSide,
  MeshBasicMaterial,
  RepeatWrapping,
  Sprite,
  SpriteMaterial,
  Texture,
  Vector3,
} from "three";
import type { CombatBiome } from "@/drizzle/constants";
import { ASSETS_LAYER, COMBAT_BIOMES } from "@/drizzle/constants";
import { DECORATION_ASSETS_BY_KEY } from "@/libs/sector-map/decorations";
import type { TerrainSpec } from "@/libs/sector-map/terrains";
import { BUILTIN_TERRAINS_BY_KEY } from "@/libs/sector-map/terrains";
import { applyWindShader } from "@/libs/threejs/shaders";
import type { GlobalTile } from "@/libs/threejs/types";
import { createSpriteMaterial, loadTexture } from "@/libs/threejs/util";
import { getBiomeFromGlobalTile } from "@/libs/travel";
import type { TerrainHex } from "../hexgrid";

/** Single source of truth for scenery sprite art: the decoration registry */
const decorationFilepath = (key: string) => {
  const asset = DECORATION_ASSETS_BY_KEY.get(key);
  if (!asset) throw new Error(`Unknown decoration asset ${key}`);
  return asset.filepath;
};

/** Parse a "#rrggbb" registry color into a three.js color int */
const hexToInt = (hex: string, fallback = 0x37aa37) => {
  const parsed = Number.parseInt(hex.replace("#", ""), 16);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Helper function to create textured materials from colors and texture URL
 * Adds subtle lightness variation for variety
 * Falls back to simple color materials on server-side (no window)
 */
const createTexturedMaterials = (colors: readonly number[], textureUrl: string) => {
  // Fallback to simple materials on server-side where window is not available
  if (typeof window === "undefined") {
    return colors.map((color) => markShared(new MeshBasicMaterial({ color })));
  }

  return colors.map((color) => {
    const texture = loadTexture(textureUrl);
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.repeat.set(1, 1);
    return markShared(
      new MeshBasicMaterial({ color: color, map: texture, combine: AddOperation }),
    );
  });
};

/** Module-level palette materials are shared; per-sector disposal skips them */
const markShared = <T extends MeshBasicMaterial | SpriteMaterial>(material: T): T => {
  material.userData.shared = true;
  return material;
};

/**
 * Helper function to create textured materials from colors and texture URL
 * Adds subtle lightness variation for variety
 * Falls back to simple color materials on server-side (no document)
 */
const createNoisedMaterials = (colors: readonly number[]) => {
  // Fallback to simple materials on server-side where document is not available
  if (typeof document === "undefined") {
    return colors.map((color) => markShared(new MeshBasicMaterial({ color })));
  }

  return colors.map((color) => {
    // Create a small canvas for the noisy texture
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return markShared(new MeshBasicMaterial({ color }));
    }
    // Fill with solid color
    ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
    ctx.fillRect(0, 0, size, size);

    // Add random noise
    const imageData = ctx.getImageData(0, 0, size, size);
    for (let i = 0; i < size * size * 4; i += 4) {
      const noise = Math.floor(Math.random() * 32) - 16; // -16 to +15
      const r = imageData.data[i];
      const g = imageData.data[i + 1];
      const b = imageData.data[i + 2];
      if (r !== undefined) imageData.data[i] = Math.min(255, Math.max(0, r + noise));
      if (g !== undefined)
        imageData.data[i + 1] = Math.min(255, Math.max(0, g + noise));
      if (b !== undefined)
        imageData.data[i + 2] = Math.min(255, Math.max(0, b + noise));
      // alpha (i+3) remains unchanged (255)
    }
    ctx.putImageData(imageData, 0, 0);

    const texture = new Texture(canvas);
    texture.needsUpdate = true;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.repeat.set(1, 1);

    return markShared(
      new MeshBasicMaterial({ color, map: texture, combine: AddOperation }),
    );
  });
};

/**
 * Helper function to create light (color-only) materials
 */
const createLightMaterials = (colors: readonly number[]) => {
  return colors.map((color) => markShared(new MeshBasicMaterial({ color })));
};

/** Full and light (color-only) material variants for one terrain look */
export interface TerrainMaterialSet {
  variants: MeshBasicMaterial[];
  lightVariants: MeshBasicMaterial[];
}

const terrainMaterialCache = new Map<string, TerrainMaterialSet>();
// Identity fast-path: within a window the same TerrainSpec object is resolved
// once per tile (~676x per sector), so cache by object identity to skip
// rebuilding the string cache key (a spread + join allocation) on every tile.
// A registry rebuild yields fresh spec objects, so this never serves stale art.
const terrainMaterialBySpec = new WeakMap<TerrainSpec, TerrainMaterialSet>();

/**
 * Builds terrain materials on demand from a TerrainSpec (the content-managed
 * terrain library). Cached by look (key + colors + textureUrl) so every sector
 * in the 3x3 window shares one material set per terrain — keeping geometry
 * merging effective — while an admin color/texture edit naturally yields a
 * fresh set. Textured variants when spec.textureUrl is set, noised canvas
 * variants otherwise; all materials are marked userData.shared so per-sector
 * disposal skips them.
 */
export const getTerrainMaterials = (spec: TerrainSpec): TerrainMaterialSet => {
  const identityHit = terrainMaterialBySpec.get(spec);
  if (identityHit) return identityHit;
  const cacheKey = [spec.key, ...spec.colors, spec.textureUrl ?? ""].join("|");
  const cached = terrainMaterialCache.get(cacheKey);
  if (cached) {
    terrainMaterialBySpec.set(spec, cached);
    return cached;
  }
  const colors = spec.colors.map(hexToInt);
  const set: TerrainMaterialSet = {
    variants: spec.textureUrl
      ? createTexturedMaterials(colors, spec.textureUrl)
      : createNoisedMaterials(colors),
    lightVariants: createLightMaterials(colors),
  };
  terrainMaterialCache.set(cacheKey, set);
  terrainMaterialBySpec.set(spec, set);
  return set;
};

/** Built-in terrain materials for the combat/tower-defense arena backgrounds */
const builtinMaterials = (key: string, lightLayout: boolean) => {
  const spec = BUILTIN_TERRAINS_BY_KEY.get(key);
  if (!spec) throw new Error(`Unknown built-in terrain ${key}`);
  const set = getTerrainMaterials(spec);
  return lightLayout ? set.lightVariants : set.variants;
};

/** Built-in spec colors as ints, for background-color lookups */
const builtinColors = (key: string) => {
  const spec = BUILTIN_TERRAINS_BY_KEY.get(key);
  if (!spec) throw new Error(`Unknown built-in terrain ${key}`);
  return spec.colors.map(hexToInt) as [number, number, number];
};

export const roadColors = [0xa98e62, 0x9d8156, 0x8f744c] as const;
export const roadMats = createNoisedMaterials(roadColors);
export const roadMatsLight = createLightMaterials(roadColors);

export const shoreColors = [0xf2e2a4, 0xe6d190, 0xd8bf7d] as const;
export const shoreMats = createNoisedMaterials(shoreColors);
export const shoreMatsLight = createLightMaterials(shoreColors);

interface TileInfo {
  material: MeshBasicMaterial;
  dirt: MeshBasicMaterial;
  sprites: Sprite[];
  asset: string;
}

/** Flat dirt-colored fill rendered beneath the hex tiles */
export const getDirtMaterial = () => {
  return new MeshBasicMaterial({ color: 0x696969, side: DoubleSide });
};

/**
 * Material for one authored sector tile: the terrain's own shades only (light
 * or mid picked by noise; the dark shade marks blocked land so thickets and
 * rocks read as impassable). Water stays in its regular shades when blocked -
 * a lake is water, not a rock.
 */
export const getAuthoredTileMaterial = (
  hex: TerrainHex,
  spec: TerrainSpec,
  blocked: boolean,
  lightLayout = false,
) => {
  const set = getTerrainMaterials(spec);
  const mats = lightLayout ? set.lightVariants : set.variants;
  const variant = blocked && !spec.isWater ? 2 : hex.level < 0.5 ? 0 : 1;
  return {
    material: mats[variant] ?? mats[0],
    asset: spec.key,
  } as TileInfo;
};

export const getTileInfo = (
  prng: () => number,
  hex: TerrainHex,
  tile: GlobalTile | CombatBiome,
  lightLayout = false,
) => {
  const material = getMaterial(hex, tile, lightLayout);
  material.sprites = getMapSprites(prng, material.asset, hex);
  material.dirt = getDirtMaterial();
  return material;
};

/**
 * Seeded decoration sprites for one hex on the procedural render path (combat
 * arenas): sprite art derives from the asset set and the tile's cost band.
 */
export const getMapSprites = (prng: () => number, asset: string, hex: TerrainHex) => {
  const sprites: Sprite[] = [];
  // Fetch tile sprite
  let cost = hex.cost;
  const rand = prng();
  let sprite = null;
  let assets = null;
  if (asset === "ground") {
    assets = GROUND_ASSETS_PROPS;
    cost += 1;
  } else if (asset === "dessert") {
    assets = DESSERT_ASSET_PROPS;
    cost += 1;
  } else if (asset === "ice") {
    assets = ICE_ASSET_PROPS;
    cost += 1;
  } else if (asset === "snow") {
    assets = SNOW_ASSET_PROPS;
    cost += 1;
  } else {
    assets = OCEAN_ASSET_PROPS;
    cost += 5;
  }
  const posibleAssets = assets?.filter((asset) => {
    return rand < asset.chance;
  });
  const sortedAssets = posibleAssets.sort((a, b) =>
    Math.abs(b.scale / 2 - hex.assetStrength + prng() / 10) <
    Math.abs(a.scale / 2 - hex.assetStrength + prng() / 10)
      ? 1
      : -1,
  );
  const selectedAsset = sortedAssets?.[0];
  if (selectedAsset) {
    const scale = selectedAsset?.scale || 1;
    const sizeVariation = selectedAsset?.scaleVariation || 0;
    const posVariation = selectedAsset?.posVariation || 0;
    const size = scale + sizeVariation * (prng() - 0.5);
    const { height: h, width: w } = hex;
    const { x, y } = hex.center;
    const posX = -x + w / 2 + w * posVariation * (prng() - 0.5);
    const posY = -y + (size * h) / 2 + 0.1 * h * size;
    sprite = loadSectorAsset(
      selectedAsset.filepath,
      rand,
      selectedAsset.windAffected,
      selectedAsset.randomRotation,
    );
    Object.assign(sprite.scale, new Vector3(size * h, size * h, 1));
    Object.assign(sprite.position, new Vector3(posX, posY, ASSETS_LAYER));

    // Mark sprite as small if asset is small
    sprite.userData.small = selectedAsset.small === true;
    sprites.push(sprite);
  }
  hex.cost = cost;
  // Sort so the ones with the highest y's are last
  sprites.sort((a, b) => a.position.y - b.position.y);
  // Return sprite
  return sprites;
};

// Performance optimization: Cache materials for wind-affected assets to allow sharing
const windMaterialCache = new Map<string, MeshBasicMaterial | SpriteMaterial>();

/**
 * Sprite for a decoration image. Wind-affected decorations use the cached
 * wind-shader material (shared across sectors, so disposal must skip it);
 * `rand` drives the deterministic rotation variant when randomRotation is set.
 */
export const loadSectorAsset = (
  filepath: string,
  rand: number,
  windAffected?: boolean | null,
  randomRotation?: boolean,
) => {
  const texture = loadTexture(filepath);

  let material: SpriteMaterial;

  if (windAffected) {
    // Use one of 8 wind variants to allow material sharing while maintaining desynchronization
    const numVariants = 4;
    const variantIndex = Math.floor(rand * numVariants);
    const variantOffset = (variantIndex / numVariants) * Math.PI * 2;
    const cacheKey = `${filepath}-wind-${variantIndex}`;

    const cached = windMaterialCache.get(cacheKey) as SpriteMaterial | undefined;
    if (cached) {
      material = cached;
    } else {
      // Create a fresh material for this variant
      // We don't use the standard createSpriteMaterial here because we're modifying it
      material = markShared(
        new SpriteMaterial({
          map: texture,
          alphaTest: 0.5,
        }),
      );
      applyWindShader(material, variantOffset);
      windMaterialCache.set(cacheKey, material);
    }
  } else {
    // For non-wind assets, use standard sharing
    material = createSpriteMaterial(texture);
  }

  const sprite = new Sprite(material);

  // Apply random rotation if specified
  if (randomRotation) {
    // PERFORMANCE OPTIMIZATION: Store rotation in userData to be used by InstancedMesh
    // This avoids cloning materials just for rotation
    sprite.userData.rotation = rand * Math.PI * 2;
  }

  return sprite;
};

/**
 * Returns the material for a given hexagon and tile
 * @param hex - The hexagon to get the material for
 * @param tile - The tile to get the material for
 * @param lightLayout - Whether to use the light layout
 * @returns The material for the given hexagon and tile
 */
const getMaterial = (
  hex: TerrainHex,
  tile: GlobalTile | CombatBiome,
  lightLayout = false,
) => {
  // Arena backgrounds always render from the built-in terrain looks (battle
  // backgrounds are a closed enum; creator terrains map onto them via their
  // battleBiome field)
  const oceanMatsToUse = builtinMaterials("ocean", lightLayout);
  const groundMatsToUse = builtinMaterials("ground", lightLayout);
  const dessertMatsToUse = builtinMaterials("dessert", lightLayout);
  const iceMatsToUse = builtinMaterials("ice", lightLayout);
  const snowMatsToUse = builtinMaterials("snow", lightLayout);
  const biome: CombatBiome =
    typeof tile === "object"
      ? getBiomeFromGlobalTile(tile)
      : COMBAT_BIOMES.find((a) => a === tile)
        ? (tile as CombatBiome)
        : "default";

  // Handle material choice based on levels
  switch (biome) {
    case "ocean":
      if (hex.level < 0.3) {
        return { material: oceanMatsToUse[0], asset: "ocean" } as TileInfo;
      } else if (hex.level < 0.6) {
        return { material: oceanMatsToUse[1], asset: "ocean" } as TileInfo;
      } else if (hex.level < 0.8) {
        return { material: oceanMatsToUse[2], asset: "ocean" } as TileInfo;
      } else if (hex.level < 0.85) {
        return { material: dessertMatsToUse[0], asset: "dessert" } as TileInfo;
      } else if (hex.level < 0.9) {
        return { material: dessertMatsToUse[1], asset: "dessert" } as TileInfo;
      } else if (hex.level < 0.95) {
        return { material: dessertMatsToUse[2], asset: "dessert" } as TileInfo;
      } else {
        return { material: groundMatsToUse[2], asset: "ground" } as TileInfo;
      }
    case "ground":
    case "default":
    case "arena":
      if (hex.level < 0.05) {
        return { material: oceanMatsToUse[0], asset: "ocean" } as TileInfo;
      } else if (hex.level < 0.1) {
        return { material: oceanMatsToUse[1], asset: "ocean" } as TileInfo;
      } else if (hex.level < 0.15) {
        return { material: oceanMatsToUse[2], asset: "ocean" } as TileInfo;
      } else if (hex.level < 0.2) {
        return { material: groundMatsToUse[2], asset: "ground" } as TileInfo;
      } else if (hex.level < 0.5) {
        return { material: groundMatsToUse[1], asset: "ground" } as TileInfo;
      } else if (hex.level < 0.8) {
        return { material: groundMatsToUse[0], asset: "ground" } as TileInfo;
      } else if (hex.level < 0.9) {
        return { material: dessertMatsToUse[0], asset: "dessert" } as TileInfo;
      } else if (hex.level < 0.95) {
        return { material: dessertMatsToUse[1], asset: "dessert" } as TileInfo;
      } else {
        return { material: dessertMatsToUse[2], asset: "dessert" } as TileInfo;
      }
    case "dessert":
      if (hex.level < 0.05) {
        return { material: oceanMatsToUse[2], asset: "ocean" } as TileInfo;
      } else if (hex.level < 0.1) {
        return { material: groundMatsToUse[2], asset: "ground" } as TileInfo;
      } else if (hex.level < 0.3) {
        return { material: dessertMatsToUse[0], asset: "dessert" } as TileInfo;
      } else if (hex.level < 0.6) {
        return { material: dessertMatsToUse[1], asset: "dessert" } as TileInfo;
      } else {
        return { material: dessertMatsToUse[2], asset: "dessert" } as TileInfo;
      }
    case "ice":
    case "snow":
      if (hex.level < 0.05) {
        return { material: oceanMatsToUse[2], asset: "ocean" } as TileInfo;
      } else if (hex.level < 0.1) {
        return { material: iceMatsToUse[0], asset: "ice" } as TileInfo;
      } else if (hex.level < 0.2) {
        return { material: iceMatsToUse[1], asset: "ice" } as TileInfo;
      } else if (hex.level < 0.25) {
        return { material: iceMatsToUse[2], asset: "ice" } as TileInfo;
      } else if (hex.level < 0.3) {
        return { material: snowMatsToUse[0], asset: "snow" } as TileInfo;
      } else if (hex.level < 0.6) {
        return { material: snowMatsToUse[1], asset: "snow" } as TileInfo;
      } else {
        return { material: snowMatsToUse[2], asset: "snow" } as TileInfo;
      }
  }
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

export type AssetType = {
  filepath: string;
  chance: number;
  scale: number;
  scaleVariation?: number;
  posVariation?: number;
  windAffected?: boolean;
  small?: true;
  randomRotation?: boolean;
};

// Ground assets settings default
export const GROUND_ASSETS_PROPS: AssetType[] = [
  // Small assets
  {
    filepath: decorationFilepath("grass.tuft"),
    chance: 0.5,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    windAffected: true,
    small: true,
  },
  {
    filepath: decorationFilepath("grass.sprout"),
    chance: 0.3,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    windAffected: true,
    small: true,
  },
  {
    filepath: decorationFilepath("grass.flower"),
    chance: 0.1,
    scale: 0.7,
    scaleVariation: 0.2,
    posVariation: 0.25,
    windAffected: true,
    small: true,
  },
  {
    filepath: decorationFilepath("grass.pebble"),
    chance: 0.1,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    windAffected: false,
    small: true,
  },
  // Green Trees
  {
    filepath: decorationFilepath("tree.green.round"),
    chance: 0.7,
    scale: 2,
    scaleVariation: 0.7,
    posVariation: 0.25,
    windAffected: true,
  },
  {
    filepath: decorationFilepath("tree.green.tall"),
    chance: 0.7,
    scale: 2,
    scaleVariation: 0.7,
    posVariation: 0.25,
    windAffected: true,
  },
  {
    filepath: decorationFilepath("tree.green.wide"),
    chance: 0.5,
    scale: 2,
    scaleVariation: 0.7,
    posVariation: 0.25,
    windAffected: true,
  },
];

// Dessert assets settings default
export const DESSERT_ASSET_PROPS: AssetType[] = [
  // Cactus
  {
    filepath: decorationFilepath("cactus.saguaro"),
    chance: 0.1,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    windAffected: true,
  },
  {
    filepath: decorationFilepath("cactus.barrel"),
    chance: 0.1,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    windAffected: true,
  },
  {
    filepath: decorationFilepath("cactus.cluster"),
    chance: 0.1,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    windAffected: true,
  },
  // Stones
  {
    filepath: decorationFilepath("rock.sand"),
    chance: 0.2,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    small: true,
  },
  {
    filepath: decorationFilepath("rock.grey"),
    chance: 0.1,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    small: true,
  },
  {
    filepath: decorationFilepath("rock.slate"),
    chance: 0.1,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    small: true,
  },
];

// Dessert assets settings default
export const ICE_ASSET_PROPS: AssetType[] = [
  {
    filepath: decorationFilepath("ice.floe"),
    chance: 0.1,
    scale: 0.9,
    scaleVariation: 0.2,
    posVariation: 0.25,
    small: true,
    randomRotation: true,
  },
];

// Dessert assets settings default
export const SNOW_ASSET_PROPS: AssetType[] = [
  // Stones
  {
    filepath: decorationFilepath("rock.grey"),
    chance: 0.1,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    small: true,
  },
  {
    filepath: decorationFilepath("rock.slate"),
    chance: 0.1,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    small: true,
  },
  // Green Trees
  {
    filepath: decorationFilepath("tree.snow.pine"),
    chance: 0.4,
    scale: 2,
    scaleVariation: 0.7,
    posVariation: 0.25,
    windAffected: true,
  },
];

// Ocean assets settings default
export const OCEAN_ASSET_PROPS: AssetType[] = [];
