import type { Grid } from "honeycomb-grid";
import { ring } from "honeycomb-grid";
import { createNoise2D } from "simplex-noise";
import type { Object3D } from "three";
import {
  type BufferGeometry,
  Color,
  DoubleSide,
  EdgesGeometry,
  Group,
  Line,
  LinearFilter,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  Sprite,
  SpriteMaterial,
} from "three";
import {
  ASSETS_LAYER,
  DIRT_LAYER,
  EFFECTS_LAYER,
  HEX_STACKING_DISPLACEMENT,
  ID_SFX_MOVE,
  IMG_AVATAR_DEFAULT,
  IMG_BATTLEFIELD_STAR,
  IMG_BATTLEFIELD_TOMBSTONE,
  IMG_SECTOR_USER_MARKER,
  IMG_SECTOR_USER_SPRITE_MASK,
  STATUS_LAYER,
  TILES_LAYER,
  USER_LAYER,
} from "@/drizzle/constants";
import type { GameAsset, UserData } from "@/drizzle/schema";
import type { BattleMaps } from "@/hooks/combat";
import {
  actionPointsAfterAction,
  calcActiveUser,
  stillInBattle,
} from "@/libs/combat/actions";
import {
  COMBAT_BORDER_BOTTOM,
  COMBAT_BORDER_LEFT,
  COMBAT_BORDER_RIGHT,
  COMBAT_BORDER_TOP,
} from "@/libs/combat/constants";
import type {
  CachedIntersections,
  CombatAction,
  GroundEffect,
  ReturnedBattle,
  ReturnedUserState,
  UserEffect,
} from "@/libs/combat/types";
import {
  getAffectedTiles,
  getBattleGrid,
  getClan,
  getEffectiveCurPool,
  getEffectiveMaxPool,
  getVillage,
} from "@/libs/combat/util";
import { getTileInfo } from "@/libs/threejs/biome";
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
import type { SpriteMixer } from "@/libs/threejs/SpriteMixer";
import { applyWaveShader } from "@/libs/threejs/shaders";
import {
  createShadowTexture,
  createSpriteMaterial,
  createTexture,
  drawStatusBar,
  loadTexture,
  profiler,
  showAnimation,
  updateStatusBar,
} from "@/libs/threejs/util";
import { playPreloadedAudio } from "@/utils/audio";
import type { BarrierTagType } from "@/validators/combat";
import type { HexagonalFaceMesh, TerrainHex } from "../hexgrid";
import { findHex, getPossibleActionTiles, PathCalculator } from "../hexgrid";

// Queue for non-movement SFX that should play after movement completes
type PendingSfx = { url: string; volume: number };
let pendingSfxQueue: PendingSfx[] = [];
let wasMovingLastFrame = false;

// PERFORMANCE: Cache for effect meshes to avoid getObjectByName calls
const effectMeshCache = new Map<string, Group>();

// PERFORMANCE: Cache for user meshes to avoid getObjectByName calls
const userMeshCache = new Map<string, Group>();

/**
 * Reset combat caches - call this when combat component unmounts
 * to prevent stale references on next combat start
 */
export const resetCombatCaches = () => {
  effectMeshCache.clear();
  userMeshCache.clear();
  pendingSfxQueue = [];
  wasMovingLastFrame = false;
};

/**
 * Validates whether an action can be performed on a target tile.
 * Used by both click handlers (for mobile compatibility) and tile highlighting.
 * Returns validation result along with computed data for reuse.
 */
export const validateActionTarget = (info: {
  user: ReturnedUserState;
  battle: ReturnedBattle;
  action: CombatAction | undefined;
  grid: Grid<TerrainHex>;
  target: TerrainHex;
  timeDiff: number;
  precomputedUserId?: string;
  precomputedActions?: CombatAction[];
}): {
  isValid: boolean;
  origin?: TerrainHex;
  possibleTiles?: Grid<TerrainHex>;
  greenTiles?: Set<TerrainHex>;
  redTiles?: Set<TerrainHex>;
} => {
  const { user, battle, action, grid, target, timeDiff } = info;

  // No action selected
  if (!action) return { isValid: false };

  // Get user's current position
  const origin = grid.getHex({ col: user.longitude, row: user.latitude });
  if (!origin) return { isValid: false };

  // Check if user is the active actor
  const { actor } = calcActiveUser(battle, user.userId, timeDiff, {
    precomputedUserId: info.precomputedUserId,
    precomputedActions: info.precomputedActions,
  });
  if (actor.userId !== user.userId) return { isValid: false };

  // Check if user has enough action points
  const { canAct } = actionPointsAfterAction(user, battle, action);
  if (!canAct) return { isValid: false };

  // Check action cooldown
  const isAvailable =
    !action.cooldown ||
    !action.lastUsedRound ||
    battle.round - action.lastUsedRound >= action.cooldown;
  if (!isAvailable) return { isValid: false };

  // Get possible tiles for the action
  const possibleTiles = getPossibleActionTiles(action, origin, grid);
  if (!possibleTiles) return { isValid: false };

  // Check if target is in possible tiles
  const targetInPossible = possibleTiles.filter((t) => t === target).size > 0;
  if (!targetInPossible) return { isValid: false };

  // Get affected tiles (green = valid, red = invalid)
  const { green: greenTiles, red: redTiles } = getAffectedTiles({
    a: origin,
    b: target,
    action,
    grid,
    restrictGrid: possibleTiles,
    ground: battle.groundEffects,
    userId: user.userId,
    users: battle.usersState,
  });

  // Target must be in green set and not in red set
  const isValid = greenTiles.size > 0 && !redTiles.has(target);

  return { isValid, origin, possibleTiles, greenTiles, redTiles };
};

/**
 * Creates hexagonal grid & draw it using js. Return groups of objects drawn
 * Similar to drawSector but for combat, with expanded border for assets
 */
