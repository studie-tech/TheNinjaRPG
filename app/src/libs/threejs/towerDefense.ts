import alea from "alea";
import { Grid, Orientation, rectangle, ring } from "honeycomb-grid";
import { createNoise2D } from "simplex-noise";
import type { BufferGeometry } from "three";
import {
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Mesh,
  Object3D,
  Sprite,
  SpriteMaterial,
  BufferGeometry as ThreeBufferGeometry,
  MeshBasicMaterial as ThreeMeshBasicMaterial,
} from "three";
import type { CombatBiome } from "@/drizzle/constants";
import {
  ASSETS_LAYER,
  DIRT_LAYER,
  HEX_ASPECT_RATIO,
  STATUS_LAYER,
  TD_RANGE_VISUAL_FACTOR,
  TILES_LAYER,
  USER_LAYER,
} from "@/drizzle/constants";
import { getTileInfo } from "@/libs/threejs/biome";
import {
  type AnimationState,
  type CharacterAssetConfig,
  type FrameAnimator,
  HEAVY_ENEMY_ASSET_CONFIG,
  LIGHT_ENEMY_ASSET_CONFIG,
  PLAYER_ASSET_CONFIG,
} from "@/libs/threejs/FrameAnimator";
import {
  calculateHexUVCoordinates,
  calculateTileOffset,
  createGroundCorners,
  createGroundEdges,
  createGroundGeometry,
  createTileGeometry,
  getHexPoints,
  mergeBufferGeometries,
} from "@/libs/threejs/hexgrid";
import { applyWaveShader, applyWindShader } from "@/libs/threejs/shaders";
import {
  createShadowTexture,
  drawStatusBar,
  profiler,
  updateStatusBar,
} from "@/libs/threejs/util";
import { directionToSpriteDirection } from "@/libs/towerDefense/game";
import type {
  CharacterAssetConfig as DbCharacterAssetConfig,
  EnemyDirection,
  HexPosition,
  TowerDefenseEnemy,
} from "@/validators/towerDefense";
import type { TerrainHex } from "../hexgrid";
import { defineHex } from "../hexgrid";

/**
 * Helper to convert SpriteMaterial to MeshBasicMaterial for InstancedMesh.
 * Caches results to avoid creating duplicate materials.
 * IMPORTANT: Applies wind shader directly to MeshBasicMaterial since shaders
 * use onBeforeCompile which is bound to specific material types.
 */
const instancedMaterialCache = new Map<string, ThreeMeshBasicMaterial>();
const getInstancedMaterial = (spriteMat: SpriteMaterial): ThreeMeshBasicMaterial => {
  const cacheKey = spriteMat.uuid;
  const cached = instancedMaterialCache.get(cacheKey);
  if (cached) return cached;

  const meshMat = new ThreeMeshBasicMaterial({
    map: spriteMat.map,
    alphaMap: spriteMat.alphaMap,
    alphaTest: 0.5,
    transparent: true,
    depthWrite: false,
  });

  // If the source material is wind-animated, apply wind shader to the new MeshBasicMaterial
  // The wind shader works with both SpriteMaterial and MeshBasicMaterial (same shader includes)
  if (spriteMat.userData.isAnimated && spriteMat.userData.animationType === "wind") {
    const windOffset = (spriteMat.userData.windOffset as number) ?? 0;
    applyWindShader(meshMat, windOffset);
  }

  instancedMaterialCache.set(cacheKey, meshMat);
  return meshMat;
};

/**
 * Shared quad geometry for instanced map assets, shadows, and health bars.
 * PERFORMANCE OPTIMIZATION: Uses exactly 6 vertices (2 triangles) for a quad.
 */
const QUAD_GEOMETRY = createTileGeometry({
  corners: [
    { x: -0.5, y: -0.5 },
    { x: 0.5, y: -0.5 },
    { x: 0.5, y: 0.5 },
    { x: -0.5, y: 0.5 },
  ],
  points: [0, 1, 2, 0, 2, 3], // Two triangles for a quad
  tileUVArray: new Float32Array([
    0,
    0,
    1,
    0,
    1,
    1, // First triangle (0, 1, 2)
    0,
    0,
    1,
    1,
    0,
    1, // Second triangle (0, 2, 3)
  ]),
  offsetLength: 0,
  offsetLayer: 0,
  layer: 0,
});

/**
 * PERFORMANCE: Cached shadow texture and material to prevent memory leak.
 * Instead of creating a new texture for each character, we reuse a single cached one.
 */
let cachedShadowTexture: ReturnType<typeof createShadowTexture> | null = null;
let cachedShadowMaterial: SpriteMaterial | null = null;

const getCharacterShadowMaterial = (): SpriteMaterial => {
  if (!cachedShadowMaterial) {
    cachedShadowTexture = createShadowTexture(128, 64, 0.45);
    cachedShadowMaterial = new SpriteMaterial({
      map: cachedShadowTexture,
      transparent: true,
      alphaTest: 0, // Shadow has low alpha (~0.45), don't discard pixels
      depthWrite: false,
    });
  }
  return cachedShadowMaterial;
};

/** Reset cached shadow when game ends (to free memory if needed) */
export const resetCachedShadow = (): void => {
  if (cachedShadowTexture) {
    cachedShadowTexture.dispose();
    cachedShadowTexture = null;
  }
  if (cachedShadowMaterial) {
    cachedShadowMaterial.dispose();
    cachedShadowMaterial = null;
  }
};

/**
 * Create a hexagonal grid for tower defense.
 */
export const getTowerDefenseGrid = (
  hexsize: number,
  gridSize: number,
  origin?: { x: number; y: number },
): Grid<TerrainHex> => {
  const Tile = defineHex({
    dimensions: { width: hexsize, height: hexsize * HEX_ASPECT_RATIO },
    origin: origin ?? { x: -hexsize * 0.5, y: -hexsize * 0.5 },
    orientation: Orientation.FLAT,
  });

  const grid = new Grid(Tile, rectangle({ width: gridSize, height: gridSize }))
    .filter((tile) => {
      try {
        return tile.width !== 0;
      } catch {
        return false;
      }
    })
    .map((tile) => {
      tile.cost = 1;
      tile.name = `${String.fromCharCode(65 + tile.col)}${tile.row + 1}`;
      return tile;
    });

  return grid;
};

/**
 * Draw the tower defense background (tiles, ground, and assets).
 * Follows the same pattern as drawSector and drawCombatBackground.
 */
