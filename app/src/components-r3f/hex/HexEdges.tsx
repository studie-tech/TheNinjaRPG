"use client";

import React from "react";
import { Line } from "@react-three/drei";
import type { Grid } from "honeycomb-grid";
import type { TerrainHex } from "@/libs/hexgrid";

interface HexEdgesProps {
  grid: Grid<TerrainHex>;
  color?: string | number;
  lineWidth?: number;
}

/**
 * Hex Edges component - renders edges/borders of hexagonal tiles
 */
export const HexEdges: React.FC<HexEdgesProps> = ({
  grid,
  color = 0x000000,
  lineWidth = 1,
}) => {
  const hexArray = Array.from(grid);

  return (
    <group name="hex-edges">
      {hexArray.map((hex) => {
        const corners = hex.corners;
        const key = `edge-${hex.col}-${hex.row}`;

        // Create points array for the hex perimeter
        const points: [number, number, number][] = corners.map((corner) => [
          corner.x,
          corner.y,
          0.1, // Slightly above tiles to prevent z-fighting
        ]);

        // Close the loop
        if (corners[0]) {
          points.push([corners[0].x, corners[0].y, 0.1]);
        }

        return (
          <Line
            key={key}
            points={points}
            color={color}
            lineWidth={lineWidth}
            dashed={false}
          />
        );
      })}
    </group>
  );
};

export default HexEdges;

