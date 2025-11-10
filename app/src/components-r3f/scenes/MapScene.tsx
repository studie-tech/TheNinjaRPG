"use client";

import { useRef, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { Canvas } from "../core/Canvas";
import { MapControls } from "../controls/MapControls";
import { HexasphereTiles } from "../globe/HexasphereTiles";
import { VillageLabel } from "../globe/VillageLabel";
import { UserLocationMarker } from "../globe/UserLocationMarker";
import { QuestHighlights } from "../globe/QuestHighlights";
import { WarHighlights } from "../globe/WarHighlights";
import type { Village, StructureWithRelations } from "@/drizzle/schema";
import type { GlobalMapData, GlobalTile } from "@/libs/travel/types";
import * as THREE from "three";

interface MapSceneProps {
  hexasphere: GlobalMapData;
  highlights?: Village[];
  usersHighlighted?: {
    userId: string;
    sector: number;
    avatar: string | null;
    avatarLight: string | null;
  }[];
  userLocation?: boolean;
  userSector?: number;
  userAvatar?: string | null;
  highlightedSector?: number;
  intersection: boolean;
  showOwnership?: boolean;
  ownershipData?: {
    sectors: { sector: number; villageId: string }[];
    colors: { id: string; hexColor: string }[];
    wars: { sector: number }[];
  };
  questStructures?: StructureWithRelations[];
  onTileClick?: (sector: number | null, tile: GlobalTile | null) => void;
  onTileHover?: (sector: number | null, tile: GlobalTile | null) => void;
}

/**
 * MapScene Inner Component (inside Canvas)
 */
function MapSceneInner({
  hexasphere,
  highlights,
  usersHighlighted,
  userLocation,
  userSector,
  userAvatar,
  highlightedSector,
  intersection,
  showOwnership,
  ownershipData,
  questStructures,
  onTileClick,
  onTileHover,
}: MapSceneProps) {
  const { raycaster, camera, gl } = useThree();
  const tilesRef = useRef<THREE.Group>(null);

  // Handle tile click
  const handleDoubleClick = () => {
    if (!intersection || !onTileClick || !tilesRef.current) return;

    const intersects = raycaster.intersectObjects(tilesRef.current.children, true);
    if (intersects.length > 0) {
      const sector = intersects[0].object.userData.id as number;
      const tile = hexasphere?.tiles[sector];
      if (tile !== undefined) {
        onTileClick(sector, tile);
      }
    }
  };

  // Handle tile hover
  const handlePointerMove = () => {
    if (!intersection || !onTileHover || !tilesRef.current) return;

    const intersects = raycaster.intersectObjects(tilesRef.current.children, true);
    if (intersects.length > 0) {
      const sector = intersects[0].object.userData.id as number;
      const tile = hexasphere?.tiles[sector];
      if (tile !== undefined) {
        onTileHover(sector, tile);
      }
    } else {
      onTileHover(null, null);
    }
  };

  // Add event listeners
  if (intersection) {
    gl.domElement.addEventListener("dblclick", handleDoubleClick);
    gl.domElement.addEventListener("pointermove", handlePointerMove);
  }

  // War highlights (red markers)
  const warHighlights = useMemo(() => {
    if (!ownershipData?.wars) return [];
    return ownershipData.wars
      .map((war) => {
        const sector = hexasphere?.tiles[war.sector];
        if (!sector?.c) return null;
        return {
          sectorId: war.sector,
          position: sector.c,
          color: "red",
        };
      })
      .filter(Boolean) as { sectorId: number; position: any; color: string }[];
  }, [ownershipData, hexasphere]);

  return (
    <>
      {/* Camera */}
      <perspectiveCamera
        makeDefault
        position={[0, 0, 50]}
        fov={75}
        near={0.5}
        far={1000}
      />

      {/* Controls */}
      <MapControls />

      {/* Ambient light */}
      <ambientLight intensity={1.0} />

      {/* Hexasphere tiles */}
      <group ref={tilesRef}>
        <HexasphereTiles
          hexasphere={hexasphere}
          showOwnership={showOwnership}
          ownershipData={ownershipData}
          highlightedSector={highlightedSector}
        />
      </group>

      {/* Village labels */}
      {highlights?.map((village) => {
        const sector = hexasphere?.tiles[village.sector]?.c;
        if (!sector) return null;
        return <VillageLabel key={village.id} village={village} sector={sector} />;
      })}

      {/* User location marker */}
      {userLocation && userSector !== undefined && userAvatar && (
        <UserLocationMarker
          sector={hexasphere?.tiles[userSector]?.c}
          avatar={userAvatar}
          borderColor="white"
          distance={0.5}
          showLine
        />
      )}

      {/* Highlighted users (bounty targets) */}
      {usersHighlighted?.map((user) => {
        const sector = hexasphere?.tiles[user.sector]?.c;
        if (!sector) return null;
        return (
          <UserLocationMarker
            key={user.userId}
            sector={sector}
            avatar={user.avatar}
            borderColor="red"
            distance={0.0}
            showLine={false}
          />
        );
      })}

      {/* Quest highlights */}
      {questStructures && <QuestHighlights structures={questStructures} />}

      {/* War highlights */}
      {warHighlights.length > 0 && <WarHighlights highlights={warHighlights} />}
    </>
  );
}

/**
 * MapScene Component
 * Main scene for the global map view
 */
export const MapScene: React.FC<MapSceneProps> = (props) => {
  return (
    <Canvas>
      <MapSceneInner {...props} />
    </Canvas>
  );
};

export default MapScene;