export const drawTowerDefenseBackground = (info: {
  group_tiles: Group;
  group_ground: Group;
  group_edges: Group;
  group_assets: Group;
  grid: Grid<TerrainHex>;
  hexsize: number;
  seed: string;
  biome?: CombatBiome;
  lightLayout?: boolean;
  /** Center position (player tile) - assets won't be placed on or adjacent to this tile */
  centerPosition?: HexPosition;
  /** Optimization: Callback to collect animated assets (Sprite or InstancedMesh) */
  onAssetAdded?: (asset: Sprite | InstancedMesh) => void;
  /** Optimization: Callback to collect animated tiles (e.g. ocean) */
  onTileAdded?: (tile: Mesh) => void;
}): void => {
  const {
    group_tiles,
    group_ground,
    group_edges,
    group_assets,
    grid,
    seed,
    biome = "ground",
    lightLayout = false,
    centerPosition,
    onAssetAdded,
    onTileAdded,
  } = info;

  // Helper to dispose of a group's children properly to avoid memory leaks
  const disposeGroup = (group: Group) => {
    group.children.forEach((child) => {
      if (
        child instanceof Mesh ||
        child instanceof Line ||
        child instanceof LineSegments
      ) {
        child.geometry.dispose();
      }
      if (child instanceof InstancedMesh) {
        child.dispose();
      }
    });
    group.clear();
  };

  // Clear existing children with proper disposal
  disposeGroup(group_tiles);
  disposeGroup(group_ground);
  disposeGroup(group_edges);
  disposeGroup(group_assets);

  const prng = alea(seed);
  const noiseGen = createNoise2D(prng);
  const assetsGen = createNoise2D(prng);

  // Calculate grid dimensions for noise normalization
  const gridArray = grid.toArray();
  const gridSize = Math.max(...gridArray.map((t) => Math.max(t.col, t.row))) + 1;

  // Set noise-based properties on each tile
  grid.forEach((tile) => {
    if (!tile) return;
    const nx = tile.col / gridSize - 0.5;
    const ny = tile.row / gridSize - 0.5;
    tile.level = noiseGen(nx, ny) / 2 + 0.5;
    tile.assetStrength = assetsGen(nx, ny) / 2 + 0.5;
  });

  // Get hex points for geometry construction
  const { points, groundPoints, groundEdges } = getHexPoints();

  // Calculate UV coordinates using first tile
  const firstTile = gridArray[0];
  if (!firstTile) return;

  const { groundUVArray, tileUVArray } = calculateHexUVCoordinates(
    firstTile,
    points,
    groundPoints,
  );

  // Line material for edges
  const lineMaterial = new LineBasicMaterial({ color: 0x555555 });

  // Arrays for geometry merging (performance optimization)
  const groundGeometries: BufferGeometry[] = [];
  const groundEdgeGeometries: BufferGeometry[] = [];
  const tileEdgeGeometries: BufferGeometry[] = [];

  // Map to store tile geometries grouped by material for merging
  const geometriesByMaterial = new Map<number | string, BufferGeometry[]>();
  const materialByGroupId = new Map<number | string, ThreeMeshBasicMaterial>();

  // Map to store ocean instances by variant
  const oceanInstancesByVariant = new Map<
    number,
    { material: ThreeMeshBasicMaterial; instances: { x: number; y: number }[] }
  >();

  // Map to store asset sprites by material for instancing
  // Key: material UUID, Value: { material, instances: { position, scale, rotation }[] }
  const assetInstancesByMaterial = new Map<
    string,
    {
      material: ThreeMeshBasicMaterial;
      instances: {
        position: { x: number; y: number; z: number };
        scale: number;
        rotation: number;
      }[];
    }
  >();

  // Helper to check if a tile is near the center (player area - no assets)
  const isNearCenter = (tile: TerrainHex): boolean => {
    if (!centerPosition) return false;
    const dx = Math.abs(tile.col - centerPosition.col);
    const dy = Math.abs(tile.row - centerPosition.row);
    // Within 1 tile of center (player tile and immediate neighbors)
    return dx <= 1 && dy <= 1;
  };

  // Draw tiles
  grid.forEach((tile) => {
    if (!tile) return;

    // Get tile info (material, sprites, asset type)
    const { material, sprites, asset } = getTileInfo(prng, tile, biome, lightLayout);
    tile.asset = asset;

    // Add sprites (trees, rocks, etc.) - skip tiles near center (player area)
    if (sprites && sprites.length > 0 && !lightLayout && !isNearCenter(tile)) {
      sprites.forEach((sprite) => {
        // PERFORMANCE OPTIMIZATION: Use InstancedMesh for map assets
        const spriteMat = sprite.material as SpriteMaterial;
        const matId = spriteMat.uuid;

        if (!assetInstancesByMaterial.has(matId)) {
          assetInstancesByMaterial.set(matId, {
            material: getInstancedMaterial(spriteMat),
            instances: [],
          });
        }

        assetInstancesByMaterial.get(matId)?.instances.push({
          position: { x: sprite.position.x, y: sprite.position.y, z: ASSETS_LAYER },
          scale: sprite.scale.x, // Use uniform scale for simplicity
          rotation: (sprite.userData.rotation as number) || 0,
        });
      });
    }

    // Corners of the tile
    const corners = tile.corners;

    // Calculate offset for special tiles (ocean, etc.)
    const { length, offsetLength, offsetLayer } = calculateTileOffset(
      corners,
      asset,
      lightLayout,
    );

    // Create ground corners
    const groundCorners = createGroundCorners(corners, offsetLength, length);

    // Top face geometry
    const geometry = createTileGeometry({
      corners,
      points,
      tileUVArray,
      offsetLength,
      offsetLayer,
      layer: TILES_LAYER,
    });

    // Handle tile rendering
    if (asset === "ocean" && material) {
      // PERFORMANCE OPTIMIZATION: Use InstancedMesh for ocean tiles
      // Group into 4 variants to maintain visual desynchronization
      const numVariants = 4;
      const variantIndex = Math.floor(prng() * numVariants);

      if (!oceanInstancesByVariant.has(variantIndex)) {
        const clonedMaterial = material.clone();
        const variantOffset = (variantIndex / numVariants) * Math.PI * 2;
        applyWaveShader(clonedMaterial, variantOffset);
        oceanInstancesByVariant.set(variantIndex, {
          material: clonedMaterial,
          instances: [],
        });
      }

      oceanInstancesByVariant.get(variantIndex)?.instances.push({
        x: tile.x,
        y: tile.y,
      });
    } else if (material) {
      // For other tiles, group them by material for merging
      const materialId = material.uuid; // Use material UUID as key
      if (!geometriesByMaterial.has(materialId)) {
        geometriesByMaterial.set(materialId, []);
        materialByGroupId.set(materialId, material);
      }
      geometriesByMaterial.get(materialId)?.push(geometry);
    }

    // Collect tile edge geometry for merging
    const edgeGeometry = new EdgesGeometry(geometry);
    tileEdgeGeometries.push(edgeGeometry);

    // Ground part of the tile (3D depth effect)
    if (!lightLayout) {
      const groundGeometry = createGroundGeometry({
        groundCorners,
        groundPoints,
        groundUVArray,
        layer: DIRT_LAYER,
      });

      groundGeometries.push(groundGeometry);

      // Ground edges
      const edgeMeshes = createGroundEdges({
        groundCorners,
        groundEdges,
        lineMaterial,
        layer: DIRT_LAYER,
      });
      edgeMeshes.forEach((edgeMesh) => {
        if (edgeMesh.geometry) {
          groundEdgeGeometries.push(edgeMesh.geometry);
        }
      });
    }
  });

  // Create merged meshes for each material group
  let tileDrawCalls = 0;
  const dummyObj = new Object3D();
  geometriesByMaterial.forEach((geoms, materialId) => {
    const mergedGeometry = mergeBufferGeometries(geoms);
    const material = materialByGroupId.get(materialId);
    if (mergedGeometry && material) {
      const mergedMesh = new Mesh(mergedGeometry, material);
      mergedMesh.userData.type = "tiles_merged";
      mergedMesh.matrixAutoUpdate = false;
      mergedMesh.updateMatrix();
      group_tiles.add(mergedMesh);
      tileDrawCalls++;
    }
  });

  // Create instanced ocean meshes
  const referenceTile = gridArray[0];
  if (!referenceTile) return;

  // Important: InstancedMesh geometry must be local (around 0,0). Our tile corners are in
  // world space, so we re-center them around the tile center and then instance-translate.
  const referenceLocalCorners = referenceTile.corners.map((corner) => ({
    x: corner.x - referenceTile.x,
    y: corner.y - referenceTile.y,
  }));
  const { offsetLength: oceanOffsetLength, offsetLayer: oceanOffsetLayer } =
    calculateTileOffset(referenceTile.corners, "ocean", lightLayout);

  const firstTileGeometry = createTileGeometry({
    corners: referenceLocalCorners,
    points,
    tileUVArray,
    offsetLength: oceanOffsetLength,
    offsetLayer: oceanOffsetLayer,
    layer: TILES_LAYER,
  });

  oceanInstancesByVariant.forEach((data) => {
    const { material, instances } = data;
    const instancedOcean = new InstancedMesh(
      firstTileGeometry,
      material,
      instances.length,
    );

    instances.forEach((instance, i) => {
      dummyObj.position.set(instance.x, instance.y, 0);
      dummyObj.updateMatrix();
      instancedOcean.setMatrixAt(i, dummyObj.matrix);
    });

    instancedOcean.instanceMatrix.needsUpdate = true;
    instancedOcean.matrixAutoUpdate = false;
    instancedOcean.updateMatrix();
    group_tiles.add(instancedOcean);

    if (onTileAdded) {
      // Report material for animation tracking
      onTileAdded(instancedOcean);
    }
    tileDrawCalls++;
  });

  profiler.reportCount("draw_tiles", tileDrawCalls);

  // Merge all ground geometries into a single mesh (performance)
  if (!lightLayout && groundGeometries.length > 0) {
    const mergedGroundGeometry = mergeBufferGeometries(groundGeometries);
    // Use the first tile's dirt material
    const firstTile = grid.toArray()[0];
    if (firstTile) {
      const { dirt } = getTileInfo(prng, firstTile, biome, lightLayout);
      const mergedGroundMesh = new Mesh(mergedGroundGeometry, dirt);
      mergedGroundMesh.userData.type = "ground_merged";
      mergedGroundMesh.matrixAutoUpdate = false;
      mergedGroundMesh.updateMatrix();
      group_ground.add(mergedGroundMesh);
      profiler.reportCount("draw_ground", 1);
    }

    // Merge ground edge geometries
    if (groundEdgeGeometries.length > 0) {
      const mergedEdgeGeometry = mergeBufferGeometries(groundEdgeGeometries);
      const mergedEdgeMesh = new Line(mergedEdgeGeometry, lineMaterial);
      mergedEdgeMesh.matrixAutoUpdate = false;
      mergedEdgeMesh.updateMatrix();
      group_ground.add(mergedEdgeMesh);
      profiler.reportCount("draw_ground_edges", 1);
    }
  }

  // Merge tile edge geometries
  if (tileEdgeGeometries.length > 0) {
    const mergedTileEdgeGeometry = mergeBufferGeometries(tileEdgeGeometries);
    const mergedTileEdgeMesh = new LineSegments(mergedTileEdgeGeometry, lineMaterial);
    mergedTileEdgeMesh.matrixAutoUpdate = false;
    mergedTileEdgeMesh.updateMatrix();
    group_edges.add(mergedTileEdgeMesh);
    profiler.reportCount("draw_tile_edges", 1);
  }

  // Report assets count
  let assetDrawCalls = 0;
  const dummyObject = new Object3D();

  assetInstancesByMaterial.forEach((data, _matId) => {
    const { material, instances } = data;
    const instancedMesh = new InstancedMesh(QUAD_GEOMETRY, material, instances.length);

    instances.forEach((instance, i) => {
      dummyObject.position.set(
        instance.position.x,
        instance.position.y,
        instance.position.z,
      );
      dummyObject.scale.set(instance.scale, instance.scale, 1);
      dummyObject.rotation.set(0, 0, instance.rotation);
      dummyObject.updateMatrix();
      instancedMesh.setMatrixAt(i, dummyObject.matrix);
    });

    instancedMesh.instanceMatrix.needsUpdate = true;
    instancedMesh.matrixAutoUpdate = false;
    instancedMesh.updateMatrix();
    group_assets.add(instancedMesh);

    // If it has a wind shader, we need to report it for updates
    if (material.userData.shader && onAssetAdded) {
      onAssetAdded(instancedMesh);
    }

    assetDrawCalls++;
  });

  profiler.reportCount("draw_assets", assetDrawCalls);
  profiler.reportCount(
    "draw_assets_count",
    group_assets.children.reduce((acc, child) => {
      return acc + (child instanceof InstancedMesh ? child.count : 1);
    }, 0),
  );

  // Sort assets by y-position for correct depth ordering (same as Sector)
  // Note: Sorting InstancedMesh doesn't help with transparency sorting internal to the mesh,
  // but map assets use alphaTest: 0.5 so it's not strictly necessary for them.
  group_assets.children.sort((a, b) => b.position.y - a.position.y);
};

