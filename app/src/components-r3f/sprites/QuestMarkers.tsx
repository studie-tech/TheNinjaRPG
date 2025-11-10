"use client";

import { useLoader } from "@react-three/fiber";
import { TextureLoader } from "three";
import { IMG_SECTOR_USER_MARKER, IMG_SECTOR_USER_SPRITE_MASK } from "@/drizzle/constants";
import { getActiveObjectives } from "@/libs/quest";
import { findHex } from "@/libs/hexgrid";
import type { UserWithRelations } from "@/routers/profile";
import type { Grid } from "honeycomb-grid";
import type { TerrainHex } from "@/libs/hexgrid";

interface QuestMarkersProps {
  user: UserWithRelations;
  grid: Grid<TerrainHex>;
}

/**
 * Quest Markers component
 * Shows markers for active quest objectives
 */
export const QuestMarkers: React.FC<QuestMarkersProps> = ({ user, grid }) => {
  const markerTexture = useLoader(TextureLoader, IMG_SECTOR_USER_MARKER);
  const maskTexture = useLoader(TextureLoader, IMG_SECTOR_USER_SPRITE_MASK);

  const activeObjectives = getActiveObjectives(user);

  // Filter objectives to only show those in current sector
  const sectorObjectives = activeObjectives.filter(
    (obj) => "sector" in obj && Number(obj.sector) === user.sector,
  );

  return (
    <group name="quest-markers">
      {sectorObjectives.map((objective) => {
        if (
          !("latitude" in objective) ||
          !("longitude" in objective) ||
          !("image" in objective)
        ) {
          return null;
        }

        const hex = findHex(grid, { x: objective.longitude, y: objective.latitude });
        if (!hex) return null;

        const { height: h, width: w, center } = hex;

        // Determine marker color based on quest type
        let color = 0xf4e365; // Default yellow
        if (objective.task === "collect_item" || objective.task === "deliver_item") {
          color = 0x6666a3; // Purple
        } else if (objective.task === "defeat_opponents") {
          color = 0x9c273a; // Red
        } else if (objective.task === "dialog") {
          color = 0x6666a3; // Purple
        }

        return (
          <group key={objective.id} position={[center.x, center.y, -6]}>
            {/* Marker background */}
            <sprite position={[0, h * 0.4, 0]} scale={[h, h * 1.2, 1]}>
              <spriteMaterial
                map={markerTexture}
                alphaMap={markerTexture}
                color={color}
              />
            </sprite>

            {/* White background circle */}
            <sprite position={[0, h * 0.5, 1]} scale={[h * 0.8, h * 0.8, 1]}>
              <spriteMaterial map={maskTexture} alphaMap={maskTexture} color={0xd3d9ea} />
            </sprite>

            {/* Objective image */}
            {objective.image && (
              <ObjectiveImage
                image={objective.image}
                position={[0, h * 0.5, 2]}
                scale={[h * 0.6, h * 0.6, 1]}
                maskTexture={maskTexture}
              />
            )}
          </group>
        );
      })}
    </group>
  );
};

// Helper component for loading objective images
const ObjectiveImage: React.FC<{
  image: string;
  position: [number, number, number];
  scale: [number, number, number];
  maskTexture: THREE.Texture;
}> = ({ image, position, scale, maskTexture }) => {
  const texture = useLoader(TextureLoader, image);

  return (
    <sprite position={position} scale={scale}>
      <spriteMaterial map={texture} alphaMap={maskTexture} transparent />
    </sprite>
  );
};

export default QuestMarkers;

