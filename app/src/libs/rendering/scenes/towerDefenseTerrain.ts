import alea from "alea";
import { createNoise2D } from "simplex-noise";
import type { CombatBiome } from "@/drizzle/constants";
import { createHexGrid, nameArenaTile } from "@/libs/hexgrid";
import {
  fieldObstacleDescription,
  getProceduralTerrain,
  proceduralDecoration,
} from "@/libs/rendering/proceduralBiomes";
import type { WorldSpriteDescription } from "@/libs/rendering/sectorSprites";
import { buildHexTerrainData, terrainFrost } from "@/libs/rendering/terrainData";

/** What a simulation fixes on its battlefield, in arena units. */
export interface ArenaField {
  /** Half the side of the battlefield the simulation plays on. */
  half: number;
  ponds: { x: number; y: number; radius: number }[];
  obstacles: { x: number; y: number; kind: "tree" | "rock" }[];
}

/**
 * A tile's level on a simulated battlefield: ponds sink to the biome's water hexes,
 * deepest at their middle, and the rest of the battlefield rises clear of any water the
 * noise made.
 */
const fieldLevel = (
  field: ArenaField,
  biome: CombatBiome,
  level: number,
  at: { x: number; y: number },
) => {
  for (const pond of field.ponds) {
    const dx = at.x - pond.x,
      dy = at.y - pond.y;
    const share = Math.sqrt(dx * dx + dy * dy) / pond.radius;
    if (share >= 1) continue;
    // The biome's own bands: deep water to a shallow rim in the lowlands, an oasis with
    // a damp shore in the desert, and lakes under ice in the snow.
    if (biome === "dessert") return share < 0.65 ? 0.02 : 0.07;
    if (biome === "snow" || biome === "ice") return share < 0.5 ? 0.07 : 0.15;
    return share < 0.4 ? 0.02 : share < 0.75 ? 0.07 : 0.12;
  }
  const inside = Math.max(Math.abs(at.x), Math.abs(at.y)) <= field.half + 0.5;
  if (!inside) return level;
  const dry =
    biome === "dessert" ? 0.12 : biome === "snow" || biome === "ice" ? 0.3 : 0.22;
  return Math.max(dry, level);
};

/** World pixels per hex; the arena maps one simulation unit to one hex width. */
const TD_HEX_SIZE = 100;
/**
 * Share of rolled ground details (grass, flowers, pebbles) the arena keeps. Procedural
 * ground rolls one on about half its tiles; published sector maps hold about one per
 * five tiles, and this keeps the arena to the same density.
 */
const TD_GROUND_DETAIL_SHARE = 0.4;

/**
 * A seeded biome arena whose centre, the hero's zone, holds only small ground detail.
 * The zone is a square whose half-width counts tiles, or arena units for a battlefield
 * that must stay clear to an exact distance. `biome` picks the ground's palette.
 *
 * A `field` from a simulation fixes what the battlefield holds: its ponds become water,
 * the rest of the battlefield stays dry ground, and its trees and rocks stand exactly
 * where the simulation collides with them.
 */
export const prepareTowerDefenseTerrain = (
  seed: string,
  size: number,
  openZone: { tiles: number } | { units: number } = { tiles: 9 },
  biome: CombatBiome = "ground",
  field?: ArenaField,
) => {
  const center = { col: Math.floor(size / 2), row: Math.floor(size / 2) };
  const grid = createHexGrid(TD_HEX_SIZE, size, size, {
    x: -TD_HEX_SIZE / 2,
    y: -TD_HEX_SIZE / 2,
  });
  const tiles = grid.toArray();
  const xs = tiles.flatMap((tile) => tile.corners.map((corner) => corner.x)),
    ys = tiles.flatMap((tile) => tile.corners.map((corner) => corner.y));
  const left = Math.min(...xs) - TD_HEX_SIZE / 2,
    right = Math.max(...xs) + TD_HEX_SIZE / 2;
  /** World pixels per arena unit. */
  const unitPx = (right - left) / (size + 1);
  const middle = grid.getHex(center);
  const centerPx = { x: middle?.x ?? 0, y: middle?.y ?? 0 };
  const prng = alea(seed),
    noise = createNoise2D(prng),
    assets = createNoise2D(prng);
  const scenery: WorldSpriteDescription[] = [];
  const looks = new Map<string, ReturnType<typeof getProceduralTerrain>>();
  for (const tile of grid) {
    nameArenaTile(tile);
    tile.level = noise(tile.col / size - 0.5, tile.row / size - 0.5) / 2 + 0.5;
    tile.assetStrength = assets(tile.col / size - 0.5, tile.row / size - 0.5) / 2 + 0.5;
    if (field)
      tile.level = fieldLevel(field, biome, tile.level, {
        x: (tile.x - centerPx.x) / unitPx,
        y: (tile.y - centerPx.y) / unitPx,
      });
  }
  for (const tile of grid) {
    const look = getProceduralTerrain(tile, biome);
    looks.set(`${tile.col},${tile.row}`, look);
    tile.asset = look.spec.key;
    // The hero's zone keeps only ground detail, so nothing tall hides the fight.
    const open =
      "tiles" in openZone
        ? Math.max(Math.abs(tile.col - center.col), Math.abs(tile.row - center.row)) <=
          openZone.tiles
        : Math.max(Math.abs(tile.x - centerPx.x), Math.abs(tile.y - centerPx.y)) <=
          openZone.units * unitPx;
    const { description } = proceduralDecoration(prng, look.spec.key, tile, open);
    if (description && (!description.small || prng() < TD_GROUND_DETAIL_SHARE))
      scenery.push(description);
  }
  field?.obstacles.forEach((obstacle, index) => {
    const description = fieldObstacleDescription(
      obstacle.kind,
      biome,
      prng(),
      centerPx.x + obstacle.x * unitPx,
      centerPx.y + obstacle.y * unitPx,
      grid.getHex(center)?.height ?? TD_HEX_SIZE / 2,
      `field:${index}`,
    );
    scenery.push(description);
  });
  const terrain = buildHexTerrainData(
    grid,
    (tile) => {
      const look = looks.get(`${tile.col},${tile.row}`);
      if (!look) throw new Error("Tower defense terrain look is missing");
      // The same water shelf, seabed and frozen coasts as combat and sector maps.
      return {
        color: look.spec.colors[look.variant] ?? look.spec.colors[0],
        texture: look.spec.textureUrl,
        depression: look.spec.depression,
        isWater: look.spec.isWater,
        waterDepth: look.spec.key === "ocean",
        frost: terrainFrost(look.spec.key),
        waveOffset: look.spec.isWater ? (Math.floor(prng() * 4) * Math.PI) / 2 : -1,
      };
    },
    false,
  );
  // The ragged hex rim leaves gaps up to a tile deep, so the solid ground ends one tile in.
  const solid = (edge: number) => Math.max(0, edge / unitPx - 1);
  return {
    terrain,
    scenery: scenery.sort((a, b) => b.groundY - a.groundY),
    unitPx,
    /** The arena's centre in world pixels. */
    center: centerPx,
    /** How far solid ground reaches from the centre, in arena units. */
    reach: {
      x: solid(Math.min(centerPx.x - Math.min(...xs), Math.max(...xs) - centerPx.x)),
      y: solid(Math.min(centerPx.y - Math.min(...ys), Math.max(...ys) - centerPx.y)),
    },
  };
};
