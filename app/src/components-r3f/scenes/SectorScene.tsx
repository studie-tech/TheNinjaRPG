"use client";

import React, { useMemo } from "react";
import alea from "alea";
import { BaseCanvas } from "../core/Canvas";
import { OrthoCamera } from "../core/OrthographicCamera";
import { SectorControls } from "../controls/SectorControls";
import { ProceduralHexGrid } from "../hex/ProceduralHexGrid";
import { HexEdges } from "../hex/HexEdges";
import { SectorUserSprite } from "../sprites/SectorUserSprite";
import { StructureSprite } from "../sprites/StructureSprite";
import { QuestMarkers } from "../sprites/QuestMarkers";
import { findHex } from "@/libs/hexgrid";
import { getBackgroundColor } from "@/libs/travel/biome";
import type { SectorUser, GlobalTile } from "@/libs/travel/types";
import type { VillageStructure } from "@/drizzle/schema";
import type { TerrainHex } from "@/libs/hexgrid";
import type { UserWithRelations } from "@/routers/profile";
import type { Grid } from "honeycomb-grid";

interface SectorSceneProps {
  sector: number;
  tile: GlobalTile;
  users: SectorUser[];
  structures: VillageStructure[];
  userPosition: { x: number; y: number };
  currentUserId: string;
  userData: UserWithRelations;
  grid: Grid<TerrainHex>;
  hasVillage: boolean;
  onTileClick: (hex: TerrainHex) => void;
  onUserAttack: (user: SectorUser) => void;
  onUserInfo: (user: SectorUser) => void;
  onUserHeal?: (user: SectorUser) => void;
  width: number;
  height: number;
}

/**
 * Sector Scene - Complete R3F scene for sector view
 * Replaces the imperative Three.js implementation in Sector.tsx
 */
export const SectorScene: React.FC<SectorSceneProps> = ({
  sector,
  tile,
  users,
  structures,
  userPosition,
  currentUserId,
  userData,
  grid,
  hasVillage,
  onTileClick,
  onUserAttack,
  onUserInfo,
  onUserHeal,
  width,
  height,
}) => {
  // Seeded random number generator for consistent map generation
  const prng = useMemo(() => alea(sector + 1), [sector]);

  // Background color based on tile type
  const { color } = getBackgroundColor(tile);

  return (
    <BaseCanvas
      type="sector"
      width={width}
      height={height}
      backgroundColor={color}
      backgroundAlpha={1}
    >
      <OrthoCamera
        width={width}
        height={height}
        initialZoom={1}
        minZoom={1}
        maxZoom={3}
      />
      <SectorControls enableRotate={false} zoomSpeed={1.0} />

      {/* Procedurally generated hex grid */}
      <ProceduralHexGrid
        prng={prng}
        tile={tile}
        hasVillage={hasVillage}
        onTileClick={onTileClick}
      />

      {/* Hex edges */}
      <HexEdges grid={grid} color={0x000000} lineWidth={1} />

      {/* Village structures */}
      <group name="structures">
        {structures.map((structure) => {
          const hex = findHex(grid, {
            x: structure.longitude,
            y: structure.latitude,
          });
          if (!hex) return null;

          return <StructureSprite key={structure.id} structure={structure} hex={hex} />;
        })}
      </group>

      {/* Users in the sector */}
      <group name="users">
        {users.map((user) => {
          const hex = findHex(grid, {
            x: user.longitude,
            y: user.latitude,
          });
          if (!hex) return null;

          const isCurrentUser = user.userId === currentUserId;
          const canAttack = !isCurrentUser && user.status === "AWAKE";
          const canHeal = !isCurrentUser && user.curHealth < user.maxHealth;

          return (
            <SectorUserSprite
              key={user.userId}
              user={user}
              hex={hex}
              showControls={!isCurrentUser}
              onAttack={canAttack ? () => onUserAttack(user) : undefined}
              onInfo={() => onUserInfo(user)}
              onHeal={canHeal && onUserHeal ? () => onUserHeal(user) : undefined}
            />
          );
        })}
      </group>

      {/* Quest markers */}
      <QuestMarkers user={userData} grid={grid} />
    </BaseCanvas>
  );
};

export default SectorScene;

