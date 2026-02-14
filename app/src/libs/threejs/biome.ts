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
import type { CombatBiome, HEXTILE_TYPE } from "@/drizzle/constants";
import {
  ASSETS_LAYER,
  COMBAT_BIOMES,
  IMG_BG_ICE,
  IMG_BG_OCEAN,
  IMG_BG_SNOW,
} from "@/drizzle/constants";
import { applyWindShader } from "@/libs/threejs/shaders";
import type { GlobalTile } from "@/libs/threejs/types";
import { createSpriteMaterial, loadTexture } from "@/libs/threejs/util";
import { getBiomeFromGlobalTile } from "@/libs/travel";
import type { TerrainHex } from "../hexgrid";

/**
 * Map materials & colors
 */
export const groundColors = [0x48bd48, 0x37aa37, 0x239623] as const;

export const oceanColors = [0x184695, 0x1c54b5, 0x2767d7] as const;

export const dessertColors = [0xf9e79f, 0xfad7a0, 0xf5cba7] as const;

export const iceColors = [0x9febf7, 0x89cde0, 0x98dfe8] as const;

export const snowColors = [0xffffff, 0xeeeeee, 0xfefefe] as const;

/**
 * Helper function to create textured materials from colors and texture URL
 * Adds subtle lightness variation for variety
 * Falls back to simple color materials on server-side (no window)
 */
const createTexturedMaterials = (colors: readonly number[], textureUrl: string) => {
  // Fallback to simple materials on server-side where window is not available
  if (typeof window === "undefined") {
    return colors.map((color) => new MeshBasicMaterial({ color }));
  }

  return colors.map((color) => {
    const texture = loadTexture(textureUrl);
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.repeat.set(1, 1);
    return new MeshBasicMaterial({ color: color, map: texture, combine: AddOperation });
  });
};

/**
 * Helper function to create textured materials from colors and texture URL
 * Adds subtle lightness variation for variety
 * Falls back to simple color materials on server-side (no document)
 */
const createNoisedMaterials = (colors: readonly number[]) => {
  // Fallback to simple materials on server-side where document is not available
  if (typeof document === "undefined") {
    return colors.map((color) => new MeshBasicMaterial({ color }));
  }

  return colors.map((color) => {
    // Create a small canvas for the noisy texture
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return new MeshBasicMaterial({ color });
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

    return new MeshBasicMaterial({ color, map: texture, combine: AddOperation });
  });
};

/**
 * Helper function to create light (color-only) materials
 */
const createLightMaterials = (colors: readonly number[]) => {
  return colors.map((color) => new MeshBasicMaterial({ color }));
};

export const groundMats = createNoisedMaterials(groundColors);
export const groundMatsLight = createLightMaterials(groundColors);

export const oceanMats = createTexturedMaterials(oceanColors, IMG_BG_OCEAN);
export const oceanMatsLight = createLightMaterials(oceanColors);

export const dessertMats = createNoisedMaterials(dessertColors);
export const dessertMatsLight = createLightMaterials(dessertColors);

export const iceMats = createTexturedMaterials(iceColors, IMG_BG_ICE);
export const iceMatsLight = createLightMaterials(iceColors);

export const snowMats = createTexturedMaterials(snowColors, IMG_BG_SNOW);
export const snowMatsLight = createLightMaterials(snowColors);

interface TileInfo {
  material: MeshBasicMaterial;
  dirt: MeshBasicMaterial;
  sprites: Sprite[];
  asset: HEXTILE_TYPE;
}

export const getDirtMaterial = (_tileType: HEXTILE_TYPE) => {
  return new MeshBasicMaterial({ color: 0x696969, side: DoubleSide });
};

export const getTileInfo = (
  prng: () => number,
  hex: TerrainHex,
  tile: GlobalTile | CombatBiome,
  lightLayout = false,
) => {
  const material = getMaterial(hex, tile, lightLayout);
  material.sprites = getMapSprites(prng, material.asset, hex);
  material.dirt = getDirtMaterial(material.asset);
  return material;
};

