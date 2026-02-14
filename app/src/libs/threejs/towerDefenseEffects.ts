import { type Group, Sprite, SpriteMaterial, type Texture } from "three";
import {
  EFFECTS_LAYER,
  STATUS_LAYER,
  TD_DAMAGE_NUMBER_LIFETIME,
  TD_DAMAGE_NUMBER_POOL_SIZE,
  TD_DAMAGE_NUMBER_RISE_SPEED_FACTOR,
  TD_SHURIKEN_IMAGE_URL,
} from "@/drizzle/constants";
import {
  createTexture,
  loadTexture,
  profiler,
  showAnimation,
} from "@/libs/threejs/util";
import { calculateHexDistance } from "@/libs/towerDefense/game";

// Projectiles should render above users/enemies (STATUS_LAYER is in front)
const PROJECTILE_LAYER = STATUS_LAYER - 0.5;

import type { Grid } from "honeycomb-grid";
import type {
  TowerDefenseEnemy,
  TowerDefenseProjectile,
} from "@/validators/towerDefense";
import type { TerrainHex } from "../hexgrid";

// COST OPTIMIZATION: Projectile speed for client-side interpolation
// Must match the server-side PROJECTILE_SPEED in lib.rs (5.0 tiles/sec)
const PROJECTILE_SPEED = 5.0;

// Extended projectile type that includes clientSpawnTime for client-side interpolation
type ProjectileWithClientSpawn = TowerDefenseProjectile & { clientSpawnTime?: number };

import type { GameAsset } from "@/drizzle/schema";
import type { SpriteMixer } from "@/libs/threejs/SpriteMixer";

// Cache for projectile textures
const projectileTextureCache = new Map<string, Texture>();

/**
 * Load the shuriken texture from the image URL.
 * Returns a texture that's ready for rendering.
 */
const loadShurikenTexture = (): Texture => {
  const cached = projectileTextureCache.get("shuriken");
  if (cached) return cached;

  const texture = loadTexture(TD_SHURIKEN_IMAGE_URL);
  texture.needsUpdate = true;
  projectileTextureCache.set("shuriken", texture);
  return texture;
};

/**
 * Preload projectile textures so they're ready when needed.
 * Call this during game initialization.
 */
export const preloadProjectileTextures = (): void => {
  loadShurikenTexture();
};

/**
 * Show an impact animation at a specific position using SpriteMixer.
 */
export const showImpactAnimation = (info: {
  group_effects: Group;
  position: { x: number; y: number };
  gameAsset: GameAsset;
  spriteMixer: SpriteMixer;
  hexWidth: number;
}): void => {
  const { group_effects, position, gameAsset, spriteMixer, hexWidth } = info;

  const actionSprite = showAnimation({
    gameAsset,
    spriteMixer,
    scale: hexWidth * 0.8,
    position,
    layer: EFFECTS_LAYER + 0.1,
  });

  if (actionSprite) {
    group_effects.add(actionSprite);
  }
};

/**
 * Create a position-based lookup map for enemies.
 * PERFORMANCE: Use this once per frame instead of Array.find() for each projectile.
 */
export const createEnemyPositionMap = (
  enemies: readonly TowerDefenseEnemy[],
): Map<string, TowerDefenseEnemy> => {
  const map = new Map<string, TowerDefenseEnemy>();
  for (const enemy of enemies) {
    map.set(`${enemy.position.col},${enemy.position.row}`, enemy);
  }
  return map;
};

/**
 * Update projectiles - move them towards targets and detect hits.
 * COST OPTIMIZATION: Progress is computed client-side from clientSpawnTime
 * to avoid server/client clock skew issues.
 */
