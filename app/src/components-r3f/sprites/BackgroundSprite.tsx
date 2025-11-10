"use client";

import { useLoader } from "@react-three/fiber";
import { TextureLoader, LinearFilter } from "three";

interface BackgroundSpriteProps {
  texturePath: string;
  width: number;
  height: number;
  position?: [number, number, number];
}

/**
 * Background Sprite component for combat scenes
 * Renders a full-screen background image
 */
export const BackgroundSprite: React.FC<BackgroundSpriteProps> = ({
  texturePath,
  width,
  height,
  position = [width / 2, height / 2, -10],
}) => {
  const texture = useLoader(TextureLoader, texturePath);

  // Configure texture
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;

  return (
    <sprite position={position} scale={[width, height, 1]}>
      <spriteMaterial map={texture} transparent={false} />
    </sprite>
  );
};

export default BackgroundSprite;