/**
 * Player state for tracking direction and animation.
 */
export interface PlayerState {
  direction: EnemyDirection;
  isThrowingAnimation: boolean;
}

/**
 * Draw the player at the center of the grid.
 * Uses the new frame-based character sprites.
 */
export const drawTowerDefensePlayer = (info: {
  group_player: Group;
  objectsMap?: Map<string, Group>;
  grid: Grid<TerrainHex>;
  playerPosition: HexPosition;
  frameAnimator: FrameAnimator;
  playerState: PlayerState;
}): void => {
  const { group_player, objectsMap, grid, playerPosition, frameAnimator, playerState } =
    info;

  // Find player tile
  const tile = grid.getHex({ col: playerPosition.col, row: playerPosition.row });
  if (!tile) return;

  const { height: h, width: w } = tile;
  const playerId = "player";

  // Check if player group exists
  let playerGroup = objectsMap
    ? objectsMap.get(playerId)
    : (group_player.getObjectByName(playerId) as Group | undefined);

  if (!playerGroup) {
    playerGroup = new Group();
    playerGroup.name = playerId;
    if (objectsMap) objectsMap.set(playerId, playerGroup);

    // Get player asset config (from database or fallback to default)
    const { config: playerConfig, scaleFactor: playerScaleFactor } =
      getPlayerAssetConfig();

    // Store config in userData for later reference
    playerGroup.userData.assetConfig = playerConfig;
    playerGroup.userData.currentDirection = playerState.direction;
    playerGroup.userData.currentState = "idle";

    // Shadow - scale proportionally to player size (uses cached material)
    const shadowSprite = new Sprite(getCharacterShadowMaterial());
    shadowSprite.name = "shadow";
    const shadowScale = playerScaleFactor * 0.25;
    shadowSprite.scale.set(w * shadowScale, h * shadowScale * 0.4, 1);
    shadowSprite.position.set(w / 2, h * 0.1, USER_LAYER - 0.1);
    playerGroup.add(shadowSprite);

    // Create animated sprite for player using dynamic config
    const sprite = frameAnimator.createSprite(
      playerId,
      playerConfig,
      directionToSpriteDirection(playerState.direction),
      "idle",
    );
    sprite.name = "animation";
    sprite.scale.set(h * playerScaleFactor, h * playerScaleFactor, 1);
    sprite.position.set(w / 2, h * 0.7, USER_LAYER);
    playerGroup.add(sprite);

    // Position the group at the tile center
    const targetX = tile.x - w / 2;
    const targetY = tile.y - h / 2;
    playerGroup.position.set(targetX, targetY, 0);
    playerGroup.matrixAutoUpdate = false;
    playerGroup.updateMatrix();

    group_player.add(playerGroup);
    profiler.reportCount("draw_player", 1);
    profiler.reportCount("draw_player_parts", playerGroup.children.length);
  } else {
    // Update direction if changed
    const currentDirection = playerGroup.userData.currentDirection as EnemyDirection;
    const currentState = playerGroup.userData.currentState as AnimationState;
    const spriteDirection = directionToSpriteDirection(playerState.direction);

    if (currentDirection !== playerState.direction) {
      playerGroup.userData.currentDirection = playerState.direction;
      frameAnimator.setDirection(playerId, spriteDirection);
    }

    // Handle throw animation transitions
    if (playerState.isThrowingAnimation && currentState !== "throw") {
      playerGroup.userData.currentState = "throw";
      const assetConfig =
        (playerGroup.userData.assetConfig as CharacterAssetConfig) ??
        getPlayerAssetConfig().config;
      frameAnimator.playOnce(playerId, "throw", assetConfig);
    } else if (!playerState.isThrowingAnimation && currentState === "throw") {
      // If we are no longer in throwing state but userData still says "throw",
      // force return to idle to prevent getting stuck in throw animation.
      // We check getState to avoid restarting the idle animation if it's already playing.
      playerGroup.userData.currentState = "idle";
      if (frameAnimator.getState(playerId) !== "idle") {
        const assetConfig =
          (playerGroup.userData.assetConfig as CharacterAssetConfig) ??
          getPlayerAssetConfig().config;
        frameAnimator.setState(playerId, "idle", assetConfig);
      }
    }

    // Update position (in case it changed)
    const targetX = tile.x - w / 2;
    const targetY = tile.y - h / 2;
    playerGroup.position.set(targetX, targetY, 0);
    playerGroup.updateMatrix();
  }
};