export const drawCombatBackground = (
  width: number,
  battle: ReturnedBattle,
  prng: () => number,
  lightLayout = false,
) => {
  // Calculate hex size
  const hexsize =
    width / (battle.width - HEX_STACKING_DISPLACEMENT * (battle.width - 1));

  // Used for procedural map generation
  const noiseGen = createNoise2D(prng);
  const assetsGen = createNoise2D(prng);

  // Groups for organizing objects
  const group_dirt = new Group();
  const group_tiles = new Group();
  const group_edges = new Group();
  const group_names = new Group();
  const group_assets = new Group();

  // Create single grid with border included
  const honeycombGrid = getBattleGrid(hexsize, battle, {
    x: -hexsize * 0.5,
    y: -hexsize * 0.5,
  }).map((tile) => {
    // Set noise-based level using grid coordinates
    const nx = tile.col / battle.width - 0.5;
    const ny = tile.row / battle.height - 0.5;
    tile.level = noiseGen(nx, ny) / 2 + 0.5;
    tile.assetStrength = assetsGen(nx, ny) / 2 + 0.5;
    return tile;
  });

  // Get hex points for geometry construction
  const { points, groundPoints, groundEdges } = getHexPoints();

  // Calculate UV coordinates once using first tile
  const firstTile = honeycombGrid.toArray()[0];
  const { groundUVArray, tileUVArray } = calculateHexUVCoordinates(
    firstTile,
    points,
    groundPoints,
  );

  // Line material to use for edges
  const lineMaterial = new LineBasicMaterial({ color: 0x555555 });

  // Arrays to collect geometries for merging (major performance optimization)
  const groundGeometries: BufferGeometry[] = [];
  const groundEdgeGeometries: BufferGeometry[] = [];
  const tileEdgeGeometries: BufferGeometry[] = [];

  // Draw the tiles
  honeycombGrid.forEach((tile) => {
    if (tile) {
      // Determine if this is a battle tile (playable area) or border tile
      const isBattleTile =
        tile.col >= COMBAT_BORDER_LEFT &&
        tile.col < battle.width - COMBAT_BORDER_RIGHT &&
        tile.row >= COMBAT_BORDER_BOTTOM &&
        tile.row < battle.height - COMBAT_BORDER_TOP;

      // Get tile info (material, sprites)
      const { material, sprites, asset } = getTileInfo(
        prng,
        tile,
        battle.background,
        lightLayout,
      );
      tile.asset = asset;

      // Add sprites to border tiles, or to battle tiles if they're marked as small
      if (sprites && sprites.length > 0 && !lightLayout) {
        sprites.forEach((sprite) => {
          const isSmall = sprite.userData.small === true;
          if (!isBattleTile || isSmall) {
            // Store tile location for opacity updates
            sprite.userData.tileKey = `${tile.col},${tile.row}`;
            // Enable transparency for opacity changes
            if (sprite.material && !isSmall) {
              sprite.material.transparent = true;
              sprite.material.opacity = 1.0;
            }
            sprite.position.set(sprite.position.x, sprite.position.y, ASSETS_LAYER);
            sprite.matrixAutoUpdate = false;
            sprite.updateMatrix();
            group_assets.add(sprite);
          }
        });
      }

      // Corners of the tile
      const corners = tile.corners;

      // Calculate offset for ocean tiles (they are displaced down for depth effect)
      const { length, offsetLength, offsetLayer } = calculateTileOffset(
        corners,
        asset,
        lightLayout,
      );

      // Create the corners of the ground below
      const groundCorners = createGroundCorners(corners, offsetLength, length);

      // Top face of the tile
      const geometry = createTileGeometry({
        corners,
        points,
        tileUVArray,
        offsetLength,
        offsetLayer,
        layer: TILES_LAYER,
      });

      const clonedMaterial = material?.clone();

      // Apply wave shader to ocean tiles
      if (asset === "ocean" && clonedMaterial) {
        const randomOffset = Math.random() * Math.PI * 2;
        applyWaveShader(clonedMaterial, randomOffset);
      }

      const mesh = new Mesh(geometry, clonedMaterial);

      // For battle tiles, use battle grid coordinates; for border tiles use expanded coordinates
      mesh.name = `${tile.row},${tile.col}`;
      mesh.userData.type = "tile";
      mesh.userData.tile = tile;
      mesh.userData.originalColor = clonedMaterial?.color.clone();
      mesh.userData.highlight = false;
      mesh.userData.selected = false;
      mesh.userData.canClick = false;
      mesh.userData.isBattleTile = isBattleTile;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group_tiles.add(mesh);

      // Collect tile edge geometry for merging (performance optimization)
      const edgeGeometry = new EdgesGeometry(geometry);
      tileEdgeGeometries.push(edgeGeometry);

      // Ground part of the tile
      if (!lightLayout) {
        const groundGeometry = createGroundGeometry({
          groundCorners,
          groundPoints,
          groundUVArray,
          layer: DIRT_LAYER,
        });

        // Instead of creating individual meshes, collect geometries for merging
        groundGeometries.push(groundGeometry);

        // Collect edge geometries
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

      // Draw tile name for battle grid tiles
      if (tile.name) {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const fontSize = 18;
          const text = tile.name;
          ctx.font = `${fontSize}px Arial`;
          const textWidth = ctx.measureText(text).width;

          canvas.width = Math.ceil(textWidth + 12);
          canvas.height = Math.ceil(fontSize + 10);

          ctx.font = `${fontSize}px arial narrow`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.globalAlpha = 0.3;
          ctx.fillStyle = "white";
          ctx.lineWidth = 4;

          const cx = canvas.width / 2;
          const cy = canvas.height / 2;
          ctx.fillText(text, cx, cy);

          const texture = createTexture(canvas);
          texture.needsUpdate = true;
          const spriteMaterial = new SpriteMaterial({
            map: texture,
          });
          const sprite = new Sprite(spriteMaterial);

          sprite.position.set(tile.x, tile.y - (2 * cy) / 3, ASSETS_LAYER);

          const scale = (Math.max(tile.height, tile.width) * 0.2) / fontSize;
          sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);

          // Performance optimization: Static name sprites never move
          sprite.matrixAutoUpdate = false;
          sprite.updateMatrix();

          group_names.add(sprite);
        }
      }
    }
  });

  // Merge all ground geometries into a single mesh (huge performance gain)
  if (!lightLayout && groundGeometries.length > 0) {
    const mergedGroundGeometry = mergeBufferGeometries(groundGeometries);
    // Use the first tile's dirt material
    const firstTile = honeycombGrid.toArray()[0];
    if (firstTile) {
      const { dirt } = getTileInfo(prng, firstTile, battle.background, lightLayout);
      const mergedGroundMesh = new Mesh(mergedGroundGeometry, dirt);
      mergedGroundMesh.userData.type = "ground_merged";
      mergedGroundMesh.matrixAutoUpdate = false;
      mergedGroundMesh.updateMatrix();
      group_dirt.add(mergedGroundMesh);
    }

    // Merge all ground edge geometries into a single line mesh
    if (groundEdgeGeometries.length > 0) {
      const mergedEdgeGeometry = mergeBufferGeometries(groundEdgeGeometries);
      const mergedEdgeMesh = new Line(mergedEdgeGeometry, lineMaterial);
      mergedEdgeMesh.matrixAutoUpdate = false;
      mergedEdgeMesh.updateMatrix();
      group_dirt.add(mergedEdgeMesh);
    }
  }

  // Merge all tile edge geometries into a single mesh (performance optimization)
  if (tileEdgeGeometries.length > 0) {
    const mergedTileEdgeGeometry = mergeBufferGeometries(tileEdgeGeometries);
    const mergedTileEdgeMesh = new LineSegments(mergedTileEdgeGeometry, lineMaterial);
    mergedTileEdgeMesh.matrixAutoUpdate = false;
    mergedTileEdgeMesh.updateMatrix();
    group_edges.add(mergedTileEdgeMesh);
  }

  // Group for dynamically highlighted edges (rendered on top of base edges)
  const group_highlight_edges = new Group();

  // Sort assets by position (one-time during scene setup)
  group_assets.children.sort((a, b) => b.position.y - a.position.y);

  return {
    group_dirt,
    group_tiles,
    group_edges,
    group_highlight_edges,
    group_names,
    group_assets,
    honeycombGrid,
  };
};

/**
 * Draw/update the users on the map. Should be called on every render
 */
