"use client";

import { useRef, useState, useEffect } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import { TextureLoader, RepeatWrapping, LinearFilter, type Sprite } from "three";

interface SpriteAnimationProps {
  texturePath: string;
  frames: number;
  speed: number; // Frames per second
  position: [number, number, number];
  scale?: [number, number, number];
  playMode?: "once" | "loop" | "infinite";
  hideWhenFinished?: boolean;
  onFinished?: () => void;
}

/**
 * Sprite Animation component - R3F replacement for SpriteMixer
 * Handles sprite sheet animations with texture offset animation
 */
export const SpriteAnimation: React.FC<SpriteAnimationProps> = ({
  texturePath,
  frames,
  speed,
  position,
  scale = [50, 50, 1],
  playMode = "once",
  hideWhenFinished = false,
  onFinished,
}) => {
  const spriteRef = useRef<Sprite>(null);
  const [visible, setVisible] = useState(true);
  const [hasFinished, setHasFinished] = useState(false);
  const currentFrame = useRef(0);
  const elapsedTime = useRef(0);

  // Load texture
  const texture = useLoader(TextureLoader, texturePath);

  // Configure texture for sprite sheet animation
  useEffect(() => {
    if (texture) {
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
      texture.repeat.set(1 / frames, 1);
      texture.minFilter = LinearFilter;
      texture.magFilter = LinearFilter;
      texture.needsUpdate = true;
    }
  }, [texture, frames]);

  // Animation loop
  useFrame((state, delta) => {
    if (!visible || hasFinished) return;

    elapsedTime.current += delta;
    const frameTime = 1 / speed; // Time per frame in seconds

    if (elapsedTime.current >= frameTime) {
      currentFrame.current += 1;
      elapsedTime.current = 0;

      // Handle different play modes
      if (currentFrame.current >= frames) {
        if (playMode === "once") {
          currentFrame.current = frames - 1;
          setHasFinished(true);
          if (hideWhenFinished) {
            setVisible(false);
          }
          if (onFinished) {
            onFinished();
          }
        } else if (playMode === "loop" || playMode === "infinite") {
          currentFrame.current = 0;
        }
      }

      // Update texture offset
      if (texture) {
        texture.offset.x = currentFrame.current / frames;
        texture.needsUpdate = true;
      }
    }
  });

  if (!visible) return null;

  return (
    <sprite ref={spriteRef} position={position} scale={scale}>
      <spriteMaterial map={texture} transparent={true} />
    </sprite>
  );
};

export default SpriteAnimation;
