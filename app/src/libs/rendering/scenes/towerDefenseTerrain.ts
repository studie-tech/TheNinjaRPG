import alea from "alea";
import { createNoise2D } from "simplex-noise";
import { TD_HEX_SIZE } from "@/drizzle/constants";
import { createHexGrid, nameArenaTile } from "@/libs/hexgrid";
import {
  getProceduralTerrain,
  proceduralDecoration,
} from "@/libs/rendering/proceduralBiomes";
import type { WorldSpriteDescription } from "@/libs/rendering/sectorSprites";
import { buildHexTerrainData } from "@/libs/rendering/terrainData";
import { getProjectileProgress } from "@/libs/towerDefense/game";
import type {
  HexPosition,
  TowerDefenseEnemy,
  TowerDefenseProjectile,
} from "@/validators/towerDefense";

/** Tower defense retains its fixed world scale as the viewport and grid expand. */
export const prepareTowerDefenseTerrain = (
  seed: string,
  size: number,
  center: HexPosition,
) => {
  const grid = createHexGrid(TD_HEX_SIZE, size, size, {
    x: -TD_HEX_SIZE / 2,
    y: -TD_HEX_SIZE / 2,
  });
  const prng = alea(seed),
    noise = createNoise2D(prng),
    assets = createNoise2D(prng);
  const scenery: WorldSpriteDescription[] = [];
  const looks = new Map<string, ReturnType<typeof getProceduralTerrain>>();
  for (const tile of grid) {
    nameArenaTile(tile);
    tile.level = noise(tile.col / size - 0.5, tile.row / size - 0.5) / 2 + 0.5;
    tile.assetStrength = assets(tile.col / size - 0.5, tile.row / size - 0.5) / 2 + 0.5;
  }
  for (const tile of grid) {
    const look = getProceduralTerrain(tile, "ground");
    looks.set(`${tile.col},${tile.row}`, look);
    tile.asset = look.spec.key;
    const { description } = proceduralDecoration(prng, look.spec.key, tile);
    if (
      description &&
      !(Math.abs(tile.col - center.col) <= 1 && Math.abs(tile.row - center.row) <= 1)
    )
      scenery.push(description);
  }
  const terrain = buildHexTerrainData(
    grid,
    (tile) => {
      const look = looks.get(`${tile.col},${tile.row}`);
      if (!look) throw new Error("Tower defense terrain look is missing");
      return {
        color: look.spec.colors[look.variant] ?? look.spec.colors[0],
        texture: look.spec.textureUrl,
        depression: look.spec.depression,
        waveOffset: look.spec.isWater ? (Math.floor(prng() * 4) * Math.PI) / 2 : -1,
      };
    },
    false,
  );
  const corners = grid.toArray().flatMap((tile) => tile.corners);
  const bounds = {
    left: Math.min(...corners.map((p) => p.x)) - TD_HEX_SIZE / 2,
    right: Math.max(...corners.map((p) => p.x)) + TD_HEX_SIZE / 2,
    bottom: Math.min(...corners.map((p) => p.y)) - TD_HEX_SIZE / 2,
    top: Math.max(...corners.map((p) => p.y)) + TD_HEX_SIZE / 2,
  };
  return {
    grid,
    terrain,
    scenery: scenery.sort((a, b) => b.groundY - a.groundY),
    bounds,
  };
};

/** Rendering samples server-provided progress; it never advances game simulation. */
export const towerDefenseEnemyPosition = (
  enemy: TowerDefenseEnemy,
  grid: ReturnType<typeof prepareTowerDefenseTerrain>["grid"],
) => {
  const tile = grid.getHex(enemy.position);
  if (!tile) return null;
  const waypoint = enemy.path[enemy.pathIndex],
    next = waypoint ? grid.getHex(waypoint) : undefined;
  const progress = next ? Math.max(0, Math.min(1, enemy.movementProgress)) : 0;
  return {
    x: tile.x + ((next?.x ?? tile.x) - tile.x) * progress,
    y: tile.y + ((next?.y ?? tile.y) - tile.y) * progress,
  };
};

/** Interpolates clientSpawnTime with local epoch milliseconds; otherwise uses authoritative progress. */
export const towerDefenseProjectileProgress = (
  projectile: TowerDefenseProjectile & { clientSpawnTime?: number },
  now: number,
) => {
  if (projectile.clientSpawnTime === undefined)
    return Math.max(0, Math.min(1, projectile.progress));
  return getProjectileProgress(
    projectile.origin,
    projectile.target,
    projectile.clientSpawnTime,
    now,
  );
};