export const drawCombatEffects = (info: {
  groupEffects: Group;
  battle: ReturnedBattle;
  grid: Grid<TerrainHex>;
  animationId: number;
  spriteMixer: SpriteMixer;
  gameAssets: GameAsset[];
  sfxEnabled?: boolean;
  sfxVolume?: number;
  isAnyUserMoving?: boolean;
}) => {
  const endMark = profiler.mark("drawCombatEffects");

  // Destructure
  const { battle, groupEffects, spriteMixer, animationId, gameAssets } = info;
  const { groundEffects, usersEffects, usersState } = battle;
  const isMoving = info.isAnyUserMoving ?? false;

  // If movement just completed, play all queued SFX
  if (wasMovingLastFrame && !isMoving && pendingSfxQueue.length > 0) {
    // Small delay to let movement complete visually
    setTimeout(() => {
      pendingSfxQueue.forEach((sfx) => {
        void playPreloadedAudio(sfx.url, sfx.volume);
      });
      pendingSfxQueue = [];
    }, 50);
  }
  wasMovingLastFrame = isMoving;

  // Record of drawn IDs
  const drawnIds = new Set<string>();

  // Draw the ground effects
  groundEffects.forEach((effect) => {
    const hex = findHex(info.grid, {
      x: effect.longitude,
      y: effect.latitude,
    });
    drawCombatEffect({
      groupEffects,
      effect,
      animationId,
      hex,
      spriteMixer,
      drawnIds,
      gameAssets,
      sfxEnabled: info.sfxEnabled,
      sfxVolume: info.sfxVolume,
      isAnyUserMoving: isMoving,
    });
  });
  // Draw all user effects
  usersEffects.forEach((effect) => {
    const user = usersState.find((u) => u.userId === effect.targetId);
    if (user && stillInBattle(user, usersEffects)) {
      const hex = findHex(info.grid, {
        x: user.longitude,
        y: user.latitude,
      });
      drawCombatEffect({
        groupEffects,
        effect,
        animationId,
        hex,
        spriteMixer,
        drawnIds,
        gameAssets,
        sfxEnabled: info.sfxEnabled,
        sfxVolume: info.sfxVolume,
        isAnyUserMoving: isMoving,
      });
    }
  });

  // Hide all which are not used anymore
  groupEffects.children.forEach((object) => {
    if (!drawnIds.has(object.name)) {
      object.visible = false;
      // PERFORMANCE: Remove from cache when hidden
      effectMeshCache.delete(object.name);
    }
  });

  profiler.reportCount("combat_effects", drawnIds.size);
  endMark();
};

/**
 * Draw a combat effect on the map
 */
export const drawCombatEffect = (info: {
  groupEffects: Group;
  effect: GroundEffect | UserEffect;
  animationId: number;
  hex?: TerrainHex;
  spriteMixer: SpriteMixer;
  drawnIds: Set<string>;
  gameAssets: GameAsset[];
  sfxEnabled?: boolean;
  sfxVolume?: number;
  isAnyUserMoving?: boolean;
}) => {
  // Destructure
  const { effect, groupEffects, animationId, hex, drawnIds } = info;
  const { spriteMixer, gameAssets } = info;
  const isMoving = info.isAnyUserMoving ?? false;

  // Helper to play or queue SFX based on movement state
  const playOrQueueSfx = (url: string, volume: number) => {
    if (isMoving) {
      // Queue SFX to play after movement completes
      pendingSfxQueue.push({ url, volume });
    } else {
      // No movement, play immediately
      void playPreloadedAudio(url, volume);
    }
  };

  if (hex) {
    if (
      effect.staticAssetPath ||
      effect.staticAnimation ||
      effect.appearAnimation ||
      effect.disappearAnimation ||
      effect.appearSfx ||
      effect.disappearSfx
    ) {
      const { height: h, width: w } = hex;
      // PERFORMANCE: Use cache instead of getObjectByName
      let asset = effectMeshCache.get(effect.id) as Group | undefined;
      if (!asset) {
        asset = groupEffects.getObjectByName(effect.id) as Group | undefined;
        if (asset) effectMeshCache.set(effect.id, asset);
      }
      if (!asset) {
        // Group for the asset
        asset = new Group();
        asset.name = effect.id;
        asset.userData.type = effect.type; // e.g. "barrier"
        // Sprite to show
        if (effect.staticAssetPath) {
          const obj = gameAssets.find((a) => a.id === effect.staticAssetPath);
          if (obj) {
            const texture = loadTexture(obj.image);
            const material = createSpriteMaterial(texture);
            const sprite = new Sprite(material);
            sprite.scale.set(w, h, 1);
            sprite.position.set(w / 2, h / 2, 0);
            asset.add(sprite);
          }
        }
        // If there is an appear animation, show it. Mark it for hiding,
        // which we catch and use to remove it
        if (effect.appearAnimation && animationId !== 0) {
          const obj = gameAssets.find((a) => a.id === effect.appearAnimation);
          if (obj) {
            const actionSprite = showAnimation({
              gameAsset: obj,
              spriteMixer,
              scale: 50,
              position: { x: w / 2, y: h / 2 },
              layer: 5,
            });
            if (actionSprite) asset.add(actionSprite);
          }
        }
        // If there is an appear SFX, play or queue it
        if (effect.appearSfx && animationId !== 0 && info.sfxEnabled) {
          try {
            const sfx = gameAssets.find((a) => a.id === effect.appearSfx);
            const url = sfx?.url;
            if (url) {
              playOrQueueSfx(url, info.sfxVolume ?? 0.8);
            }
          } catch {}
        }
        // If there is a static animation, show it.
        if (effect.staticAnimation) {
          const obj = gameAssets.find((a) => a.id === effect.staticAnimation);
          if (obj) {
            const actionSprite = showAnimation({
              gameAsset: obj,
              spriteMixer,
              playInfinite: true,
              scale: 50,
              position: { x: w / 2, y: h / 2 },
              layer: 5,
            });
            if (actionSprite) asset.add(actionSprite);
          }
        }
        // Status bar
        if (effect.type === "barrier") {
          const hp_back = drawStatusBar({
            width: w,
            height: h,
            yPosition: h + w / 3,
            color: "gray",
            stroke: true,
            name: "hp_background",
            yOffset: 0,
            layer: STATUS_LAYER,
          });
          const hp_bar = drawStatusBar({
            width: w,
            height: h,
            yPosition: h + w / 3,
            color: "firebrick",
            stroke: true,
            name: "hp_current",
            yOffset: 0,
            layer: STATUS_LAYER,
          });
          asset.add(hp_back);
          asset.add(hp_bar);
          hp_bar.visible = false;
          hp_back.visible = false;
        }
        // Add to group and cache
        groupEffects.add(asset);
        effectMeshCache.set(effect.id, asset);
      }

      // Set visibility
      if (asset) {
        if (effect.power !== undefined && effect.power <= 0) {
          asset.visible = false;
          // Play or queue disappear SFX when hiding
          if (effect.disappearSfx && info.sfxEnabled && animationId !== 0) {
            try {
              const sfx = gameAssets.find((a) => a.id === effect.disappearSfx);
              const url = sfx?.url;
              if (url) {
                playOrQueueSfx(url, info.sfxVolume ?? 0.8);
              }
            } catch {}
          }
        } else {
          asset.visible = true;
          asset.userData.tile = hex;
          const { x, y } = hex.center;
          asset.position.set(-x, -y, EFFECTS_LAYER);
          drawnIds.add(asset.name);
        }
      }
    }
  }
};

/**
 * User sprite, which loads the avatar image and displays the health bar as a js sprite
 */