/**
 * Get the next waypoint from an enemy's A* path.
 * Returns the current position if no more waypoints.
 */
const getNextWaypointFromPath = (
  enemy: TowerDefenseEnemy,
): { col: number; row: number } => {
  if (enemy.pathIndex < enemy.path.length) {
    const waypoint = enemy.path[enemy.pathIndex];
    if (waypoint) {
      return { col: waypoint.col, row: waypoint.row };
    }
  }
  // No more waypoints - return current position
  return { col: enemy.position.col, row: enemy.position.row };
};

/**
 * Cache for dynamically loaded enemy asset configs from the database.
 * These are populated when enemies are spawned with their asset configs.
 */
const enemyAssetConfigCache = new Map<
  string,
  { config: CharacterAssetConfig; scaleFactor: number }
>();

/**
 * Cache for the current player's asset configuration and scale.
 * Set when a game session starts with a selected player character.
 */
let playerAssetConfigCache: {
  config: CharacterAssetConfig;
  scaleFactor: number;
} | null = null;

/**
 * Convert a database asset config (with full URLs) to the FrameAnimator format.
 * Database configs don't have basePath since they use absolute URLs.
 */
const convertDbConfigToAnimatorConfig = (
  dbConfig: DbCharacterAssetConfig,
): CharacterAssetConfig => {
  return {
    ...dbConfig,
    basePath: "", // Not used when URLs are absolute
  };
};

/**
 * Register an enemy asset config from the database.
 * Called when enemy definitions are loaded.
 */
