import { describe, expect, it } from "bun:test";
import { TD_PROJECTILE_SPEED } from "@/drizzle/constants";
import {
  prepareTowerDefenseTerrain,
  towerDefenseEnemyPosition,
  towerDefenseProjectileProgress,
} from "@/libs/rendering/scenes/towerDefenseTerrain";
import { hexTerrainAt } from "@/libs/rendering/terrainData";
import type {
  TowerDefenseEnemy,
  TowerDefenseProjectile,
} from "@/validators/towerDefense";

const enemy = {
  id: "enemy",
  aiUserId: "ai",
  enemyType: "light",
  position: { col: 1, row: 1 },
  path: [
    { col: 2, row: 1 },
    { col: 3, row: 1 },
  ],
  pathIndex: 0,
  health: 100,
  maxHealth: 100,
  speed: 1,
  damage: 10,
  attackCooldown: 1,
  movementProgress: 0.25,
  direction: "e",
} as TowerDefenseEnemy;
const projectile: TowerDefenseProjectile = {
  id: "projectile",
  abilityType: "shuriken",
  origin: { col: 1, row: 1 },
  target: { col: 2, row: 1 },
  progress: 0.3,
  damage: 10,
};

describe("tower defense world data", () => {
  it("keeps terrain repeatable, center clear, and picks recessed tiles after expansion", () => {
    for (const size of [7, 9, 13]) {
      const center = { col: Math.floor(size / 2), row: Math.floor(size / 2) };
      const first = prepareTowerDefenseTerrain("retained-run", size, center),
        second = prepareTowerDefenseTerrain("retained-run", size, center);
      expect(first.terrain.segments).toEqual(second.terrain.segments);
      expect(first.scenery).toEqual(second.scenery);
      expect(first.grid.size).toBe(size * size);
      const protectedIds = new Set<string>();
      for (const tile of first.grid) {
        const offset = first.terrain.faceOffsets.get(`${tile.col},${tile.row}`) ?? 0;
        expect(
          hexTerrainAt(first.grid, first.terrain.faceOffsets, tile.x, tile.y + offset),
        ).toBe(tile);
        if (
          Math.abs(tile.col - center.col) <= 1 &&
          Math.abs(tile.row - center.row) <= 1
        )
          protectedIds.add(`scenery:${tile.col},${tile.row}`);
      }
      expect(first.scenery.every((entry) => !protectedIds.has(entry.id))).toBe(true);
      for (const sprite of first.scenery) {
        expect(sprite.nearest).toBe(true);
        expect(sprite.rendition).toBe(sprite.small ? 50 : 128);
      }
    }
  });
  it("samples the authoritative path without mutating the enemy or inventing movement", () => {
    const { grid } = prepareTowerDefenseTerrain("run", 7, { col: 3, row: 3 });
    const before = structuredClone(enemy),
      from = grid.getHex(enemy.position)!,
      to = grid.getHex(enemy.path[0]!)!;
    expect(towerDefenseEnemyPosition(enemy, grid)).toEqual({
      x: from.x + (to.x - from.x) / 4,
      y: from.y + (to.y - from.y) / 4,
    });
    expect(towerDefenseEnemyPosition({ ...enemy, pathIndex: 2 }, grid)).toEqual({
      x: from.x,
      y: from.y,
    });
    expect(
      towerDefenseEnemyPosition({ ...enemy, position: { col: -1, row: -1 } }, grid),
    ).toBeNull();
    expect(enemy).toEqual(before);
  });
  it("uses client spawn time at the shared projectile speed and clamps clock skew", () => {
    expect(towerDefenseProjectileProgress(projectile, 99_999)).toBe(0.3);
    const moving = { ...projectile, clientSpawnTime: 1000 };
    expect(
      towerDefenseProjectileProgress(moving, 1000 + 500 / TD_PROJECTILE_SPEED),
    ).toBeCloseTo(0.5);
    expect(towerDefenseProjectileProgress(moving, 900)).toBe(0);
    expect(towerDefenseProjectileProgress(moving, 10_000)).toBe(1);
    expect(
      towerDefenseProjectileProgress({ ...moving, target: moving.origin }, 1000),
    ).toBe(1);
    expect(projectile.progress).toBe(0.3);
  });
});