export const createUserSprite = (
  userData: ReturnedUserState,
  hex: TerrainHex,
  playerId: string | undefined,
  battle: ReturnedBattle,
) => {
  // If not there, nope
  if (userData.curHealth <= 0 || userData.fledBattle) return undefined;

  // Group is used to group components of the user Marker
  const group = new Group();
  const { height: h, width: w } = hex;

  // Shadow - procedural blurred ellipse for natural soft shadow
  const shadowTexture = createShadowTexture(128, 64, 0.45);
  shadowTexture.generateMipmaps = false;
  shadowTexture.minFilter = LinearFilter;
  const shadow_material = new SpriteMaterial({
    map: shadowTexture,
    transparent: true,
    depthWrite: false,
  });
  const shadow_sprite = new Sprite(shadow_material);
  shadow_sprite.scale.set(w * 0.8, h * 0.5, 1);
  shadow_sprite.position.set(w / 2, h * 0.3, USER_LAYER);
  group.add(shadow_sprite);

  // User marker background or raw image
  const noMarker = userData.isAi && userData.isOriginal;
  if (noMarker) {
    const map = loadTexture(
      userData.avatar ? `${userData.avatar}?1=1` : IMG_AVATAR_DEFAULT,
    );
    map.generateMipmaps = false;
    map.minFilter = LinearFilter;
    if (userData.direction === "right") {
      map.repeat.set(-1, 1);
      map.offset.set(1, 0);
    }
    const material = createSpriteMaterial(map);
    material.side = DoubleSide;
    const sprite = new Sprite(material);
    sprite.scale.set(-2 * h * 0.8, 2 * h * 0.8, 1);
    sprite.position.set(w / 2, h * 0.9, USER_LAYER);
    group.add(sprite);
    // Star on summons
    if (userData.isSummon && userData.controllerId === playerId) {
      const marker = loadTexture(IMG_BATTLEFIELD_STAR);
      const markerMat = createSpriteMaterial(marker);
      const markerSprite = new Sprite(markerMat);
      markerSprite.scale.set(h / 2.5, h / 2.5, 1);
      markerSprite.position.set(w / 2, h * 0.2, USER_LAYER);
      group.add(markerSprite);
    }
  } else {
    // Highlight background in village color
    const highlightTexture = loadTexture(IMG_SECTOR_USER_MARKER);
    const highlightMaterial = createSpriteMaterial(highlightTexture, highlightTexture);

    // Highlight sprite
    const village = getVillage(battle, userData.villageId);
    const highlightColor = village
      ? parseInt(village.hexColor.replace("#", ""), 16)
      : 0x000000;
    const highlightSprite = new Sprite(highlightMaterial);
    highlightSprite.userData.type = "marker";
    highlightSprite.scale.set(h, h * 1.2, 1);
    highlightSprite.position.set(w / 2, h * 0.9, USER_LAYER);
    highlightSprite.userData.type = "userMarker";
    highlightSprite.userData.userId = userData.userId;
    highlightSprite.material.color.setHex(highlightColor);
    group.add(highlightSprite);

    // Marker background in white
    const marker = loadTexture(IMG_SECTOR_USER_MARKER);
    const markerMat = createSpriteMaterial(marker, marker);
    const markerSprite = new Sprite(markerMat);
    markerSprite.userData.type = "marker";
    markerSprite.scale.set(0.9 * h, h * 1.1, 1);
    markerSprite.position.set(w / 2, h * 0.9, USER_LAYER);
    group.add(markerSprite);

    // Avatar Sprite
    const alphaMap = loadTexture(IMG_SECTOR_USER_SPRITE_MASK);
    const map = loadTexture(
      userData.avatar ? `${userData.avatar}?1=1` : IMG_AVATAR_DEFAULT,
    );
    map.generateMipmaps = false;
    map.minFilter = LinearFilter;
    const material = createSpriteMaterial(map, alphaMap);
    const sprite = new Sprite(material);
    sprite.scale.set(h * 0.8, h * 0.8, 1);
    sprite.position.set(w / 2, h * 1.0, USER_LAYER);
    group.add(sprite);

    // Clan if it is there
    const clan = getClan(battle, userData.clanId);
    if (clan?.image) {
      const clanTexture = loadTexture(clan.image);
      const clanBorderMaterial = new SpriteMaterial({
        map: alphaMap,
        alphaMap: alphaMap,
      });
      const clanBorderSprite = new Sprite(clanBorderMaterial);
      clanBorderSprite.material.color.setHex(0xffd700);
      clanBorderSprite.scale.set(-1 * h * 0.3 - 2, h * 0.3 + 2, 1);
      clanBorderSprite.position.set(0.9 * w, h * 1.4, USER_LAYER);
      group.add(clanBorderSprite);
      const clanMaterial = createSpriteMaterial(clanTexture, alphaMap);
      const clanSprite = new Sprite(clanMaterial);
      clanSprite.scale.set(-1 * h * 0.3, h * 0.3, 1);
      clanSprite.position.set(0.9 * w, h * 1.4, USER_LAYER);
      group.add(clanSprite);
    }
  }

  // If this is the original and our user (we have SP/CP), then show a star
  if ("curStamina" in userData && userData.isOriginal && !userData.isAi) {
    const marker = loadTexture(IMG_BATTLEFIELD_STAR);
    const markerMat = createSpriteMaterial(marker);
    const markerSprite = new Sprite(markerMat);
    markerSprite.scale.set(h / 2.5, h / 2.5, 1);
    markerSprite.position.set(w / 2, h * 0.4, USER_LAYER);
    group.add(markerSprite);
  }

  // Health bar is shown on all
  const t = noMarker ? h / 8 : 0;
  const hp_background = drawStatusBar({
    width: w,
    height: h,
    yPosition: h + w / 3,
    color: "gray",
    stroke: true,
    name: "hp_background",
    yOffset: t,
    layer: STATUS_LAYER,
  });
  const hp_bar = drawStatusBar({
    width: w,
    height: h,
    yPosition: h + w / 3,
    color: "firebrick",
    stroke: true,
    name: "hp_current",
    yOffset: t,
    layer: STATUS_LAYER,
  });
  group.add(hp_background);
  group.add(hp_bar);

  // Stamina Bar if available
  if ("curStamina" in userData && "maxStamina" in userData) {
    const sp_background = drawStatusBar({
      width: w,
      height: h,
      yPosition: h + w / 3,
      color: "gray",
      stroke: true,
      name: "sp_background",
      yOffset: t + 1,
      layer: STATUS_LAYER,
    });
    const sp_bar = drawStatusBar({
      width: w,
      height: h,
      yPosition: h + w / 3,
      color: "green",
      stroke: true,
      name: "sp_current",
      yOffset: t + 1,
      layer: STATUS_LAYER,
    });
    group.add(sp_background);
    group.add(sp_bar);
  }

  // Chakra Bar if available
  if ("curChakra" in userData && "maxChakra" in userData) {
    const cp_background = drawStatusBar({
      width: w,
      height: h,
      yPosition: h + w / 3,
      color: "gray",
      stroke: true,
      name: "cp_background",
      yOffset: t + 2,
      layer: STATUS_LAYER,
    });
    const cp_bar = drawStatusBar({
      width: w,
      height: h,
      yPosition: h + w / 3,
      color: "blue",
      stroke: true,
      name: "cp_current",
      yOffset: t + 2,
      layer: STATUS_LAYER,
    });
    group.add(cp_background);
    group.add(cp_bar);
  }

  // Create tombstone but hide it for now
  const tomb_texture = loadTexture(IMG_BATTLEFIELD_TOMBSTONE);
  const tomb_material = createSpriteMaterial(tomb_texture);
  const tomb_sprite = new Sprite(tomb_material);
  tomb_sprite.name = "tombstone";
  tomb_sprite.scale.set(h * 0.5, h * 0.5, 1);
  tomb_sprite.position.set(w / 2, h * 0.6, USER_LAYER);
  tomb_sprite.visible = false;
  group.add(tomb_sprite);

  // Name
  group.name = userData.userId;
  group.userData.type = "user";
  group.userData.userId = userData.userId;
  group.userData.hex = hex;

  return group;
};

/**
 * Sets the opacity of all children of an object
 */
export const setOpacity = (obj: Object3D | Group | Sprite, opacity: number) => {
  obj?.children.forEach((child) => {
    setOpacity(child, opacity);
  });
  if (obj && "material" in obj && obj?.material) {
    obj.material.opacity = opacity;
  }
};

