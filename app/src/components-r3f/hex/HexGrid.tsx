"use client";

import React from "react";
import { HexTile } from "./HexTile";
import type { Grid } from "honeycomb-grid";
import type { TerrainHex } from "@/libs/hexgrid";

interface HexGridProps {
  grid: Grid<TerrainHex>;
  getColor?: (hex: TerrainHex) => string | number;
  highlightedTiles?: Set<string>;
  clickableTiles?: Set<string>;
  onTileClick?: (hex: TerrainHex) => void;
  onTileHover?: (hex: TerrainHex) => void;
  onTileLeave?: (hex: TerrainHex) => void;
}

/**
 * Hex Grid component - renders a complete hexagonal grid
 * Manages multiple HexTile components
 */
export const HexGrid: React.FC<HexGridProps> = ({
  grid,
  getColor,
  highlightedTiles,
  clickableTiles,
  onTileClick,
  onTileHover,
  onTileLeave,
}) => {
  // Convert grid to array for mapping
  const hexArray = Array.from(grid);

  return (
    <group name="hex-grid">
      {hexArray.map((hex) => {
        const key = `${hex.col}-${hex.row}`;
        const isHighlighted = highlightedTiles?.has(key) ?? false;
        const canClick = clickableTiles?.has(key) ?? false;
        const color = getColor ? getColor(hex) : hex.color ?? 0x808080;

        return (
          <HexTile
            key={key}
            hex={hex}
            color={color}
            isHighlighted={isHighlighted}
            canClick={canClick}
            onClick={onTileClick}
            onPointerOver={onTileHover}
            onPointerOut={onTileLeave}
          />
        );
      })}
    </group>
  );
};

export default HexGrid;

