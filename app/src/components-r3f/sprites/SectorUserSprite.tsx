"use client";

import { useMemo, useRef } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import { TextureLoader, LinearFilter, DoubleSide, Sprite as ThreeSprite } from "three";
import {
  IMG_SECTOR_SHADOW,
  IMG_SECTOR_USER_MARKER,
  IMG_SECTOR_USER_SPRITE_MASK,
  IMG_SECTOR_INFO,
  IMG_SECTOR_ATTACK,
  IMG_ICON_HEAL,
} from "@/drizzle/constants";
import type { SectorUser } from "@/libs/travel/types";
import type { TerrainHex } from "@/libs/hexgrid";

interface SectorUserSpriteProps {
  user: SectorUser;
  hex: TerrainHex;
  showControls?: boolean;
  onAttack?: () => void;
  onInfo?: () => void;
  onHeal?: () => void;
}

/**
 * Sector User Sprite component
 * Renders a user in sector with avatar, health bar, and action buttons
 */
export const SectorUserSprite: React.FC<SectorUserSpriteProps> = ({
  user,
  hex,
  showControls = true,
  onAttack,
  onInfo,
  onHeal,
}) => {
  const { height: h, width: w } = hex;
  const spriteRef = useRef<ThreeSprite>(null);
  const rotation = useRef(0);

  // Load textures
  const shadowTexture = useLoader(TextureLoader, IMG_SECTOR_SHADOW);
  const avatarTexture = useLoader(TextureLoader, user.avatar || "");
  const markerTexture = useLoader(TextureLoader, IMG_SECTOR_USER_MARKER);
  const maskTexture = useLoader(TextureLoader, IMG_SECTOR_USER_SPRITE_MASK);
  const infoTexture = useLoader(TextureLoader, IMG_SECTOR_INFO);
  const attackTexture = useLoader(TextureLoader, IMG_SECTOR_ATTACK);
  const healTexture = useLoader(TextureLoader, IMG_ICON_HEAL);

  // Configure textures
  useMemo(() => {
    shadowTexture.generateMipmaps = false;
    shadowTexture.minFilter = LinearFilter;
    avatarTexture.generateMipmaps = false;
    avatarTexture.minFilter = LinearFilter;
  }, [shadowTexture, avatarTexture]);

  // Rotate sprite slowly
  useFrame((state, delta) => {
    rotation.current += delta * 0.5; // Slow rotation
  });

  // Calculate health bar width
  const hpPercentage = Math.max(0, Math.min(1, user.curHealth / user.maxHealth));

  const position: [number, number, number] = [w / 2, h / 2, -6];

  const villageColor = user.village
    ? parseInt(user.village.hexColor?.replace("#", "") || "000000", 16)
    : 0x000000;

  return (
    <group position={position}>
      {/* Shadow */}
      <sprite position={[0, -h * 0.3, 0]} scale={[w * 0.7, h * 0.4, 1]}>
        <spriteMaterial map={shadowTexture} />
      </sprite>

      {/* Village color marker background */}
      <sprite position={[0, h * 0.4, 1]} scale={[h, h * 1.2, 1]}>
        <spriteMaterial
          map={markerTexture}
          alphaMap={markerTexture}
          color={villageColor}
        />
      </sprite>

      {/* White marker background */}
      <sprite position={[0, h * 0.4, 2]} scale={[0.9 * h, h * 1.1, 1]}>
        <spriteMaterial map={markerTexture} alphaMap={markerTexture} />
      </sprite>

      {/* Avatar with mask */}
      <sprite
        ref={spriteRef}
        position={[0, h * 0.5, 3]}
        scale={[h * 0.8, h * 0.8, 1]}
        material-side={DoubleSide}
      >
        <spriteMaterial map={avatarTexture} alphaMap={maskTexture} />
      </sprite>

      {/* Health bar background */}
      <sprite position={[0, -h * 0.5, 4]} scale={[w * 0.9, h * 0.1, 1]}>
        <spriteMaterial color={0x808080} opacity={0.8} transparent />
      </sprite>

      {/* Health bar foreground */}
      {hpPercentage > 0 && (
        <sprite
          position={[-w * 0.45 * (1 - hpPercentage), -h * 0.5, 5]}
          scale={[w * 0.9 * hpPercentage, h * 0.1, 1]}
        >
          <spriteMaterial color={0xb22222} />
        </sprite>
      )}

      {/* Control buttons (if enabled) */}
      {showControls && (
        <>
          {/* Info button */}
          {onInfo && (
            <sprite
              position={[-w * 0.4, h * 0.8, 6]}
              scale={[h * 0.3, h * 0.3, 1]}
              onClick={onInfo}
              onPointerOver={(e) => {
                e.stopPropagation();
                document.body.style.cursor = "pointer";
              }}
              onPointerOut={() => {
                document.body.style.cursor = "default";
              }}
            >
              <spriteMaterial map={infoTexture} />
            </sprite>
          )}

          {/* Attack button */}
          {onAttack && (
            <sprite
              position={[w * 0.4, h * 0.8, 6]}
              scale={[h * 0.3, h * 0.3, 1]}
              onClick={onAttack}
              onPointerOver={(e) => {
                e.stopPropagation();
                document.body.style.cursor = "pointer";
              }}
              onPointerOut={() => {
                document.body.style.cursor = "default";
              }}
            >
              <spriteMaterial map={attackTexture} />
            </sprite>
          )}

          {/* Heal button */}
          {onHeal && user.curHealth < user.maxHealth && (
            <sprite
              position={[0, -h * 0.7, 6]}
              scale={[h * 0.3, h * 0.3, 1]}
              onClick={onHeal}
              onPointerOver={(e) => {
                e.stopPropagation();
                document.body.style.cursor = "pointer";
              }}
              onPointerOut={() => {
                document.body.style.cursor = "default";
              }}
            >
              <spriteMaterial map={healTexture} />
            </sprite>
          )}
        </>
      )}
    </group>
  );
};

export default SectorUserSprite;

