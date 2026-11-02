import { Grid, Orientation, rectangle } from "honeycomb-grid";
import { createNoise2D } from "simplex-noise";
import {
  HEX_ASPECT_RATIO,
  HEX_STACKING_DISPLACEMENT,
  STRUCTURE_ADJACENTS,
} from "@/drizzle/constants";
import type { VillageStructure } from "@/drizzle/schema";
import { defineHex } from "@/libs/hexgrid";
import {
  resolveStructureTerrainSpec,
  resolveTerrainSpec,
  type TerrainSpec,
} from "@/libs/sector-map/terrains";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import {
  getVillageWallFoundationKeys,
  planVillageWalls,
  usesVillageWalls,
  type VillageWallPlan,
} from "@/libs/sector-map/village-walls";
import { getBiomeFromTileType } from "@/libs/travel";

/**
 * Shared terrain, structure-foundation and navigation data for a sector's renderers.
 * A preplanned wall layout carries footing cells shared with neighboring sectors.
 */
export const prepareSectorGrid = (
  width: number,
  prng: () => number,
  globalTileType: number,
  structures: VillageStructure[] | undefined,
  sectorMap: NormalizedSectorMap,
  terrainRegistry: Map<string, TerrainSpec>,
  villageType: string | null,
  wallPlan?: VillageWallPlan | null,
) => {
  const { width: sectorWidth, height: sectorHeight } = sectorMap;
  const authoredTiles = new Map(
    sectorMap.tiles.map((tile) => [`${tile.x},${tile.y}`, tile]),
  );
  // Calculate hex size
  const hexsize = width / (sectorWidth - HEX_STACKING_DISPLACEMENT * (sectorWidth - 1));

  // Noise drives color variation within terrain bands
  const noiseGen = createNoise2D(prng);

  const allStructures = structures ?? [];
  // The sector's own biome on the globe: drives the fallback material for
  // un-authored tiles and the flattened ground level under structures, so a
  // sector renders identically no matter which window it is viewed from
  const baseBiome = getBiomeFromTileType(globalTileType);

  // Create the grid first
  const Tile = defineHex({
    dimensions: { width: hexsize, height: hexsize * HEX_ASPECT_RATIO },
    origin: { x: -hexsize * 0.5, y: -hexsize * 0.5 },
    orientation: Orientation.FLAT,
  });
  // Precompute the tiles occupied by (or adjacent to) a structure once, so the
  // per-tile check below is an O(1) Set lookup rather than scanning every
  // structure x 12 adjacents for all 676 tiles (a village sector redraw is
  // otherwise O(tiles x structures x 12)).
  const structureTileKeys = new Set<string>();
  for (const s of allStructures) {
    structureTileKeys.add(`${s.longitude},${s.latitude}`);
    for (const { dCol, dRow } of STRUCTURE_ADJACENTS) {
      structureTileKeys.add(`${s.longitude + dCol},${s.latitude + dRow}`);
    }
  }
  const villageWallPlan =
    wallPlan === undefined
      ? usesVillageWalls(villageType)
        ? planVillageWalls(sectorMap, allStructures)
        : null
      : wallPlan;
  const wallFoundationKeys = villageWallPlan
    ? getVillageWallFoundationKeys(villageWallPlan)
    : new Set<string>();
  const grid = new Grid(Tile, rectangle({ width: sectorWidth, height: sectorHeight }))
    .filter((tile) => {
      try {
        return tile.width !== 0;
      } catch (_e) {
        return false;
      }
    })
    .map((tile) => {
      const tileKey = `${tile.col},${tile.row}`;
      const authoredTile = authoredTiles.get(tileKey);
      // Noise drives which of the terrain's shades a tile gets
      const nx = tile.col / sectorWidth - 0.5;
      const ny = tile.row / sectorHeight - 0.5;
      tile.level = noiseGen(nx, ny) / 2 + 0.5;
      tile.assetStrength = 0;
      // Every sector terrain shade is traversable; zero-cost palette entries
      // use the standard walking cost, including shaded ground and water.
      const spec = resolveTerrainSpec(
        authoredTile?.terrain ?? baseBiome,
        terrainRegistry,
      );
      // Stash the resolved spec + authored tile so the geometry pass below reads
      // them off the hex instead of re-doing the lookup + resolve for all 676 tiles
      tile.spec = spec;
      tile.authored = authoredTile;
      tile.cost = (authoredTile?.walkCost || 1) + 1;
      tile.blocked = false;
      tile.zone = authoredTile?.zone;
      // Combat arena for battles on this tile: the authored per-tile override
      // wins, else the terrain's configured arena
      tile.battleBiome = authoredTile?.battleBiome ?? spec.battleBiome;

      const hasStructureFoundation = structureTileKeys.has(tileKey);
      // Both sides of a wall need solid footing; authored land keeps its material,
      // while recessed water and ice receive a flat, biome-appropriate foundation.
      if (hasStructureFoundation || wallFoundationKeys.has(tileKey)) {
        // Authored land defines foundations even when the globe biome differs.
        // Recessed water and ice use flat land and snow beneath structures.
        const groundSpec = resolveStructureTerrainSpec({
          authoredTerrain: authoredTile?.terrain,
          authoredBattleBiome: authoredTile?.battleBiome,
          baseBiome,
          registry: terrainRegistry,
        });
        tile.spec = groundSpec;
        tile.battleBiome = authoredTile?.battleBiome ?? groundSpec.battleBiome;
        tile.cost = 2;
        if (groundSpec.key !== spec.key) {
          // A consistent mid shade makes replacement terrain read as one
          // intentional foundation instead of noisy fragments.
          tile.level = 0.5;
        }
        if (hasStructureFoundation) {
          tile.hasStructure = true;
          tile.blocked = false;
        }
      }
      return tile;
    });

  return { grid, hexsize, baseBiome, villageWallPlan };
};