/**
 * Sets the opacity of all children of an object
 */
export const setVisible = (obj: Object3D | Group | Sprite, visible: boolean) => {
  obj?.children.forEach((child) => {
    setVisible(child, visible);
  });
  if ("visible" in obj) {
    obj.visible = visible;
  }
};

// Track current tile (visual) and target tile (logical)
type MovementState = { path?: TerrainHex[]; index: number };
type UserMeshData = {
  hex?: TerrainHex;
  targetHex?: TerrainHex;
  movement?: MovementState;
  initialized?: boolean;
};
type GroupUsersData = {
  pathFinder?: PathCalculator;
  needsSort?: boolean;
};

/** Returns a cached PathCalculator on the users group, creating it if missing */
const getOrCreatePathFinder = (
  group_users: Group,
  grid: Grid<TerrainHex>,
): PathCalculator => {
  const data = (group_users.userData as GroupUsersData) ?? {};
  let ensured = data.pathFinder;
  if (!ensured) {
    ensured = new PathCalculator(grid);
    data.pathFinder = ensured;
    (group_users as unknown as { userData: GroupUsersData }).userData = data;
  }
  return ensured;
};

/** Marks the group as needing a sort on the next render */
const markGroupNeedsSort = (group: Group) => {
  const data = (group.userData as GroupUsersData) ?? {};
  data.needsSort = true;
  (group as unknown as { userData: GroupUsersData }).userData = data;
};

/** Ensures meshData exists and initializes current visual tile/position when first seen */
const getOrInitUserMeshData = (
  userMesh: Group,
  targetTile: TerrainHex,
): UserMeshData => {
  const meshData = (userMesh.userData as UserMeshData) ?? ({} as UserMeshData);
  if (!meshData.initialized) {
    meshData.hex = meshData.hex ?? targetTile;
    const { x, y } = targetTile.center;
    userMesh.position.set(-x, -y, 0);
    meshData.initialized = true;
  }
  meshData.movement = meshData.movement || { path: undefined, index: 0 };
  return meshData;
};

/** Computes a new path if target changed or path exhausted; updates meshData.targetHex */
const computePathIfNeeded = (
  meshData: UserMeshData,
  pathFinder: PathCalculator,
  targetTile: TerrainHex,
) => {
  const prevTarget = meshData.targetHex;
  const targetChanged =
    !prevTarget ||
    prevTarget.col !== targetTile.col ||
    prevTarget.row !== targetTile.row;
  const needNewPath =
    targetChanged ||
    !meshData.movement?.path ||
    (meshData.movement?.index ?? 0) >= (meshData.movement?.path?.length ?? 0);
  if (needNewPath) {
    const start: TerrainHex = meshData.hex ?? targetTile;
    const path = pathFinder.getShortestPath(start, targetTile) || [];
    const trimmed =
      path.length > 0 &&
      path[0] &&
      path[0].col === start.col &&
      path[0].row === start.row
        ? path.slice(1)
        : path;
    meshData.movement = { path: trimmed, index: 0 };
  }
  meshData.targetHex = targetTile;
};

/** Returns the per-frame movement speed for a tile */
const getTileSpeed = (tile: TerrainHex): number => {
  return (tile.width / 50) * 5; // tripled speed
};

/** Steps the mesh along its path or directly to target with clamped constant speed */
const stepAlongPath = (
  userMesh: Group,
  meshData: UserMeshData,
  targetTile: TerrainHex,
  speed: number,
  parentGroup: Group,
  onTileStep?: () => void,
) => {
  const { x: curX, y: curY } = userMesh.position;
  const moveTowards = (tx: number, ty: number, maxStep: number) => {
    const dx = tx - curX;
    const dy = ty - curY;
    const dist = Math.hypot(dx, dy);
    if (dist <= maxStep || dist === 0) {
      userMesh.position.set(tx, ty, 0);
      return true;
    } else {
      const nx = dx / dist;
      const ny = dy / dist;
      userMesh.position.set(curX + nx * maxStep, curY + ny * maxStep, 0);
      return false;
    }
  };

  // Easing function for speed multiplier: 0 at ends, 1 in middle. Clamp to a minimum to avoid stall
  const easedMultiplier = (progress: number, min = 0.35) => {
    const p = Math.max(0, Math.min(1, progress));
    const s = Math.sin(Math.PI * p);
    return Math.max(min, s);
  };

  const path = meshData.movement?.path;
  let index = meshData.movement?.index ?? 0;
  if (path && index < path.length) {
    const nextTile = path[index];
    if (!nextTile) return;
    const { x, y } = nextTile.center;
    // Compute progress along current segment for easing
    const startCenter = meshData.hex?.center ?? nextTile.center;
    const totalDist = Math.hypot((startCenter?.x ?? 0) - x, (startCenter?.y ?? 0) - y);
    const remaining = Math.hypot(-x - curX, -y - curY);
    const progress = totalDist > 0 ? 1 - remaining / totalDist : 1;
    const step = speed * easedMultiplier(progress);
    const reached = moveTowards(-x, -y, step);
    if (reached) {
      meshData.hex = nextTile;
      index += 1;
      meshData.movement = { path, index };
      if (onTileStep) onTileStep();
      markGroupNeedsSort(parentGroup);
      if (!path || index >= path.length) {
        const { x: tx, y: ty } = targetTile.center;
        userMesh.position.set(-tx, -ty, 0);
        meshData.hex = targetTile;
        meshData.movement = { path: undefined, index: 0 };
      }
    }
  } else {
    const { x, y } = targetTile.center;
    const startCenter = meshData.hex?.center ?? targetTile.center;
    const totalDist = Math.hypot((startCenter?.x ?? 0) - x, (startCenter?.y ?? 0) - y);
    const remaining = Math.hypot(-x - curX, -y - curY);
    const progress = totalDist > 0 ? 1 - remaining / totalDist : 1;
    const step = speed * easedMultiplier(progress);
    const reached = moveTowards(-x, -y, step);
    if (reached) {
      const previousHex = meshData.hex;
      meshData.hex = targetTile;
      if (parentGroup && previousHex !== targetTile) {
        markGroupNeedsSort(parentGroup);
      }
    }
  }
};

/**
 * Update asset opacity based on user positions
 * Makes assets transparent when users are on or near them
 */
const updateAssetOpacityForUsers = (
  group_assets: Group,
  users: ReturnedUserState[],
  grid: Grid<TerrainHex>,
) => {
  // Collect all tiles that should have transparent assets
  const affectedTiles = new Set<string>();

  users.forEach((user) => {
    if (user.curHealth > 0 && !user.fledBattle) {
      const userHex = grid.getHex({ col: user.longitude, row: user.latitude });
      if (userHex) {
        // Add current tile
        affectedTiles.add(`${userHex.col},${userHex.row}`);

        // Add adjacent tiles (neighbors) using ring
        const neighbors = grid.traverse(ring({ radius: 1, center: userHex }));
        neighbors.forEach((neighbor) => {
          if (neighbor) {
            affectedTiles.add(`${neighbor.col},${neighbor.row}`);
          }
        });
      }
    }
  });

  // Update opacity of all assets
  group_assets.children.forEach((asset) => {
    if (asset instanceof Sprite && asset.userData.small !== true) {
      // Get the tile this asset is on
      const assetTileKey = asset.userData.tileKey as string | undefined;

      if (assetTileKey && affectedTiles.has(assetTileKey)) {
        // User is on or near this asset - make it transparent
        if (asset.material && "opacity" in asset.material) {
          asset.material.opacity = 0.5;
        }
      } else {
        // No user nearby - restore full opacity
        if (asset.material && "opacity" in asset.material) {
          asset.material.opacity = 1.0;
        }
      }
    }
  });
};

