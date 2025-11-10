"use client";

import { useRef, useState, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, type Mesh as ThreeMesh } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { TerrainHex } from "@/libs/hexgrid";
import type { CombatAction, ReturnedBattle } from "@/libs/combat/types";
import type { Grid } from "honeycomb-grid";
import { getPossibleActionTiles } from "@/libs/hexgrid";
import { calcActiveUser } from "@/libs/combat/actions";

interface CombatHexTileProps {
  hex: TerrainHex;
  battle: ReturnedBattle;
  battleGrid: Grid<TerrainHex>;
  userId: string;
  action?: CombatAction;
  timeDiff: number;
  precomputedActions: CombatAction[];
  onClick?: (hex: TerrainHex) => void;
}

/**
 * Combat-specific Hex Tile with action highlighting
 * Shows which tiles can be clicked based on current action
 */
export const CombatHexTile: React.FC<CombatHexTileProps> = ({
  hex,
  battle,
  battleGrid,
  userId,
  action,
  timeDiff,
  precomputedActions,
  onClick,
}) => {
  const meshRef = useRef<ThreeMesh>(null);
  const [hovered, setHovered] = useState(false);

  // Determine if this tile can be clicked
  const canClick = useMemo(() => {
    if (!action) return false;

    const { actor } = calcActiveUser(battle, userId, timeDiff, {
      precomputedUserId: userId,
      precomputedActions,
    });

    if (actor.userId !== userId) return false;

    const possibleTiles = getPossibleActionTiles(
      battleGrid,
      actor,
      action,
      battle.usersState,
      battle.groundEffects,
    );

    if (!possibleTiles) return false;
    return Array.from(possibleTiles).some((tile) => tile.col === hex.col && tile.row === hex.row);
  }, [action, battle, battleGrid, userId, timeDiff, precomputedActions, hex.col, hex.row]);

  // Create geometry from hex corners
  const geometry = useMemo(() => {
    const geom = new BufferGeometry();
    const corners = hex.corners;
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

    geom.setAttribute("position", new BufferAttribute(new Float32Array(vertices), 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    return geom;
  }, [hex]);

  // Pulsing animation for clickable tiles
  useFrame((state) => {
    if (meshRef.current && canClick) {
      const pulse = Math.sin(state.clock.elapsedTime * 3) * 0.5 + 0.5;
      meshRef.current.material.opacity = 0.3 + pulse * 0.3;
    }
  });

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
  };

  const handlePointerOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(false);
    document.body.style.cursor = "default";
  };

  // Determine color based on state
  const color = useMemo(() => {
    if (hovered && canClick) return 0x00ff00; // Green when hovering clickable tile
    if (canClick) return 0xffff00; // Yellow for clickable tiles
    return hex.color ?? 0x808080; // Default color
  }, [hovered, canClick, hex.color]);

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
      userData={{ type: "tile", tile: hex, canClick }}
    >
      <meshBasicMaterial
        color={color}
        transparent={canClick}
        opacity={canClick ? 0.6 : 1.0}
      />
    </mesh>
  );
};

export default CombatHexTile;