export const registerEnemyAssetConfig = (
  enemyType: string,
  config: DbCharacterAssetConfig,
  scaleFactor: number,
): void => {
  const animatorConfig = convertDbConfigToAnimatorConfig(config);
  enemyAssetConfigCache.set(enemyType, { config: animatorConfig, scaleFactor });
};

/**
 * Clear all cached enemy asset configs.
 */
export const clearEnemyAssetConfigCache = (): void => {
  enemyAssetConfigCache.clear();
};

/**
 * Register the player's asset configuration.
 * Called when a game session starts with a selected player character.
 */
export const registerPlayerAssetConfig = (
  config: DbCharacterAssetConfig,
  scaleFactor: number,
): void => {
  const animatorConfig = convertDbConfigToAnimatorConfig(config);
  playerAssetConfigCache = { config: animatorConfig, scaleFactor };
};

/**
 * Clear the player asset config cache.
 */
export const clearPlayerAssetConfigCache = (): void => {
  playerAssetConfigCache = null;
};

/**
 * Get the current player's asset config.
 * Falls back to default PLAYER_ASSET_CONFIG if none registered.
 */
const getPlayerAssetConfig = (): {
  config: CharacterAssetConfig;
  scaleFactor: number;
} => {
  if (playerAssetConfigCache) {
    return playerAssetConfigCache;
  }
  // Fallback to default hardcoded player config
  return { config: PLAYER_ASSET_CONFIG, scaleFactor: 2.8 };
};

/**
 * Get the asset config for an enemy type.
 * First checks the dynamic cache (database configs), then falls back to hardcoded.
 */
const getEnemyAssetConfig = (
  enemyType: string,
): { config: CharacterAssetConfig; scaleFactor: number } => {
  // Check cache first (database configs)
  const cachedConfig = enemyAssetConfigCache.get(enemyType);
  if (cachedConfig) {
    return cachedConfig;
  }

  // Fallback to hardcoded configs for backwards compatibility
  const isHeavy = enemyType === "heavy";
  return {
    config: isHeavy ? HEAVY_ENEMY_ASSET_CONFIG : LIGHT_ENEMY_ASSET_CONFIG,
    scaleFactor: isHeavy ? 3.2 : 2.8,
  };
};

/**
 * Update asset opacity based on enemy positions.
 * Makes assets transparent when enemies are on or near them.
 * PERFORMANCE OPTIMIZATION: Uses spatial map and only runs if positions changed.
 */
const updateAssetOpacityForEnemies = (
  assetsSpatialMap: Map<string, (Sprite | InstancedMesh)[]>,
  enemies: readonly TowerDefenseEnemy[],
  grid: Grid<TerrainHex>,
) => {
  // Check if any enemy moved to a new tile
  const enemyTileKeys = enemies
    .filter((e) => e.health > 0)
    .map((e) => `${e.position.col},${e.position.row}`);
  const currentTotalKey = enemyTileKeys.join("|");

  if (updateAssetOpacityForEnemies.lastTotalKey === currentTotalKey) {
    return; // No enemies moved to different tiles, skip expensive check
  }
  updateAssetOpacityForEnemies.lastTotalKey = currentTotalKey;

  const affectedTiles = new Set<string>();
  enemies.forEach((enemy) => {
    if (enemy.health > 0) {
      const enemyHex = grid.getHex({
        col: enemy.position.col,
        row: enemy.position.row,
      });
      if (enemyHex) {
        affectedTiles.add(`${enemyHex.col},${enemyHex.row}`);
        const neighbors = grid.traverse(ring({ radius: 1, center: enemyHex }));
        neighbors.forEach((neighbor) => {
          if (neighbor) {
            affectedTiles.add(`${neighbor.col},${neighbor.row}`);
          }
        });
      }
    }
  });

  if (!updateAssetOpacityForEnemies.previouslyDimmed) {
    updateAssetOpacityForEnemies.previouslyDimmed = new Set<Sprite | InstancedMesh>();
  }
  const previouslyDimmed = updateAssetOpacityForEnemies.previouslyDimmed;

  // Restore opacity
  previouslyDimmed.forEach((sprite) => {
    const tileKey = sprite.userData.tileKey as string;
    if (!affectedTiles.has(tileKey)) {
      if (sprite.material && "opacity" in sprite.material) {
        sprite.material.opacity = 1.0;
      }
      previouslyDimmed.delete(sprite);
    }
  });

  // Dim sprites
  affectedTiles.forEach((tileKey) => {
    const spritesOnTile = assetsSpatialMap.get(tileKey);
    if (spritesOnTile) {
      spritesOnTile.forEach((sprite) => {
        if (sprite.userData.small !== true) {
          if (sprite.material && "opacity" in sprite.material) {
            sprite.material.opacity = 0.5;
          }
          previouslyDimmed.add(sprite);
        }
      });
    }
  });
};

// Static properties for persistence
updateAssetOpacityForEnemies.previouslyDimmed = new Set<Sprite | InstancedMesh>();
updateAssetOpacityForEnemies.lastTotalKey = "";

/**
 * Draw enemies on the grid.
 * Uses frame-based animations based on enemy type and movement direction.
 * Implements smooth linear interpolation between tiles based on movementProgress.
 */