export const updateProjectiles = (info: {
  group_projectiles: Group;
  objectsMap?: Map<string, Sprite>;
  projectiles: ProjectileWithClientSpawn[];
  enemies: readonly TowerDefenseEnemy[];
  grid: Grid<TerrainHex>;
  delta: number;
  /** PERFORMANCE: Pre-built position map for O(1) enemy lookups */
  enemyPositionMap?: Map<string, TowerDefenseEnemy>;
}): void => {
  const {
    group_projectiles,
    objectsMap,
    projectiles,
    enemies,
    grid,
    delta,
    enemyPositionMap,
  } = info;

  const now = Date.now();

  for (const projectile of projectiles) {
    const sprite = (
      objectsMap
        ? objectsMap.get(projectile.id)
        : group_projectiles.getObjectByName(projectile.id)
    ) as Sprite | undefined;
    if (!sprite) continue;

    const originTile = grid.getHex({
      col: projectile.origin.col,
      row: projectile.origin.row,
    });
    const targetTile = grid.getHex({
      col: projectile.target.col,
      row: projectile.target.row,
    });

    if (originTile && targetTile) {
      // Find target enemy to get their interpolated visual position
      // PERFORMANCE: Use position map if provided, otherwise fall back to Array.find()
      const posKey = `${projectile.target.col},${projectile.target.row}`;
      const targetEnemy = enemyPositionMap
        ? enemyPositionMap.get(posKey)
        : enemies.find(
            (e) =>
              e.position.col === projectile.target.col &&
              e.position.row === projectile.target.row,
          );

      // Calculate target position - use enemy's interpolated position if available
      let targetX = targetTile.x;
      let targetY = targetTile.y;

      if (targetEnemy && targetEnemy.movementProgress > 0) {
        // Enemy is walking between tiles - calculate their visual position
        const nextWaypoint =
          targetEnemy.pathIndex < targetEnemy.path.length
            ? targetEnemy.path[targetEnemy.pathIndex]
            : undefined;

        if (nextWaypoint) {
          const nextTile = grid.getHex({
            col: nextWaypoint.col,
            row: nextWaypoint.row,
          });

          if (nextTile) {
            targetX =
              targetTile.x + (nextTile.x - targetTile.x) * targetEnemy.movementProgress;
            targetY =
              targetTile.y + (nextTile.y - targetTile.y) * targetEnemy.movementProgress;
          }
        }
      }

      // COST OPTIMIZATION: Compute progress from clientSpawnTime each frame
      // This avoids relying on server timestamps and handles client-side interpolation
      let progress = projectile.progress; // Fallback to stored progress
      if (projectile.clientSpawnTime !== undefined) {
        const elapsed = (now - projectile.clientSpawnTime) / 1000;
        const distance = calculateHexDistance(projectile.origin, projectile.target);
        progress =
          distance > 0 ? Math.min((elapsed * PROJECTILE_SPEED) / distance, 1.0) : 1.0;
      }

      const x = originTile.x + (targetX - originTile.x) * progress;
      const y = originTile.y + (targetY - originTile.y) * progress;

      sprite.position.set(x, y, PROJECTILE_LAYER);
      sprite.material.rotation += delta * 10; // Rotate shuriken
      sprite.matrixAutoUpdate = false;
      sprite.updateMatrix();
    }
  }

  // Report projectile and effect counts
  profiler.reportCount("draw_projectiles", projectiles.length);
};

/**
 * Spawn a new projectile sprite.
 */
export const spawnProjectile = (info: {
  group_projectiles: Group;
  objectsMap?: Map<string, Sprite>;
  projectile: TowerDefenseProjectile;
  grid: Grid<TerrainHex>;
  hexWidth: number;
}): void => {
  const { group_projectiles, objectsMap, projectile, grid, hexWidth } = info;

  const originTile = grid.getHex({
    col: projectile.origin.col,
    row: projectile.origin.row,
  });

  if (!originTile) return;

  // Load the shuriken texture
  const texture = loadShurikenTexture();

  // Create material with proper transparency and depth settings
  const spriteMaterial = new SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false, // Disable depth test so projectile is always visible
    depthWrite: false,
  });
  spriteMaterial.needsUpdate = true;

  const sprite = new Sprite(spriteMaterial);
  sprite.name = projectile.id;
  if (objectsMap) objectsMap.set(projectile.id, sprite);
  sprite.renderOrder = 1000; // High render order to ensure it's drawn last (on top)

  const scale = hexWidth * 0.2;
  sprite.scale.set(scale, scale, 1);
  sprite.position.set(originTile.x, originTile.y, PROJECTILE_LAYER);
  sprite.matrixAutoUpdate = false;
  sprite.updateMatrix();

  group_projectiles.add(sprite);
};

/**
 * PERFORMANCE: Object pool for damage numbers to avoid canvas/texture creation during gameplay.
 * Reuses canvas, texture, material, and sprite objects.
 */
