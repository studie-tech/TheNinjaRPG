"use client";

import { useMemo } from "react";
import { useLoader } from "@react-three/fiber";
import { TextureLoader, LinearFilter, DoubleSide } from "three";
import {
  IMG_SECTOR_SHADOW,
  IMG_SECTOR_USER_MARKER,
  IMG_SECTOR_USER_SPRITE_MASK,
  IMG_BATTLEFIELD_STAR,
} from "@/drizzle/constants";
import type { ReturnedUserState } from "@/libs/combat/types";
import type { TerrainHex } from "@/libs/hexgrid";

interface CombatUserSpriteProps {
  user: ReturnedUserState;
  hex: TerrainHex;
  playerId?: string;
}

/**
 * Combat User Sprite component
 * Renders a user in combat with avatar, health bar, markers, etc.
 */
export const CombatUserSprite: React.FC<CombatUserSpriteProps> = ({
  user,
  hex,
  playerId,
}) => {
  const { height: h, width: w } = hex;

  // Don't render if dead or fled
  if (user.curHealth <= 0 || user.fledBattle) {
    return null;
  }

  const noMarker = user.isAi && user.isOriginal;
  const villageColor = user.village
    ? parseInt(user.village.hexColor.replace("#", ""), 16)
    : 0x000000;

  // Load textures
  const shadowTexture = useLoader(TextureLoader, IMG_SECTOR_SHADOW);
  const avatarTexture = useLoader(TextureLoader, user.avatar || "");
  const markerTexture = useLoader(TextureLoader, IMG_SECTOR_USER_MARKER);
  const maskTexture = useLoader(TextureLoader, IMG_SECTOR_USER_SPRITE_MASK);
  const starTexture = useLoader(TextureLoader, IMG_BATTLEFIELD_STAR);
  const clanTexture = user.clan?.image
    ? useLoader(TextureLoader, user.clan.image)
    : null;

  // Configure textures
  useMemo(() => {
    shadowTexture.generateMipmaps = false;
    shadowTexture.minFilter = LinearFilter;

    avatarTexture.generateMipmaps = false;
    avatarTexture.minFilter = LinearFilter;

    // Mirror avatar if facing right
    if (user.direction === "right" && noMarker) {
      avatarTexture.repeat.set(-1, 1);
      avatarTexture.offset.set(1, 0);
    }
  }, [shadowTexture, avatarTexture, user.direction, noMarker]);

  // Calculate health bar width
  const hpPercentage = Math.max(0, Math.min(1, user.curHealth / user.maxHealth));

  const position: [number, number, number] = [w / 2, h / 2, -6];

  return (
    <group position={position}>
      {/* Shadow */}
      <sprite position={[0, -h * 0.2, 0]} scale={[w * 0.7, h * 0.4, 1]}>
        <spriteMaterial map={shadowTexture} />
      </sprite>

      {noMarker ? (
        /* AI Original - Show raw avatar */
        <>
          <sprite
            position={[0, h * 0.1, 0]}
            scale={[-1 * h * 0.8, h * 0.8, 1]}
            material-side={DoubleSide}
          >
            <spriteMaterial map={avatarTexture} />
          </sprite>
          {user.isSummon && user.controllerId === playerId && (
            <sprite position={[0, -h * 0.3, 0]} scale={[h / 2.5, h / 2.5, 1]}>
              <spriteMaterial map={starTexture} />
            </sprite>
          )}
        </>
      ) : (
        /* Regular User - Show with marker background */
        <>
          {/* Village color highlight */}
          <sprite position={[0, h * 0.4, 0]} scale={[h, h * 1.2, 1]}>
            <spriteMaterial
              map={markerTexture}
              alphaMap={markerTexture}
              color={villageColor}
            />
          </sprite>

          {/* White marker background */}
          <sprite position={[0, h * 0.4, 1]} scale={[0.9 * h, h * 1.1, 1]}>
            <spriteMaterial map={markerTexture} alphaMap={markerTexture} />
          </sprite>

          {/* Avatar with mask */}
          <sprite position={[0, h * 0.5, 2]} scale={[h * 0.8, h * 0.8, 1]}>
            <spriteMaterial map={avatarTexture} alphaMap={maskTexture} />
          </sprite>

          {/* Clan icon if present */}
          {user.clan?.image && clanTexture && (
            <>
              {/* Clan border */}
              <sprite position={[0.4 * w, h * 0.9, 3]} scale={[-1 * h * 0.3 - 2, h * 0.3 + 2, 1]}>
                <spriteMaterial
                  map={maskTexture}
                  alphaMap={maskTexture}
                  color={0xffd700}
                />
              </sprite>
              {/* Clan icon */}
              <sprite position={[0.4 * w, h * 0.9, 4]} scale={[-1 * h * 0.3, h * 0.3, 1]}>
                <spriteMaterial map={clanTexture} alphaMap={maskTexture} />
              </sprite>
            </>
          )}
        </>
      )}

      {/* Star for original player character */}
      {"curStamina" in user && user.isOriginal && !user.isAi && (
        <sprite position={[0, -h * 0.1, 5]} scale={[h / 2.5, h / 2.5, 1]}>
          <spriteMaterial map={starTexture} />
        </sprite>
      )}

      {/* Health bar background */}
      <sprite
        position={[0, noMarker ? -h * 0.375 : -h * 0.5, 6]}
        scale={[w * 0.9, h * 0.1, 1]}
      >
        <spriteMaterial color={0x808080} opacity={0.8} transparent />
      </sprite>

      {/* Health bar foreground */}
      {hpPercentage > 0 && (
        <sprite
          position={[-w * 0.45 * (1 - hpPercentage), noMarker ? -h * 0.375 : -h * 0.5, 7]}
          scale={[w * 0.9 * hpPercentage, h * 0.1, 1]}
        >
          <spriteMaterial color={0xb22222} />
        </sprite>
      )}

      {/* Chakra/Stamina bars for player character */}
      {"curChakra" in user && user.isOriginal && !user.isAi && (
        <>
          {/* Chakra bar background */}
          <sprite position={[0, -h * 0.6, 6]} scale={[w * 0.9, h * 0.08, 1]}>
            <spriteMaterial color={0x808080} opacity={0.8} transparent />
          </sprite>
          {/* Chakra bar foreground */}
          {user.curChakra > 0 && (
            <sprite
              position={[
                -w * 0.45 * (1 - user.curChakra / user.maxChakra),
                -h * 0.6,
                7,
              ]}
              scale={[w * 0.9 * (user.curChakra / user.maxChakra), h * 0.08, 1]}
            >
              <spriteMaterial color={0x4169e1} />
            </sprite>
          )}

          {/* Stamina bar background */}
          <sprite position={[0, -h * 0.7, 6]} scale={[w * 0.9, h * 0.08, 1]}>
            <spriteMaterial color={0x808080} opacity={0.8} transparent />
          </sprite>
          {/* Stamina bar foreground */}
          {user.curStamina > 0 && (
            <sprite
              position={[
                -w * 0.45 * (1 - user.curStamina / user.maxStamina),
                -h * 0.7,
                7,
              ]}
              scale={[w * 0.9 * (user.curStamina / user.maxStamina), h * 0.08, 1]}
            >
              <spriteMaterial color={0x32cd32} />
            </sprite>
          )}
        </>
      )}
    </group>
  );
};

export default CombatUserSprite;