export const drawTowerDefenseEnemies = (info: {
  group_enemies: Group;
  objectsMap?: Map<string, Group>;
  assetsSpatialMap?: Map<string, (Sprite | InstancedMesh)[]>;
  grid: Grid<TerrainHex>;
  enemies: readonly TowerDefenseEnemy[];
  deltaTime: number;
  frameAnimator: FrameAnimator;
  playerPosition: HexPosition;
  punchingEnemies: Set<string>; // Set of enemy IDs currently in punch animation
}): boolean => {
  const {
    group_enemies,
    objectsMap,
    assetsSpatialMap,
    grid,
    enemies,
    frameAnimator,
    punchingEnemies,
  } = info;

  if (assetsSpatialMap) {
    updateAssetOpacityForEnemies(assetsSpatialMap, enemies, grid);
  }

  let anyMoving = false;
  const drawnIds = new Set<string>();

  for (const enemy of enemies) {
    if (enemy.health <= 0) {
      const existing = objectsMap
        ? objectsMap.get(enemy.id)
        : group_enemies.getObjectByName(enemy.id);
      if (existing) {
        group_enemies.remove(existing);
        if (objectsMap) objectsMap.delete(enemy.id);
        frameAnimator.remove(enemy.id);
      }
      continue;
    }

    drawnIds.add(enemy.id);
    const currentTile = grid.getHex({
      col: enemy.position.col,
      row: enemy.position.row,
    });
    if (!currentTile) continue;

    const { height: h, width: w } = currentTile;
    let enemyGroup = (
      objectsMap ? objectsMap.get(enemy.id) : group_enemies.getObjectByName(enemy.id)
    ) as Group | undefined;

    // Determine animation state
    const isPunching = punchingEnemies.has(enemy.id);
    const animationState: AnimationState = isPunching
      ? "punch"
      : enemy.movementProgress > 0
        ? "moving"
        : "idle";

    const spriteDirection = directionToSpriteDirection(enemy.direction);
    const { config: assetConfig, scaleFactor } = getEnemyAssetConfig(enemy.enemyType);

    if (!enemyGroup) {
      enemyGroup = new Group();
      enemyGroup.name = enemy.id;
      if (objectsMap) objectsMap.set(enemy.id, enemyGroup);
      enemyGroup.userData.currentDirection = enemy.direction;
      enemyGroup.userData.currentState = animationState;
      enemyGroup.userData.enemyType = enemy.enemyType;
      // Store the current tile position for interpolation
      enemyGroup.userData.prevTileX = currentTile.x;
      enemyGroup.userData.prevTileY = currentTile.y;
      enemyGroup.userData.prevCol = enemy.position.col;
      enemyGroup.userData.prevRow = enemy.position.row;

      // Shadow - procedural blurred ellipse for natural soft shadow (uses cached material)
      const shadowSprite = new Sprite(getCharacterShadowMaterial());
      shadowSprite.name = "shadow";
      const shadowScale = scaleFactor * 0.25;
      shadowSprite.scale.set(w * shadowScale, h * shadowScale * 0.4, 1);
      shadowSprite.position.set(w / 2, h * 0.1, USER_LAYER - 0.1);
      enemyGroup.add(shadowSprite);

      // Create animated sprite for enemy
      const sprite = frameAnimator.createSprite(
        enemy.id,
        assetConfig,
        spriteDirection,
        animationState,
      );
      sprite.name = "animation";

      sprite.scale.set(h * scaleFactor, h * scaleFactor, 1);
      sprite.position.set(w / 2, h * 0.7, USER_LAYER);
      enemyGroup.add(sprite);

      group_enemies.add(enemyGroup);
    } else {
      // Check if the enemy has moved to a new tile (position changed)
      const prevCol = enemyGroup.userData.prevCol as number;
      const prevRow = enemyGroup.userData.prevRow as number;

      if (prevCol !== enemy.position.col || prevRow !== enemy.position.row) {
        // Enemy moved to a new tile - update previous position to old tile
        const oldTile = grid.getHex({ col: prevCol, row: prevRow });
        if (oldTile) {
          enemyGroup.userData.prevTileX = oldTile.x;
          enemyGroup.userData.prevTileY = oldTile.y;
        }
        enemyGroup.userData.prevCol = enemy.position.col;
        enemyGroup.userData.prevRow = enemy.position.row;
      }

      // Update direction if changed
      const currentDirection = enemyGroup.userData.currentDirection as EnemyDirection;
      if (currentDirection !== enemy.direction) {
        enemyGroup.userData.currentDirection = enemy.direction;
        frameAnimator.setDirection(enemy.id, spriteDirection);
      }

      // Update animation state if changed
      const currentState = enemyGroup.userData.currentState as AnimationState;
      if (currentState !== animationState) {
        enemyGroup.userData.currentState = animationState;
        frameAnimator.setState(enemy.id, animationState, assetConfig);
      }
    }

    // Calculate smooth interpolated position using A* path
    // Get the next waypoint from the enemy's computed path
    const nextWaypoint = getNextWaypointFromPath(enemy);
    const nextTile = grid.getHex({ col: nextWaypoint.col, row: nextWaypoint.row });

    // Calculate interpolated world position
    let visualX: number;
    let visualY: number;

    if (nextTile && enemy.movementProgress > 0) {
      // Interpolate between current tile and next waypoint based on movementProgress
      const progress = enemy.movementProgress;
      visualX = currentTile.x + (nextTile.x - currentTile.x) * progress;
      visualY = currentTile.y + (nextTile.y - currentTile.y) * progress;
      anyMoving = true;
    } else {
      // At the current tile (not moving or just arrived)
      visualX = currentTile.x;
      visualY = currentTile.y;
    }

    // Update position using interpolated coordinates
    enemyGroup.position.set(visualX - w / 2, visualY - h / 2, 0);
    enemyGroup.matrixAutoUpdate = false;
    enemyGroup.updateMatrix();
  }

  // Remove enemies that are no longer in the list
  // Note: Skip "enemies_merged" objects (health bar instanced meshes) - they're managed by updateEnemyHealthBars
  const toRemove: string[] = [];
  group_enemies.children.forEach((child) => {
    if (child.userData.type === "enemies_merged") return;
    if (!drawnIds.has(child.name) && child.name !== "player") {
      toRemove.push(child.name);
      frameAnimator.remove(child.name);
      if (objectsMap) objectsMap.delete(child.name);
    }
  });

  toRemove.forEach((name) => {
    const obj = objectsMap ? objectsMap.get(name) : group_enemies.getObjectByName(name);
    if (obj) group_enemies.remove(obj);
  });

  // Report enemy counts
  let characterSprites = 0;
  group_enemies.children.forEach((child) => {
    // Only count character sprites that aren't instanced (shadows/hp bars handled below)
    if (child.userData.type === "enemies_merged") return;
    if (child.getObjectByName("animation")) characterSprites++;
  });
  profiler.reportCount("draw_character_sprites", characterSprites);

  return anyMoving;
};

/**
 * Persistent instanced meshes for enemy health bars.
 * PERFORMANCE OPTIMIZATION: Instead of recreating InstancedMesh every frame,
 * we maintain persistent instances and only update their matrices.
 * Note: Shadows use individual sprites for reliability.
 */
const enemyInstancedMeshes = {
  hpBack: null as InstancedMesh | null,
  hpCurr: null as InstancedMesh | null,
  maxCount: 0,
  hpBackMaterial: null as ThreeMeshBasicMaterial | null,
  hpCurrMaterial: null as ThreeMeshBasicMaterial | null,
};

// Reusable Object3D for matrix calculations (avoid allocation per frame)
const _dummyMover = new Object3D();

