"use client";

import { useMemo } from "react";
import { Text } from "@react-three/drei";
import type { Grid } from "honeycomb-grid";
import type { TerrainHex } from "@/libs/hexgrid";

interface HexLabelsProps {
  grid: Grid<TerrainHex>;
  color?: string;
  fontSize?: number;
}

/**
 * Hex Labels component - displays grid coordinates on tiles
 * Used for debugging and development
 */
export const HexLabels: React.FC<HexLabelsProps> = ({
  grid,
  color = "#000000",
  fontSize = 10,
}) => {
  const hexArray = useMemo(() => Array.from(grid), [grid]);

  return (
    <group name="hex-labels">
      {hexArray.map((hex) => {
        const key = `label-${hex.col}-${hex.row}`;
        const { center } = hex;
        const label = `${hex.col},${hex.row}`;

        return (
          <Text
            key={key}
            position={[center.x, center.y, 5]}
            fontSize={fontSize}
            color={color}
            anchorX="center"
            anchorY="middle"
          >
            {label}
          </Text>
        );
      })}
    </group>
  );
};

export default HexLabels;

