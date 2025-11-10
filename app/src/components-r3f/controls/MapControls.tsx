"use client";

import { useEffect, useRef } from "react";
import { TrackballControls as DreiTrackballControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import type { Vector3 } from "three";

interface MapControlsProps {
  autoRotate?: boolean;
  zoomSpeed?: number;
  initialPosition?: Vector3 | null;
}

/**
 * Map Controls - TrackballControls configured for map scene (3D globe)
 * - Full rotation capabilities
 * - Auto-rotation when idle
 * - Initial positioning to user sector
 */
export const MapControls: React.FC<MapControlsProps> = ({
  autoRotate = true,
  zoomSpeed = 0.1,
  initialPosition = null,
}) => {
  const controlsRef = useRef<any>(null);
  const { camera } = useThree();
  const isDragging = useRef(false);
  const lastTime = useRef(Date.now());
  const phi = useRef(0);
  const sigma = useRef(0);
  const cameraDistance = 22;

  // Set initial camera position if provided
  useEffect(() => {
    if (initialPosition && camera) {
      const { x, y, z } = initialPosition;
      sigma.current = Math.atan2(y, x);
      phi.current = Math.acos(z / Math.sqrt(x * x + y * y + z * z));
    }
  }, [initialPosition, camera]);

  // Track dragging state
  useEffect(() => {
    const onStart = () => {
      isDragging.current = true;
    };
    const onEnd = () => {
      isDragging.current = false;
    };

    const controls = controlsRef.current;
    if (controls) {
      controls.addEventListener("start", onStart);
      controls.addEventListener("end", onEnd);

      return () => {
        controls.removeEventListener("start", onStart);
        controls.removeEventListener("end", onEnd);
      };
    }
  }, []);

  // Auto-rotation logic
  useFrame(() => {
    if (autoRotate && !isDragging.current && controlsRef.current) {
      const dt = Date.now() - lastTime.current;
      const rotateCameraBy = (1 * Math.PI) / (50000 / dt);
      phi.current += rotateCameraBy;
      lastTime.current = Date.now();

      camera.position.x = cameraDistance * Math.sin(phi.current) * Math.cos(sigma.current);
      camera.position.y = cameraDistance * Math.sin(phi.current) * Math.sin(sigma.current);
      camera.position.z = cameraDistance * Math.cos(phi.current);
      camera.lookAt(0, 0, 0);
    }
  });

  return (
    <DreiTrackballControls
      ref={controlsRef}
      noPan={true}
      staticMoving={true}
      zoomSpeed={zoomSpeed}
      makeDefault
    />
  );
};

export default MapControls;

