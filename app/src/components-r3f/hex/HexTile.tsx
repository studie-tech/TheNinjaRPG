"use client";

import { useRef, useState } from "react";
import { BufferAttribute, BufferGeometry, type Mesh as ThreeMesh } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { TerrainHex } from "@/libs/hexgrid";

interface HexTileProps {
  hex: TerrainHex;
  color?: string | number;
  isHighlighted?: boolean;
  highlightColor?: string | number;
  canClick?: boolean;
  onClick?: (hex: TerrainHex) => void;
  onPointerOver?: (hex: TerrainHex) => void;
  onPointerOut?: (hex: TerrainHex) => void;
  visible?: boolean;
}

/**
 * Individual Hex Tile component
 * Renders a single hexagonal tile with click/hover interactions
 */
export const HexTile: React.FC<HexTileProps> = ({
  hex,
  color = 0x808080,
  isHighlighted = false,
  highlightColor = 0x00ffd8,
  canClick = false,
  onClick,
  onPointerOver,
  onPointerOut,
  visible = true,
}) => {
  const meshRef = useRef<ThreeMesh>(null);
  const [hovered, setHovered] = useState(false);

  // Create geometry from hex corners
  const geometry = new BufferGeometry();
  const corners = hex.corners;

  // Create vertices for the hex (center + corners)
  const vertices: number[] = [];

  // Center point
  const center = hex.center;
  vertices.push(center.x, center.y, 0);

  // Add corner points
  corners.forEach((corner) => {
    vertices.push(corner.x, corner.y, 0);
  });

  // Create indices for triangles (fan triangulation from center)
  const indices: number[] = [];
  for (let i = 1; i < corners.length; i++) {
    indices.push(0, i, i + 1);
  }
  // Close the fan
  indices.push(0, corners.length, 1);

  geometry.setAttribute("position", new BufferAttribute(new Float32Array(vertices), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (canClick && onClick) {
      e.stopPropagation();
      onClick(hex);
    }
  };

  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(true);
    if (canClick) {
      document.body.style.cursor = "pointer";
    }
    if (onPointerOver) {
      onPointerOver(hex);
    }
  };

  const handlePointerOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(false);
    document.body.style.cursor = "default";
    if (onPointerOut) {
      onPointerOut(hex);
    }
  };

  // Determine final color
  const finalColor = isHighlighted || hovered ? highlightColor : color;

  if (!visible) return null;

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
      userData={{ type: "tile", tile: hex, canClick }}
    >
      <meshBasicMaterial color={finalColor} />
    </mesh>
  );
};

export default HexTile;