/**
 * Draw/update the users on the map. Should be called on every render
 * Returns true if any user is currently animating movement
 */
export const drawCombatUsers = (info: {
  group_users: Group;
  users: ReturnedUserState[];
  usersEffects?: UserEffect[];
  grid: Grid<TerrainHex>;
  playerId: string | undefined;
  userData: UserData;
  battle: ReturnedBattle;
  group_assets?: Group;
  sfxEnabled?: boolean;
  sfxVolume?: number;
  gameAssets?: GameAsset[];
}): boolean => {
  const endMark = profiler.mark("drawCombatUsers");

  // Destruct
  const {
    users,
    group_users,
    grid,
    playerId,
    userData,
    group_assets,
    usersEffects,
    battle,
  } = info;
  // Cache or create a pathfinder for this group
  const pathFinder = getOrCreatePathFinder(group_users, grid);

  // Track if any user changed position (for asset opacity updates)
  let needsOpacityUpdate = false;

  // Track if any user is currently animating movement
  let anyUserMoving = false;

  // Store previous user positions to detect changes
  const userGroupData = group_users.userData as GroupUsersData & {
    lastUserPositions?: Map<string, string>;
  };
  const lastPositions = userGroupData.lastUserPositions || new Map<string, string>();
  const currentPositions = new Map<string, string>();

  // Draw the users
  const drawnIds = new Set<string>();
  users.forEach((user) => {
    const hex = findHex(grid, {
      x: user.longitude,
      y: user.latitude,
    });
    if (hex) {
      // Track current position
      const posKey = `${user.longitude},${user.latitude}`;
      currentPositions.set(user.userId, posKey);

      // Check if position changed
      const lastPos = lastPositions.get(user.userId);
      if (lastPos !== posKey) {
        needsOpacityUpdate = true;
      }

      // PERFORMANCE: Use cache instead of getObjectByName
      let userMesh = userMeshCache.get(user.userId) as Group | undefined;
      if (!userMesh) {
        userMesh = group_users.getObjectByName(user.userId) as Group | undefined;
        if (userMesh) userMeshCache.set(user.userId, userMesh);
      }
      if (!userMesh && hex) {
        // Always unhide current user
        if (user.userId === userData.userId) {
          user.avatar = userData.avatar;
          user.avatarLight = userData.avatarLight;
          user.username = userData.username;
        }
        userMesh = createUserSprite(user, hex, playerId, battle);
        if (userMesh) {
          group_users.add(userMesh);
          userMeshCache.set(user.userId, userMesh);
          markGroupNeedsSort(group_users);
          needsOpacityUpdate = true;
        }
      }
      // Get location
      if (userMesh && grid) {
        userMesh.visible = true;

        const targetTile: TerrainHex = hex;
        const meshData = getOrInitUserMeshData(userMesh, targetTile);
        computePathIfNeeded(meshData, pathFinder, targetTile);
        const speed = getTileSpeed(meshData.hex ?? targetTile);
        const onTileStep = () => {
          if (info.sfxEnabled) {
            try {
              const assets = info.gameAssets ?? [];
              const sfx = assets.find((a) => a.id === ID_SFX_MOVE);
              const url = sfx?.url;
              if (url) void playPreloadedAudio(url, (info.sfxVolume ?? 0.8) * 0.75);
            } catch {}
          }
        };
        stepAlongPath(userMesh, meshData, targetTile, speed, group_users, onTileStep);
        userMesh.userData = meshData;

        // Only check if not at target to determine if user is still moving
        const { x: curX, y: curY } = userMesh.position;
        const { x: targetX, y: targetY } = targetTile.center;
        const notAtTarget =
          Math.abs(curX - -targetX) > 0.01 || Math.abs(curY - -targetY) > 0.01;
        if (notAtTarget) {
          anyUserMoving = true;
        }
        // Handle remove users from combat.
        if (!stillInBattle(user, usersEffects) && user.hidden === undefined) {
          setVisible(userMesh, false);
          if (user.isOriginal) {
            const tombstone = userMesh.getObjectByName("tombstone") as Sprite;
            tombstone.visible = true;
          }
          user.hidden = true;
        }
        // Update status bars using effective pool values
        const maxHealth = getEffectiveMaxPool(user, usersEffects, "Health");
        const curHealth = getEffectiveCurPool(user, usersEffects, "Health");
        updateStatusBar("hp_current", userMesh, curHealth / maxHealth);
        if ("curStamina" in user && "maxStamina" in user) {
          const maxStamina = getEffectiveMaxPool(user, usersEffects, "Stamina");
          const curStamina = getEffectiveCurPool(user, usersEffects, "Stamina");
          updateStatusBar("sp_current", userMesh, curStamina / maxStamina);
        }
        if ("curChakra" in user && "maxChakra" in user) {
          const maxChakra = getEffectiveMaxPool(user, usersEffects, "Chakra");
          const curChakra = getEffectiveCurPool(user, usersEffects, "Chakra");
          updateStatusBar("cp_current", userMesh, curChakra / maxChakra);
        }

        drawnIds.add(userMesh.name);
      }
    }
  });

  // Only sort when a user has moved to a new tile (not during interpolation)
  // This optimization prevents O(n log n) sorting every frame (~60fps)
  const groupData = group_users.userData as GroupUsersData;
  if (groupData?.needsSort) {
    group_users.children.sort((a, b) => b.position.y - a.position.y);
    group_users.children.forEach((child, index) => {
      child.renderOrder = index;
    });
    groupData.needsSort = false;
  }

  // Hide all user counters which are not used anymore
  group_users.children.forEach((object) => {
    if (!drawnIds.has(object.name)) {
      object.visible = false;
      // PERFORMANCE: Remove from cache when hidden
      userMeshCache.delete(object.name);
    }
  });

  // Store current positions for next frame comparison
  userGroupData.lastUserPositions = currentPositions;
  group_users.userData = userGroupData;

  // Update asset opacity when users change positions
  if (group_assets && needsOpacityUpdate) {
    updateAssetOpacityForUsers(group_assets, battle.usersState, grid);
  }

  profiler.reportCount("combat_users", drawnIds.size);
  endMark();

  return anyUserMoving;
};

// Z offset for highlight edges to render above base edges
const HIGHLIGHT_EDGE_Z_OFFSET = 0.5;
const HIGHLIGHT_EDGE_Z_OFFSET_SELECTED = 0.6;

// Cache for highlight edge geometries (keyed by tile name)
const highlightEdgeGeometryCache = new Map<string, BufferGeometry>();

// Reusable materials for highlight edges (created once, reused across frames)
const highlightEdgeMaterials = {
  highlight: new LineBasicMaterial({
    color: new Color("rgb(100, 180, 255)"),
    depthTest: true,
  }),
  green: new LineBasicMaterial({
    color: new Color("rgb(0, 255, 100)"),
    depthTest: true,
  }),
  blue: new LineBasicMaterial({
    color: new Color("rgb(0, 150, 255)"),
    depthTest: true,
  }),
  red: new LineBasicMaterial({ color: new Color("rgb(255, 80, 80)"), depthTest: true }),
};

// Pool of reusable LineSegments objects
type HighlightEdgePool = {
  meshes: LineSegments[];
  activeCount: number;
};

/**
 * Get or create a cached edge geometry for a tile
 */
