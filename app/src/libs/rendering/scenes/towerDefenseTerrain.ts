import alea from "alea";
import { createNoise2D } from "simplex-noise";
import { createHexGrid, nameArenaTile } from "@/libs/hexgrid";
import {
  getProceduralTerrain,
  proceduralDecoration,
} from "@/libs/rendering/proceduralBiomes";
import type { WorldSpriteDescription } from "@/libs/rendering/sectorSprites";
import { buildHexTerrainData, terrainFrost } from "@/libs/rendering/terrainData";

/** World pixels per hex; the arena maps one simulation unit to one hex width. */
const TD_HEX_SIZE = 100;
/**
 * Share of rolled ground details (grass, flowers, pebbles) the arena keeps. Procedural
 * ground rolls one on about half its tiles; published sector maps hold about one per
 * five tiles, and this keeps the arena to the same density.
 */
const TD_GROUND_DETAIL_SHARE = 0.4;

/** A seeded biome arena whose centre, the hero's zone, holds only small ground detail. */
export const prepareTowerDefenseTerrain = (seed: string, size: number) => {
  const center = { col: Math.floor(size / 2), row: Math.floor(size / 2) };
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
    // The hero's zone keeps only ground detail, so nothing tall hides the fight.
    const open =
      Math.max(Math.abs(tile.col - center.col), Math.abs(tile.row - center.row)) <= 9;
    const { description } = proceduralDecoration(prng, look.spec.key, tile, open);
    if (description && (!description.small || prng() < TD_GROUND_DETAIL_SHARE))
      scenery.push(description);
  }
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
  const xs = grid.toArray().flatMap((tile) => tile.corners.map((corner) => corner.x));
  const left = Math.min(...xs) - TD_HEX_SIZE / 2,
    right = Math.max(...xs) + TD_HEX_SIZE / 2;
  const middle = grid.getHex(center);
  return {
    terrain,
    scenery: scenery.sort((a, b) => b.groundY - a.groundY),
    /** World pixels per arena unit. */
    unitPx: (right - left) / (size + 1),
    /** The arena's centre in world pixels. */
    center: { x: middle?.x ?? 0, y: middle?.y ?? 0 },
  };
};
