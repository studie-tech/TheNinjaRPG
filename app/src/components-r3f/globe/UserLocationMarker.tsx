"use client";

import { useLoader } from "@react-three/fiber";
import { TextureLoader, LinearFilter } from "three";
import { Line } from "@react-three/drei";
import { IMG_AVATAR_DEFAULT, IMG_SECTOR_USER_SPRITE_MASK } from "@/drizzle/constants";
import type { GlobalPoint } from "@/libs/travel/types";

interface UserLocationMarkerProps {
  sector: GlobalPoint;
  avatar: string | null;
  borderColor?: string;
  distance?: number;
  showLine?: boolean;
}

/**
 * User Location Marker for Map
 * Shows user's current location on the globe
 */
export const UserLocationMarker: React.FC<UserLocationMarkerProps> = ({
  sector,
  avatar,
  borderColor = "white",
  distance = 0.5,
  showLine = true,
}) => {
  const d = 3 - distance;
  
  // Load textures
  const avatarTexture = useLoader(TextureLoader, avatar || IMG_AVATAR_DEFAULT);
  const maskTexture = useLoader(TextureLoader, IMG_SECTOR_USER_SPRITE_MASK);

  avatarTexture.generateMipmaps = false;
  avatarTexture.minFilter = LinearFilter;

  // Line connecting to surface
  const linePoints: [number, number, number][] = showLine
    ? [
        [sector.x / 3, sector.y / 3, sector.z / 3],
        [sector.x / d, sector.y / d, sector.z / d],
      ]
    : [];

  return (
    <group>
      {/* Connecting line */}
      {showLine && <Line points={linePoints} color="#000000" lineWidth={1} />}

      {/* Border circle */}
      <sprite position={[sector.x / d, sector.y / d, sector.z / d]} scale={[1.2, 1.2, 1.2]}>
        <spriteMaterial color={borderColor} transparent depthWrite={false} depthTest={false} />
      </sprite>

      {/* Avatar */}
      <sprite position={[sector.x / d, sector.y / d, sector.z / d]} scale={[1, 1, 1]}>
        <spriteMaterial
          map={avatarTexture}
          alphaMap={maskTexture}
          transparent
          depthWrite={false}
          depthTest={false}
        />
      </sprite>
    </group>
  );
};

export default UserLocationMarker;