interface DamageNumberPoolItem {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: Texture;
  material: SpriteMaterial;
  sprite: Sprite;
  inUse: boolean;
}

const damageNumberPool: DamageNumberPoolItem[] = [];

/**
 * Get or create a damage number item from the pool.
 */
const acquireDamageNumber = (): DamageNumberPoolItem | null => {
  // Find an available item in the pool
  for (const item of damageNumberPool) {
    if (!item.inUse) {
      item.inUse = true;
      return item;
    }
  }

  // If pool is full and all items are in use, create a new one
  // (this handles burst scenarios but should be rare)
  if (damageNumberPool.length < TD_DAMAGE_NUMBER_POOL_SIZE * 2) {
    const item = createDamageNumberPoolItem();
    if (item) {
      item.inUse = true;
      damageNumberPool.push(item);
      return item;
    }
  }

  return null; // Pool exhausted
};

/**
 * Return a damage number item to the pool for reuse.
 */
const releaseDamageNumber = (item: DamageNumberPoolItem): void => {
  item.inUse = false;
  item.sprite.visible = false;
};

/**
 * Create a new pool item with pre-allocated resources.
 */
const createDamageNumberPoolItem = (): DamageNumberPoolItem | null => {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");

  if (!ctx) return null;

  const texture = createTexture(canvas);
  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new Sprite(material);
  sprite.renderOrder = 2000;
  sprite.visible = false;
  sprite.matrixAutoUpdate = false;

  return { canvas, ctx, texture, material, sprite, inUse: false };
};

/**
 * Pre-populate the damage number pool.
 * Call this during game initialization.
 */
export const initDamageNumberPool = (): void => {
  for (let i = 0; i < TD_DAMAGE_NUMBER_POOL_SIZE; i++) {
    const item = createDamageNumberPoolItem();
    if (item) damageNumberPool.push(item);
  }
};

/**
 * Spawn floating damage number using object pooling.
 */
export const spawnDamageNumber = (info: {
  group_ui: Group;
  position: { x: number; y: number };
  damage: number;
  isCrit: boolean;
  hexWidth: number;
}): { update: (deltaTime: number) => boolean } => {
  const { group_ui, position, damage, isCrit, hexWidth } = info;

  const poolItem = acquireDamageNumber();

  // Fallback: if pool is exhausted, return a no-op updater
  if (!poolItem) {
    return { update: () => false };
  }

  const { canvas, ctx, texture, sprite } = poolItem;
  const fontSize = isCrit ? 38 : 29;
  const text = isCrit ? `${damage}!` : `${damage}`;

  // Clear and redraw the canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = `bold ${fontSize}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Shadow
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillText(text, canvas.width / 2 + 2, canvas.height / 2 + 2);

  ctx.fillStyle = isCrit ? "#ff4444" : "#ffffff";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  texture.needsUpdate = true;

  const scaleY = hexWidth * 0.3;
  const scaleX = scaleY * 2;
  sprite.scale.set(scaleX, scaleY, 1);

  // Add small random offset to prevent perfect overlapping
  const offsetX = (Math.random() - 0.5) * hexWidth * 0.3;
  const offsetY = (Math.random() - 0.5) * hexWidth * 0.3;
  sprite.position.set(position.x + offsetX, position.y + offsetY, STATUS_LAYER + 1);

  // Reset material opacity and make visible
  sprite.material.opacity = 1;
  sprite.visible = true;
  sprite.updateMatrix();

  // Add to group if not already there
  if (sprite.parent !== group_ui) {
    group_ui.add(sprite);
  }

  let age = 0;
  const riseSpeed = hexWidth * TD_DAMAGE_NUMBER_RISE_SPEED_FACTOR; // pixels per second

  return {
    update: (deltaTime: number): boolean => {
      age += deltaTime;

      if (age >= TD_DAMAGE_NUMBER_LIFETIME) {
        // Return to pool instead of disposing
        releaseDamageNumber(poolItem);
        return false; // Remove from tracking
      }

      // Rise and fade
      sprite.position.y += riseSpeed * deltaTime;
      sprite.material.opacity = 1 - (age / TD_DAMAGE_NUMBER_LIFETIME) ** 2; // Accelerate fade-out
      sprite.updateMatrix();

      return true; // Keep updating
    },
  };
};