/**
 * Ensure instanced meshes exist and have enough capacity.
 * Only recreates when capacity needs to increase.
 */
const ensureInstancedMeshCapacity = (
  group_enemies: Group,
  requiredCount: number,
): void => {
  // Only recreate if we need more capacity (with some headroom)
  const targetCapacity = Math.max(requiredCount + 10, enemyInstancedMeshes.maxCount);

  if (targetCapacity > enemyInstancedMeshes.maxCount || !enemyInstancedMeshes.hpBack) {
    // Dispose old meshes
    if (enemyInstancedMeshes.hpBack) {
      group_enemies.remove(enemyInstancedMeshes.hpBack);
      enemyInstancedMeshes.hpBack.dispose();
    }
    if (enemyInstancedMeshes.hpCurr) {
      group_enemies.remove(enemyInstancedMeshes.hpCurr);
      enemyInstancedMeshes.hpCurr.dispose();
    }

    enemyInstancedMeshes.maxCount = targetCapacity;

    // Create instanced meshes for health bars only (shadows use individual sprites)
    if (enemyInstancedMeshes.hpBackMaterial) {
      enemyInstancedMeshes.hpBack = new InstancedMesh(
        QUAD_GEOMETRY,
        enemyInstancedMeshes.hpBackMaterial,
        targetCapacity,
      );
      enemyInstancedMeshes.hpBack.userData.type = "enemies_merged";
      enemyInstancedMeshes.hpBack.frustumCulled = false;
      group_enemies.add(enemyInstancedMeshes.hpBack);

      if (!enemyInstancedMeshes.hpCurrMaterial) return;
      enemyInstancedMeshes.hpCurr = new InstancedMesh(
        QUAD_GEOMETRY,
        enemyInstancedMeshes.hpCurrMaterial,
        targetCapacity,
      );
      enemyInstancedMeshes.hpCurr.userData.type = "enemies_merged";
      enemyInstancedMeshes.hpCurr.frustumCulled = false;
      group_enemies.add(enemyInstancedMeshes.hpCurr);
    }
  }
};

// Zero scale matrix to hide unused instances
const _zeroMatrix = (() => {
  const obj = new Object3D();
  obj.scale.set(0, 0, 0);
  obj.updateMatrix();
  return obj.matrix.clone();
})();

/**
 * Update enemy health bars.
 * PERFORMANCE OPTIMIZATION: Reuses InstancedMesh instances instead of recreating every frame.
 */
export const updateEnemyHealthBars = (info: {
  group_enemies: Group;
  objectsMap?: Map<string, Group>;
  enemies: readonly TowerDefenseEnemy[];
  hexWidth: number;
}): void => {
  const { group_enemies, objectsMap, enemies, hexWidth } = info;

  let activeEnemies = 0;
  let hpBarCount = 0;

  // First pass: update individual health bar sprites and count active enemies
  for (const enemy of enemies) {
    if (enemy.health <= 0) continue;
    activeEnemies++;

    const enemyGroup = (
      objectsMap ? objectsMap.get(enemy.id) : group_enemies.getObjectByName(enemy.id)
    ) as Group | undefined;
    if (!enemyGroup) continue;

    // Check if health bar exists, create if not
    let healthBar = enemyGroup.getObjectByName("hp_current");
    if (!healthBar) {
      const hp_back = drawStatusBar({
        width: hexWidth,
        height: hexWidth,
        yPosition: hexWidth * 0.7,
        color: "gray",
        stroke: true,
        name: "hp_background",
        yOffset: 0,
        layer: STATUS_LAYER,
      });
      const hp_bar = drawStatusBar({
        width: hexWidth,
        height: hexWidth,
        yPosition: hexWidth * 0.7,
        color: "firebrick",
        stroke: true,
        name: "hp_current",
        yOffset: 0,
        layer: STATUS_LAYER,
      });
      enemyGroup.add(hp_back);
      enemyGroup.add(hp_bar);
      healthBar = hp_bar;

      // Cache health bar materials on first creation (shadow is cached above the loop)
      if (!enemyInstancedMeshes.hpBackMaterial) {
        enemyInstancedMeshes.hpBackMaterial = getInstancedMaterial(
          hp_back.material as SpriteMaterial,
        );
        enemyInstancedMeshes.hpCurrMaterial = getInstancedMaterial(
          hp_bar.material as SpriteMaterial,
        );
      }
    }

    // Only show health bar if enemy has taken damage
    const needsShow = enemy.health < enemy.maxHealth;
    const hpBack = enemyGroup.getObjectByName("hp_background");
    if (hpBack) hpBack.visible = needsShow;
    if (healthBar) healthBar.visible = needsShow;

    if (needsShow) {
      updateStatusBar("hp_current", enemyGroup, enemy.health / enemy.maxHealth);
      hpBarCount += 2;
    }
  }

  // Ensure we have enough capacity in instanced meshes
  ensureInstancedMeshCapacity(group_enemies, activeEnemies);

  // Second pass: update instanced mesh matrices for health bars
  let hpIdx = 0;

  group_enemies.children.forEach((enemyGroup) => {
    if (!enemyGroup.visible || enemyGroup.userData.type === "enemies_merged") return;

    // Ensure matrix is up-to-date before using it
    enemyGroup.updateMatrix();

    // Update health bar instances
    const hpBack = enemyGroup.getObjectByName("hp_background") as Sprite | undefined;
    const hpCurr = enemyGroup.getObjectByName("hp_current") as Sprite | undefined;

    if (hpBack?.visible && enemyInstancedMeshes.hpBack) {
      _dummyMover.position.copy(hpBack.position).applyMatrix4(enemyGroup.matrix);
      _dummyMover.scale.copy(hpBack.scale);
      _dummyMover.updateMatrix();
      enemyInstancedMeshes.hpBack.setMatrixAt(hpIdx, _dummyMover.matrix);
      hpBack.visible = false;

      if (hpCurr?.visible && enemyInstancedMeshes.hpCurr) {
        _dummyMover.position.copy(hpCurr.position).applyMatrix4(enemyGroup.matrix);
        _dummyMover.scale.copy(hpCurr.scale);
        _dummyMover.updateMatrix();
        enemyInstancedMeshes.hpCurr.setMatrixAt(hpIdx, _dummyMover.matrix);
        hpCurr.visible = false;
      }
      hpIdx++;
    }
  });

  // Hide unused health bar instances by setting zero scale
  if (enemyInstancedMeshes.hpBack) {
    for (let i = hpIdx; i < enemyInstancedMeshes.maxCount; i++) {
      enemyInstancedMeshes.hpBack.setMatrixAt(i, _zeroMatrix);
      if (enemyInstancedMeshes.hpCurr) {
        enemyInstancedMeshes.hpCurr.setMatrixAt(i, _zeroMatrix);
      }
    }
    enemyInstancedMeshes.hpBack.instanceMatrix.needsUpdate = true;
    enemyInstancedMeshes.hpBack.count = hpIdx;

    if (enemyInstancedMeshes.hpCurr) {
      enemyInstancedMeshes.hpCurr.instanceMatrix.needsUpdate = true;
      enemyInstancedMeshes.hpCurr.count = hpIdx;
    }
  }

  profiler.reportCount("draw_health_bars", hpBarCount);
  profiler.reportCount("draw_enemies", activeEnemies);
};

