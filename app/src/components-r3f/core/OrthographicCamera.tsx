"use client";

import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { OrthographicCamera as ThreeOrthographicCamera } from "three";

interface OrthoCameraProps {
  width: number;
  height: number;
  initialZoom?: number;
  minZoom?: number;
  maxZoom?: number;
  position?: [number, number, number];
  near?: number;
  far?: number;
}

/**
 * Orthographic Camera component for Combat and Sector scenes
 * Provides 2D-style projection with zoom capabilities
 */
export const OrthoCamera: React.FC<OrthoCameraProps> = ({
  width,
  height,
  initialZoom = 1,
  minZoom = 1,
  maxZoom = 3,
  position = [0, 0, 0],
  near = -10,
  far = 10,
}) => {
  const cameraRef = useRef<ThreeOrthographicCamera>(null);
  const { set } = useThree();

  // Set this camera as the active camera
  useEffect(() => {
    if (cameraRef.current) {
      set({ camera: cameraRef.current });
    }
  }, [set]);

  // Update camera on dimension changes
  useEffect(() => {
    if (cameraRef.current) {
      cameraRef.current.left = 0;
      cameraRef.current.right = width;
      cameraRef.current.top = height;
      cameraRef.current.bottom = 0;
      cameraRef.current.updateProjectionMatrix();
    }
  }, [width, height]);

  return (
    <orthographicCamera
      ref={cameraRef}
      args={[0, width, height, 0, near, far]}
      zoom={initialZoom}
      position={position}
    />
  );
};

export default OrthoCamera;

