import alea from "alea";
import { createNoise2D } from "simplex-noise";
import { createHexGrid, nameArenaTile } from "@/libs/hexgrid";
import {
  getProceduralTerrain,
  proceduralDecoration,
} from "@/libs/rendering/proceduralBiomes";
import type { WorldSpriteDescription } from "@/libs/rendering/sectorSprites";
import { buildHexTerrainData } from "@/libs/rendering/terrainData";

/** World pixels per hex; the arena maps one simulation unit to one hex width. */
const TD_HEX_SIZE = 100;

/** A seeded biome arena with clear ground around the hero's zone in the centre. */
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
    const { description } = proceduralDecoration(prng, look.spec.key, tile);
    if (
      description &&
      Math.max(Math.abs(tile.col - center.col), Math.abs(tile.row - center.row)) > 9
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