const getOrCreateEdgeGeometry = (
  mesh: HexagonalFaceMesh,
  tileName: string,
): BufferGeometry => {
  let geometry = highlightEdgeGeometryCache.get(tileName);
  if (!geometry) {
    geometry = new EdgesGeometry(mesh.geometry);
    highlightEdgeGeometryCache.set(tileName, geometry);
  }
  return geometry;
};

/**
 * Get a LineSegments from the pool or create a new one
 */
const getPooledEdgeMesh = (
  pool: HighlightEdgePool,
  geometry: BufferGeometry,
  material: LineBasicMaterial,
  zOffset: number,
): LineSegments => {
  let edgeMesh: LineSegments;

  const existingMesh = pool.meshes[pool.activeCount];
  if (pool.activeCount < pool.meshes.length && existingMesh) {
    // Reuse existing mesh from pool
    edgeMesh = existingMesh;
    edgeMesh.geometry = geometry;
    edgeMesh.material = material;
    edgeMesh.visible = true;
  } else {
    // Create new mesh and add to pool
    edgeMesh = new LineSegments(geometry, material);
    pool.meshes.push(edgeMesh);
  }

  edgeMesh.position.z = zOffset;
  pool.activeCount++;
  return edgeMesh;
};

/**
 * Reset pool for next frame (hide all meshes, reset counter)
 */
const resetEdgePool = (pool: HighlightEdgePool) => {
  for (let i = 0; i < pool.activeCount; i++) {
    const mesh = pool.meshes[i];
    if (mesh) mesh.visible = false;
  }
  pool.activeCount = 0;
};

/**
 * Highlight possible squares based on action
 * Uses cached intersections to avoid redundant raycasting
 * Performance optimized: Uses geometry caching and object pooling
 */
export const highlightTiles = (info: {
  group_tiles: Group;
  group_highlight_edges: Group;
  cachedIntersections: CachedIntersections;
  user: ReturnedUserState;
  timeDiff: number;
  action: CombatAction | undefined;
  battle: ReturnedBattle;
  grid: Grid<TerrainHex>;
  currentHighlights: Set<string>;
  precomputedActions?: CombatAction[];
}) => {
  const endMark = profiler.mark("highlightTiles");

  // Definitions
  const {
    group_tiles,
    group_highlight_edges,
    user,
    battle,
    currentHighlights,
    action,
    grid,
    timeDiff,
  } = info;
  const battleTileIntersects = info.cachedIntersections.battleTiles;
  const hit = battleTileIntersects.length > 0 && battleTileIntersects[0];

  // Get or create the edge mesh pool (stored on group userData for persistence)
  let pool = group_highlight_edges.userData.edgePool as HighlightEdgePool | undefined;
  if (!pool) {
    pool = { meshes: [], activeCount: 0 };
    group_highlight_edges.userData.edgePool = pool;
  }

  // Reset pool - hide all previously active meshes
  resetEdgePool(pool);

  // Get user's origin and possible tiles for highlighting
  const origin = user && grid.getHex({ col: user.longitude, row: user.latitude });
  const highlights = getPossibleActionTiles(action, origin, grid);

  // Check if user can use tiles (actor check + action points)
  const { actor } = calcActiveUser(battle, user.userId, timeDiff, {
    precomputedUserId: user.userId,
    precomputedActions: info.precomputedActions,
  });
  const { canAct } = actionPointsAfterAction(user, battle, action);
  const canUseTile = actor.userId === user.userId && canAct;

  // Highlight fields on the map where action can be applied
  const newHighlights = new Set<string>();
  if (highlights && canUseTile) {
    highlights.forEach((tile) => {
      if (tile) {
        const tileName = `${tile.row},${tile.col}`;
        const mesh = group_tiles.getObjectByName(tileName) as HexagonalFaceMesh;
        if (mesh) {
          mesh.userData.highlight = true;
          newHighlights.add(mesh.name);

          // Get cached geometry and pooled mesh for highlight edge
          const geometry = getOrCreateEdgeGeometry(mesh, tileName);
          const edgeMesh = getPooledEdgeMesh(
            pool,
            geometry,
            highlightEdgeMaterials.highlight,
            HIGHLIGHT_EDGE_Z_OFFSET,
          );
          if (!edgeMesh.parent) group_highlight_edges.add(edgeMesh);
        }
      }
    });
  }

  // Is this a move action (if so, we color the selected green tile blue instead)
  const hasMove = action?.effects?.find((e) => e.type === "move");

  // Highlight intersected tile using shared validation
  const newSelection = new Set<string>();
  if (hit && action && canUseTile) {
    const intersected = hit.object as HexagonalFaceMesh;
    const targetTile = intersected.userData.tile as TerrainHex;

    // Use shared validation function for the actual target
    const {
      isValid,
      greenTiles: green,
      redTiles: red,
    } = validateActionTarget({
      user,
      battle,
      action,
      grid,
      target: targetTile,
      timeDiff,
      precomputedUserId: user.userId,
      precomputedActions: info.precomputedActions,
    });

    // Only highlight if we have valid green/red tiles from validation
    if (green && red) {
      // Highlight the tiles in different colors
      green.forEach((tile) => {
        const name = `${tile.row},${tile.col}`;
        const mesh = group_tiles.getObjectByName(name) as HexagonalFaceMesh;
        if (mesh) {
          mesh.userData.selected = true;
          mesh.userData.canClick = true;
          const originalColor = mesh.userData.originalColor;
          if (originalColor) {
            const tintedColor = originalColor.clone();
            if (hasMove && tile === targetTile) {
              // Tint with blue for move destination
              tintedColor.lerp(new Color("rgb(0, 150, 255)"), 0.8);
            } else {
              // Tint with green for valid targets
              tintedColor.lerp(new Color("rgb(0, 255, 100)"), 0.8);
            }
            mesh.material.color.copy(tintedColor);
          }
          // Get cached geometry and pooled mesh for selected edge
          const geometry = getOrCreateEdgeGeometry(mesh, name);
          const material =
            hasMove && tile === targetTile
              ? highlightEdgeMaterials.blue
              : highlightEdgeMaterials.green;
          const edgeMesh = getPooledEdgeMesh(
            pool,
            geometry,
            material,
            HIGHLIGHT_EDGE_Z_OFFSET_SELECTED,
          );
          if (!edgeMesh.parent) group_highlight_edges.add(edgeMesh);
          newSelection.add(name);
        }
      });
      red.forEach((tile) => {
        const name = `${tile.row},${tile.col}`;
        const mesh = group_tiles.getObjectByName(name) as HexagonalFaceMesh;
        if (mesh) {
          mesh.userData.selected = true;
          mesh.userData.canClick = false;
          const originalColor = mesh.userData.originalColor;
          if (originalColor) {
            // Tint with red for invalid targets
            const tintedColor = originalColor.clone();
            tintedColor.lerp(new Color("rgb(255, 50, 50)"), 0.2);
            mesh.material.color.copy(tintedColor);
          }
          // Get cached geometry and pooled mesh for red edge
          const geometry = getOrCreateEdgeGeometry(mesh, name);
          const edgeMesh = getPooledEdgeMesh(
            pool,
            geometry,
            highlightEdgeMaterials.red,
            HIGHLIGHT_EDGE_Z_OFFSET_SELECTED,
          );
          if (!edgeMesh.parent) group_highlight_edges.add(edgeMesh);
          newSelection.add(name);
        }
      });
      // Set cursor type on highlight
      if (
        (document.body.style.cursor === "default" ||
          document.body.style.cursor === "") &&
        green.size > 0 &&
        isValid
      ) {
        document.body.style.cursor = "pointer";
      } else if (
        document.body.style.cursor === "pointer" &&
        (green.size === 0 || !isValid)
      ) {
        document.body.style.cursor = "default";
      }
    }
  }

  // Apply colors to all tiles based on their state
  // Process all tiles that were previously highlighted or selected
  currentHighlights.forEach((name) => {
    const isHighlighted = newHighlights.has(name);
    const isSelected = newSelection.has(name);
    const mesh = group_tiles.getObjectByName(name) as HexagonalFaceMesh;

    if (mesh?.userData.originalColor) {
      // Update states
      mesh.userData.highlight = isHighlighted;
      if (!isSelected) {
        mesh.userData.selected = false;
        mesh.userData.canClick = false;
      }

      // Apply color based on priority: selection > highlight > original
      if (isSelected) {
        // Selection color already applied in the selection loop above
      } else if (isHighlighted) {
        // Apply gray tint for highlighted tiles
        const highlightColor = mesh.userData.originalColor.clone();
        highlightColor.lerp(new Color("rgb(80, 80, 80)"), 0.7);
        mesh.material.color.copy(highlightColor);
      } else {
        // Reset to original if neither highlighted nor selected
        mesh.material.color.copy(mesh.userData.originalColor);
      }
    }
  });

  endMark();
  return new Set([...newHighlights, ...newSelection]);
};

