"use client";

import { useMemo } from "react";
import { useLoader } from "@react-three/fiber";
import { TextureLoader } from "three";
import { SpriteAnimation } from "../effects/SpriteAnimation";
import type { GroundEffect, UserEffect } from "@/libs/combat/types";
import type { TerrainHex } from "@/libs/hexgrid";
import type { GameAsset } from "@/drizzle/schema";

interface CombatEffectSpriteProps {
  effect: GroundEffect | UserEffect;
  hex: TerrainHex;
  gameAssets: GameAsset[];
  animationId?: number;
}

/**
 * Combat Effect Sprite component
 * Renders ground effects and user effects with animations
 */
export const CombatEffectSprite: React.FC<CombatEffectSpriteProps> = ({
  effect,
  hex,
  gameAssets,
  animationId = 0,
}) => {
  const { height: h, width: w } = hex;

  // Find assets for this effect
  const staticAsset = useMemo(
    () => gameAssets.find((a) => a.id === effect.staticAssetPath),
    [gameAssets, effect.staticAssetPath],
  );

  const appearAnimAsset = useMemo(
    () => gameAssets.find((a) => a.id === effect.appearAnimation),
    [gameAssets, effect.appearAnimation],
  );

  const staticAnimAsset = useMemo(
    () => gameAssets.find((a) => a.id === effect.staticAnimation),
    [gameAssets, effect.staticAnimation],
  );

  // Load static texture if exists
  const staticTexture = staticAsset
    ? useLoader(TextureLoader, staticAsset.image)
    : null;

  // Calculate health bar for barriers
  const hpPercentage = useMemo(() => {
    if (effect.type === "barrier" && "curHealth" in effect && "maxHealth" in effect) {
      return Math.max(0, Math.min(1, effect.curHealth / effect.maxHealth));
    }
    return 0;
  }, [effect]);

  const position: [number, number, number] = [w / 2, h / 2, 0];

  return (
    <group position={position}>
      {/* Static sprite (if exists) */}
      {staticTexture && (
        <sprite position={[0, 0, 1]} scale={[w, h, 1]}>
          <spriteMaterial map={staticTexture} transparent />
        </sprite>
      )}

      {/* Appear animation (play once on creation) */}
      {appearAnimAsset && animationId !== 0 && (
        <SpriteAnimation
          texturePath={appearAnimAsset.image}
          frames={appearAnimAsset.frames}
          speed={appearAnimAsset.speed}
          position={[0, 0, 2]}
          scale={[w, h, 1]}
          playMode="once"
          hideWhenFinished={true}
        />
      )}

      {/* Static animation (loops infinitely) */}
      {staticAnimAsset && (
        <SpriteAnimation
          texturePath={staticAnimAsset.image}
          frames={staticAnimAsset.frames}
          speed={staticAnimAsset.speed}
          position={[0, 0, 2]}
          scale={[w, h, 1]}
          playMode="infinite"
        />
      )}

      {/* Health bar for barriers */}
      {effect.type === "barrier" && hpPercentage > 0 && (
        <>
          {/* HP bar background */}
          <sprite position={[0, -h * 0.4, 3]} scale={[w * 0.9, h * 0.1, 1]}>
            <spriteMaterial color={0x808080} opacity={0.8} transparent />
          </sprite>
          {/* HP bar foreground */}
          <sprite
            position={[-w * 0.45 * (1 - hpPercentage), -h * 0.4, 4]}
            scale={[w * 0.9 * hpPercentage, h * 0.1, 1]}
          >
            <spriteMaterial color={0xb22222} />
          </sprite>
        </>
      )}
    </group>
  );
};

export default CombatEffectSprite;

