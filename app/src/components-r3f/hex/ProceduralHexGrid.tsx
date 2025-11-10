"use client";

import { useMemo } from "react";
import { HexGrid } from "./HexGrid";
import { Grid, rectangle, Orientation } from "honeycomb-grid";
import { defineHex } from "@/libs/hexgrid";
import { SECTOR_WIDTH, SECTOR_HEIGHT } from "@/libs/travel/constants";
import { getTileInfo } from "@/libs/travel/biome";
import type { TerrainHex } from "@/libs/hexgrid";
import type { GlobalTile } from "@/libs/travel/types";
import type { PRNG } from "alea";

interface ProceduralHexGridProps {
  prng: PRNG;
  tile: GlobalTile;
  hasVillage: boolean;
  onTileClick?: (hex: TerrainHex) => void;
}

/**
 * Procedural Hex Grid component
 * Generates a hex grid procedurally using seeded random number generator
 */
export const ProceduralHexGrid: React.FC<ProceduralHexGridProps> = ({
  prng,
  tile,
  hasVillage,
  onTileClick,
}) => {
  // Generate the grid
  const grid = useMemo(() => {
    const Hex = defineHex({ dimensions: 30, orientation: Orientation.FLAT });
    const hexGrid = new Grid(Hex, rectangle({ width: SECTOR_WIDTH, height: SECTOR_HEIGHT }));

    // Apply tile info to each hex
    hexGrid.forEach((hex) => {
      const terrainHex = hex as TerrainHex;
      const tileInfo = getTileInfo(tile, hex.col, hex.row, hasVillage, prng);

      // Assign tile properties
      terrainHex.color = parseInt(tileInfo.color.replace("#", ""), 16);
      terrainHex.asset = tileInfo.asset;
      terrainHex.isVillage = tileInfo.isVillage;
    });

    return hexGrid as Grid<TerrainHex>;
  }, [prng, tile, hasVillage]);

  return <HexGrid grid={grid} onTileClick={onTileClick} />;
};

export default ProceduralHexGrid;