/**
 * Highlight user information like health bars on intersection
 * Uses cached intersections to avoid redundant raycasting
 */
export const highlightUsers = (info: {
  group_users: Group;
  cachedIntersections: CachedIntersections;
  userId: string;
  users: ReturnedUserState[];
  currentHighlights: Set<string>;
}) => {
  const endMark = profiler.mark("highlightUsers");

  // Definitions
  const { group_users, users, userId, currentHighlights } = info;
  const battleTileIntersects = info.cachedIntersections.battleTiles;
  const hit = battleTileIntersects.length > 0 && battleTileIntersects[0];
  const newSelection = new Set<string>();
  if (hit) {
    const intersected = hit.object as HexagonalFaceMesh;
    const targetTile = intersected.userData.tile;
    const target = users.find(
      (u) =>
        u.longitude === targetTile.col &&
        u.latitude === targetTile.row &&
        u.curHealth > 0 &&
        u.fledBattle === false,
    );
    if (target) {
      const userMesh = group_users.getObjectByName(target.userId) as Group;
      if (userMesh) {
        setStatusBarVisibility(userMesh, true);
        newSelection.add(target.userId);
      }
    }
  }
  // The active userId we always show status bars
  const userMesh = group_users.getObjectByName(userId) as Group;
  if (userMesh) {
    setStatusBarVisibility(userMesh, true);
    newSelection.add(userId);
  }
  // Remove highlights from tiles that are no longer in the path
  currentHighlights.forEach((name) => {
    if (!newSelection.has(name)) {
      const userMesh = group_users.getObjectByName(name) as Group;
      if (userMesh) setStatusBarVisibility(userMesh, false);
    }
  });

  endMark();
  return newSelection;
};

export const setStatusBarVisibility = (userMesh: Group, visible: boolean) => {
  const hp_background = userMesh.getObjectByName("hp_background") as Sprite;
  if (hp_background) {
    hp_background.visible = visible;
  }
  const hp_current = userMesh.getObjectByName("hp_current") as Sprite;
  if (hp_current) {
    hp_current.visible = visible;
  }
  const sp_background = userMesh.getObjectByName("sp_background") as Sprite;
  if (sp_background) {
    sp_background.visible = visible;
  }
  const sp_current = userMesh.getObjectByName("sp_current") as Sprite;
  if (sp_current) {
    sp_current.visible = visible;
  }
  const cp_background = userMesh.getObjectByName("cp_background") as Sprite;
  if (cp_background) {
    cp_background.visible = visible;
  }
  const cp_current = userMesh.getObjectByName("cp_current") as Sprite;
  if (cp_current) {
    cp_current.visible = visible;
  }
};

/**
 * Highlight different things in the environment based on raycaster
 * Uses cached intersections to avoid redundant raycasting
 */
export const highlightTooltips = (info: {
  group_ground: Group;
  cachedIntersections: CachedIntersections;
  battle: ReturnedBattle;
  currentTooltips: Set<string>;
}) => {
  // Definitions
  const { group_ground, battle, currentTooltips } = info;
  const intersects = info.cachedIntersections.ground;
  const newTooltips = new Set<string>();

  // Barriers
  const barrier = intersects.find((i) => i.object.parent?.userData.type === "barrier")
    ?.object.parent;
  if (barrier) {
    // Get the sprites
    const background = barrier.getObjectByName("hp_background") as Sprite;
    const bar = barrier.getObjectByName("hp_current") as Sprite;
    background.visible = true;
    bar.visible = true;
    // Update HP of barrier
    const effect = battle.groundEffects.find((e) => e.id === barrier.name);
    if (effect) {
      const typedEffect = effect as unknown as BarrierTagType;
      updateStatusBar(
        "hp_current",
        barrier as Group,
        typedEffect.curHealth / typedEffect.maxHealth,
      );
    }
    // Remember that we drew this
    newTooltips.add(barrier.name);
  }

  // Remove highlights from tiles that are no longer in the path
  currentTooltips.forEach((name) => {
    if (!newTooltips.has(name)) {
      const mesh = group_ground.getObjectByName(name) as Group;
      if (!mesh) return;
      const background = mesh.getObjectByName("hp_background") as Sprite;
      const bar = mesh.getObjectByName("hp_current") as Sprite;
      if (!background || !bar) return;
      background.visible = false;
      bar.visible = false;
    }
  });
  return newTooltips;
};

/**
 * Hover data for combat tooltips - can include user effects, ground effects, or both
 */
export type CombatHoverData = {
  tileKey: string;
  userId?: string;
  position: { x: number; y: number };
};

/**
 * Detect hover on tiles and collect both user and ground effects
 * Uses cached intersections and precomputed maps for performance
 */
export const highlightTileTooltips = (info: {
  group_tiles: Group;
  cachedIntersections: CachedIntersections;
  battleMaps: BattleMaps;
  mouseX?: number;
  mouseY?: number;
  onHoverChange?: (hover: CombatHoverData | null) => void;
}) => {
  const { groundEffectsByTile, usersByTile, userEffectsByUserId } = info.battleMaps;
  const { onHoverChange } = info;
  const battleTileIntersects = info.cachedIntersections.battleTiles;

  // Check if we're hovering over a battle tile (not border tiles)
  const tileHit = battleTileIntersects.length > 0 ? battleTileIntersects[0] : undefined;
  let currentHover: CombatHoverData | null = null;

  if (tileHit) {
    const tile = tileHit.object.userData.tile as TerrainHex;
    const tileKey = `${tile.col},${tile.row}`;

    // Check for user at this tile
    const userIdAtTile = usersByTile.get(tileKey);
    const userEffects = userIdAtTile
      ? userEffectsByUserId.get(userIdAtTile)
      : undefined;
    const hasUserEffects = userEffects && userEffects.length > 0;

    // Check for ground effects
    const groundEffectsOnTile = groundEffectsByTile.get(tileKey);
    const hasGroundEffects = groundEffectsOnTile && groundEffectsOnTile.length > 0;

    // If there's anything to show, create hover data
    if (hasUserEffects || hasGroundEffects) {
      currentHover = {
        tileKey,
        userId: hasUserEffects ? userIdAtTile : undefined,
        position: { x: info.mouseX || 0, y: info.mouseY || 0 },
      };
    }
  }

  // Notify React of hover changes
  if (onHoverChange) {
    onHoverChange(currentHover);
  }
};
