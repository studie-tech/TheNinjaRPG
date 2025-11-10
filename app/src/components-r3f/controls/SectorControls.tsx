"use client";

import { OrbitControls } from "@react-three/drei";

interface SectorControlsProps {
  enableRotate?: boolean;
  zoomSpeed?: number;
  minZoom?: number;
  maxZoom?: number;
}

/**
 * Sector Controls - OrbitControls configured for sector scene
 * - Zoom and pan capabilities
 * - No rotation
 */
export const SectorControls: React.FC<SectorControlsProps> = ({
  enableRotate = false,
  zoomSpeed = 1.0,
  minZoom = 1,
  maxZoom = 3,
}) => {
  return (
    <OrbitControls
      enableRotate={enableRotate}
      enablePan={false}
      zoomSpeed={zoomSpeed}
      minZoom={minZoom}
      maxZoom={maxZoom}
      makeDefault
    />
  );
};

export default SectorControls;