export const getMapSprites = (
  prng: () => number,
  asset: HEXTILE_TYPE,
  hex: TerrainHex,
) => {
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

const loadSectorAsset = (
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
      material = new SpriteMaterial({
        map: texture,
        alphaTest: 0.5,
      });
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
  // Some cleanup for which assets to return based on state
  const oceanMatsToUse = lightLayout ? oceanMatsLight : oceanMats;
  const groundMatsToUse = lightLayout ? groundMatsLight : groundMats;
  const dessertMatsToUse = lightLayout ? dessertMatsLight : dessertMats;
  const iceMatsToUse = lightLayout ? iceMatsLight : iceMats;
  const snowMatsToUse = lightLayout ? snowMatsLight : snowMats;
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
      return { color: oceanColors[0] };
    case "dessert":
      return { color: dessertColors[2] };
    case "ice":
    case "snow":
      return { color: iceColors[2] };
    case "ground":
      return { color: groundColors[1] };
  }
  return { color: groundColors[1] };
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
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJa55Vc5YYfKMcJ2B5EmWt6VsNgqxpG8OSXAQk",
    chance: 0.5,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    windAffected: true,
    small: true,
  },
  {
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJlvcZlIrWYxAsuC7ofQn9pM45OD0ERqkdBXJU",
    chance: 0.3,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    windAffected: true,
    small: true,
  },
  {
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJcpFFdRSnxBpQqGNDcTHbLmYz8uXAl3oa54ti",
    chance: 0.1,
    scale: 0.7,
    scaleVariation: 0.2,
    posVariation: 0.25,
    windAffected: true,
    small: true,
  },
  {
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJxfrF3oWZsq9k0Von5rUfP6OgQ2TyptCKHS4u",
    chance: 0.1,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    windAffected: false,
    small: true,
  },
  // Green Trees
  {
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJndYwvrmojJ0EqeDCvBrNmZaXVdY97gSpOWiA",
    chance: 0.7,
    scale: 2,
    scaleVariation: 0.7,
    posVariation: 0.25,
    windAffected: true,
  },
  {
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJvFn4sIEmSnXwslYEpV1yOeNL8gMtqhjPdf36",
    chance: 0.7,
    scale: 2,
    scaleVariation: 0.7,
    posVariation: 0.25,
    windAffected: true,
  },
  {
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJHl8NCiQvYURJhgs76VZtf9wxpMa13Cq0iOnr",
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
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJe0aIBjyV3OvUJQExAi0bGoIZDF74LqSnHRdp",
    chance: 0.1,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    windAffected: true,
  },
  {
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ7vgcu3XKPBOUWGyFuM4DlL1v5HNTZhkte0z6",
    chance: 0.1,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    windAffected: true,
  },
  {
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJvmatJJEmSnXwslYEpV1yOeNL8gMtqhjPdf36",
    chance: 0.1,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    windAffected: true,
  },
  // Stones
  {
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJQlUKaJVjhzBPya1rwfCIqOTU0cV5xgsMeo3u",
    chance: 0.2,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    small: true,
  },
  {
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJzLLsgkemvaQu94EYJs8HpxVzofny6iPtbgCZ",
    chance: 0.1,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    small: true,
  },
  {
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJylERmDukVH2MI5Lo4ehEfAXvZdcmtWqPg7rp",
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
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJzJ76QEemvaQu94EYJs8HpxVzofny6iPtbgCZ",
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
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJzLLsgkemvaQu94EYJs8HpxVzofny6iPtbgCZ",
    chance: 0.1,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    small: true,
  },
  {
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJylERmDukVH2MI5Lo4ehEfAXvZdcmtWqPg7rp",
    chance: 0.1,
    scale: 1,
    scaleVariation: 0.2,
    posVariation: 0.25,
    small: true,
  },
  // Green Trees
  {
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJrtEwSR2huJPmdY8zI2ptZXAoEj1c6BMKvrQO",
    chance: 0.4,
    scale: 2,
    scaleVariation: 0.7,
    posVariation: 0.25,
    windAffected: true,
  },
];

// Ocean assets settings default
export const OCEAN_ASSET_PROPS: AssetType[] = [];

/**
 * Generates wall placements forming a rectangular perimeter around the village
 * with a one-tile padding from the grid edges.
 *
 * @param sectorWidth - Width of the sector
 * @param sectorHeight - Height of the sector
 * @returns Array of {x, y} coordinates for wall placements
 */
export const generateWallPlacements = (sectorWidth: number, sectorHeight: number) => {
  const wallPlacements: Array<{ x: number; y: number }> = [];
  const padding = 1;

  // Define the boundaries with padding
  const minCol = padding;
  const maxCol = sectorWidth - padding - 1;
  const minRow = padding;
  const maxRow = sectorHeight - padding - 1;

  // Trace the rectangular perimeter
  // Top edge (left to right, excluding last corner)
  for (let col = minCol; col < maxCol; col++) {
    wallPlacements.push({ x: col, y: minRow });
  }

  // Right edge (top to bottom, excluding last corner)
  for (let row = minRow; row < maxRow; row++) {
    wallPlacements.push({ x: maxCol, y: row });
  }

  // Bottom edge (right to left, excluding last corner)
  for (let col = maxCol; col > minCol; col--) {
    wallPlacements.push({ x: col, y: maxRow });
  }

  // Left edge (bottom to top, closing the loop)
  for (let row = maxRow; row >= minRow; row--) {
    wallPlacements.push({ x: minCol, y: row });
  }

  return wallPlacements;
};
