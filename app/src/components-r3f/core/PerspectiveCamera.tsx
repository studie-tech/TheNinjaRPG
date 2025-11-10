"use client";

import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { PerspectiveCamera as ThreePerspectiveCamera } from "three";

interface PerspectiveCameraProps {
  fov?: number;
  aspect?: number;
  near?: number;
  far?: number;
  position?: [number, number, number];
}

/**
 * Perspective Camera component for Map scene (3D globe)
 * Provides 3D projection for the hexasphere
 */
export const PerspectiveCamera: React.FC<PerspectiveCameraProps> = ({
  fov = 75,
  aspect,
  near = 0.5,
  far = 1000,
  position = [0, 0, 22],
}) => {
  const cameraRef = useRef<ThreePerspectiveCamera>(null);
  const { set, size } = useThree();

  // Calculate aspect ratio from viewport if not provided
  const computedAspect = aspect ?? size.width / size.height;

  // Set this camera as the active camera
  useEffect(() => {
    if (cameraRef.current) {
      set({ camera: cameraRef.current });
    }
  }, [set]);

  // Update aspect ratio on resize
  useEffect(() => {
    if (cameraRef.current) {
      cameraRef.current.aspect = computedAspect;
      cameraRef.current.updateProjectionMatrix();
    }
  }, [computedAspect]);

  return (
    <perspectiveCamera
      ref={cameraRef}
      args={[fov, computedAspect, near, far]}
      position={position}
    />
  );
};

export default PerspectiveCamera;