/**
 * Reset enemy instanced meshes (call when game ends/restarts).
 */
export const resetEnemyInstancedMeshes = (): void => {
  enemyInstancedMeshes.hpBack = null;
  enemyInstancedMeshes.hpCurr = null;
  enemyInstancedMeshes.maxCount = 0;
  enemyInstancedMeshes.hpBackMaterial = null;
  enemyInstancedMeshes.hpCurrMaterial = null;
};

/**
 * Cached range indicator state to avoid recreating geometry every frame.
 * PERFORMANCE OPTIMIZATION: Only recreate when range or position changes.
 */
const rangeIndicatorCache = {
  range: -1,
  playerX: -Infinity,
  playerY: -Infinity,
  hexWidth: -1,
  fillMesh: null as Mesh | null,
  borderLine: null as LineLoop | null,
};

/**
 * Draw a range indicator ellipse around the player.
 * The ellipse is semi-transparent with a visible border.
 * The ellipse matches the visual aspect ratio of the hex grid.
 * PERFORMANCE OPTIMIZATION: Caches geometry and only updates position when needed.
 */
export const drawRangeIndicator = (info: {
  group_range: Group;
  grid: Grid<TerrainHex>;
  playerPosition: HexPosition;
  range: number;
  hexWidth: number;
}): void => {
  const { group_range, grid, playerPosition, range, hexWidth } = info;

  // Find player tile to get center position
  const playerTile = grid.getHex({ col: playerPosition.col, row: playerPosition.row });
  if (!playerTile) return;

  // Check if we need to recreate geometry (range or hexWidth changed)
  const needsRecreate =
    range !== rangeIndicatorCache.range || hexWidth !== rangeIndicatorCache.hexWidth;

  // Check if we only need to update position
  const needsPositionUpdate =
    playerTile.x !== rangeIndicatorCache.playerX ||
    playerTile.y !== rangeIndicatorCache.playerY;

  if (!needsRecreate && !needsPositionUpdate) {
    // Nothing changed, skip update entirely
    return;
  }

  if (needsRecreate) {
    // Clear existing range indicator
    group_range.clear();
    rangeIndicatorCache.fillMesh = null;
    rangeIndicatorCache.borderLine = null;

    // Calculate ellipse radii based on range and hex dimensions
    const radiusX = (range + 0.5) * hexWidth * TD_RANGE_VISUAL_FACTOR;
    const radiusY = radiusX * HEX_ASPECT_RATIO;
    const borderWidth = 3;
    const segments = 64;

    // Create the filled semi-transparent ellipse
    const fillPositions: number[] = [];
    fillPositions.push(0, 0, 0);
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      fillPositions.push(Math.cos(theta) * radiusX, Math.sin(theta) * radiusY, 0);
    }

    const fillGeometry = new ThreeBufferGeometry();
    fillGeometry.setAttribute("position", new Float32BufferAttribute(fillPositions, 3));

    const indices: number[] = [];
    for (let i = 1; i <= segments; i++) {
      indices.push(0, i, i + 1);
    }
    fillGeometry.setIndex(indices);

    const fillMaterial = new ThreeMeshBasicMaterial({
      color: 0x9ca3af,
      transparent: true,
      opacity: 0.35,
      side: DoubleSide,
      depthWrite: false,
    });
    const fillMesh = new Mesh(fillGeometry, fillMaterial);
    fillMesh.name = "range-fill";
    fillMesh.matrixAutoUpdate = false;
    rangeIndicatorCache.fillMesh = fillMesh;
    group_range.add(fillMesh);

    // Create the border ellipse
    const borderGeometry = new ThreeBufferGeometry();
    const borderPositions: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      borderPositions.push(Math.cos(theta) * radiusX, Math.sin(theta) * radiusY, 0);
    }
    borderGeometry.setAttribute(
      "position",
      new Float32BufferAttribute(borderPositions, 3),
    );

    const borderMaterial = new LineBasicMaterial({
      color: 0x4b5563,
      linewidth: borderWidth,
      transparent: true,
      opacity: 0.8,
    });
    const borderLine = new LineLoop(borderGeometry, borderMaterial);
    borderLine.name = "range-border";
    borderLine.matrixAutoUpdate = false;
    rangeIndicatorCache.borderLine = borderLine;
    group_range.add(borderLine);

    rangeIndicatorCache.range = range;
    rangeIndicatorCache.hexWidth = hexWidth;
  }

  // Update positions (either after recreate or just position change)
  if (rangeIndicatorCache.fillMesh) {
    rangeIndicatorCache.fillMesh.position.set(
      playerTile.x,
      playerTile.y,
      TILES_LAYER + 0.1,
    );
    rangeIndicatorCache.fillMesh.updateMatrix();
  }
  if (rangeIndicatorCache.borderLine) {
    rangeIndicatorCache.borderLine.position.set(
      playerTile.x,
      playerTile.y,
      TILES_LAYER + 0.2,
    );
    rangeIndicatorCache.borderLine.updateMatrix();
  }

  rangeIndicatorCache.playerX = playerTile.x;
  rangeIndicatorCache.playerY = playerTile.y;

  profiler.reportCount("draw_range_indicator", 2);
};

/**
 * Reset range indicator cache (call when game ends/restarts).
 */
export const resetRangeIndicatorCache = (): void => {
  rangeIndicatorCache.range = -1;
  rangeIndicatorCache.playerX = -Infinity;
  rangeIndicatorCache.playerY = -Infinity;
  rangeIndicatorCache.hexWidth = -1;
  rangeIndicatorCache.fillMesh = null;
  rangeIndicatorCache.borderLine = null;
};
