"use client";

import { useMemo } from "react";
import { BufferAttribute, BufferGeometry, Color } from "three";
import alea from "alea";
import {
  groundColors,
  oceanColors,
  dessertColors,
  iceColors,
} from "@/libs/travel/biome";
import { MAP_RESERVED_SECTORS } from "@/drizzle/constants";
import type { GlobalMapData } from "@/libs/travel/types";

interface HexasphereTilesProps {
  hexasphere: GlobalMapData;
  showOwnership?: boolean;
  ownershipData?: {
    sectors: Array<{ sector: number; villageId: string | null }>;
    colors: Array<{ id: string; hexColor: string }>;
  };
}

/**
 * Hexasphere Tiles component
 * Renders the 3D globe with hexagonal tiles
 */
export const HexasphereTiles: React.FC<HexasphereTilesProps> = ({
  hexasphere,
  showOwnership = false,
  ownershipData,
}) => {
  const prng = useMemo(() => alea(42), []);

  const tiles = useMemo(() => {
    return hexasphere.tiles.map((tile, i) => {
      if (!tile) return null;

      // Create geometry for this tile
      const geometry = new BufferGeometry();
      const points =
        tile.b.length > 5
          ? [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5]
          : [0, 1, 2, 0, 2, 3, 0, 3, 4];
      const vertices = new Float32Array(
        points
          .map((p) => tile.b[p])
          .flatMap((p) => (p ? [p.x / 3, p.y / 3, p.z / 3] : [])),
      );
      geometry.setAttribute("position", new BufferAttribute(vertices, 3));

      // Determine color
      let color: string;
      const consistentRandom = prng();

      if (showOwnership && ownershipData?.sectors && ownershipData?.colors) {
        const ownership = ownershipData.sectors.find((s) => s.sector === i);
        const villageColor = ownershipData.colors.find(
          (v) => v.id === ownership?.villageId,
        );

        if (MAP_RESERVED_SECTORS.includes(i)) {
          color = "#b3afae";
        } else if (villageColor) {
          color = villageColor.hexColor;
        } else {
          // Use biome colors as fallback
          if (tile.t === 0) {
            color = oceanColors[Math.floor(consistentRandom * oceanColors.length)] ?? "#1a5490";
          } else if (tile.t === 1) {
            color = groundColors[Math.floor(consistentRandom * groundColors.length)] ?? "#4a7c59";
          } else if (tile.t === 2) {
            color = dessertColors[Math.floor(consistentRandom * dessertColors.length)] ?? "#c2a878";
          } else {
            color = iceColors[Math.floor(consistentRandom * iceColors.length)] ?? "#d0e8f2";
          }
        }
      } else {
        // Biome-based coloring
        if (tile.t === 0) {
          color = oceanColors[Math.floor(consistentRandom * oceanColors.length)] ?? "#1a5490";
        } else if (tile.t === 1) {
          color = groundColors[Math.floor(consistentRandom * groundColors.length)] ?? "#4a7c59";
        } else if (tile.t === 2) {
          color = dessertColors[Math.floor(consistentRandom * dessertColors.length)] ?? "#c2a878";
        } else {
          color = iceColors[Math.floor(consistentRandom * iceColors.length)] ?? "#d0e8f2";
        }
      }

      return { geometry, color, id: i };
    }).filter(Boolean);
  }, [hexasphere, showOwnership, ownershipData, prng]);

  return (
    <group name="hexasphere-tiles">
      {tiles.map((tile) => {
        if (!tile) return null;
        return (
          <mesh
            key={tile.id}
            geometry={tile.geometry}
            matrixAutoUpdate={false}
            userData={{ id: tile.id }}
            name={`${tile.id}`}
          >
            <meshBasicMaterial color={new Color(tile.color)} />
          </mesh>
        );
      })}
    </group>
  );
};

export default HexasphereTiles;

