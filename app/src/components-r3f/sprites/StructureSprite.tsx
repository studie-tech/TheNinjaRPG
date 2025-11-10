"use client";

import { useLoader } from "@react-three/fiber";
import { TextureLoader, LinearFilter } from "three";
import type { VillageStructure } from "@/drizzle/schema";
import type { TerrainHex } from "@/libs/hexgrid";

interface StructureSpriteProps {
  structure: VillageStructure;
  hex: TerrainHex;
}

/**
 * Structure Sprite component
 * Renders village structures (buildings, walls, etc.)
 */
export const StructureSprite: React.FC<StructureSpriteProps> = ({ structure, hex }) => {
  const { height: h, width: w } = hex;

  // Load structure texture
  const texture = useLoader(TextureLoader, structure.image);

  // Configure texture
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;

  const position: [number, number, number] = [w / 2, h / 2, 0];

  return (
    <group position={position}>
      <sprite position={[0, 0, 1]} scale={[w, h, 1]}>
        <spriteMaterial map={texture} transparent />
      </sprite>

      {/* Health bar for structures with HP */}
      {structure.curHp !== null && structure.maxHp !== null && structure.maxHp > 0 && (
        <>
          {/* HP bar background */}
          <sprite position={[0, -h * 0.4, 2]} scale={[w * 0.9, h * 0.1, 1]}>
            <spriteMaterial color={0x808080} opacity={0.8} transparent />
          </sprite>
          {/* HP bar foreground */}
          {structure.curHp > 0 && (
            <sprite
              position={[
                -w * 0.45 * (1 - structure.curHp / structure.maxHp),
                -h * 0.4,
                3,
              ]}
              scale={[w * 0.9 * (structure.curHp / structure.maxHp), h * 0.1, 1]}
            >
              <spriteMaterial color={0x4169e1} />
            </sprite>
          )}
        </>
      )}
    </group>
  );
};

export default StructureSprite;

