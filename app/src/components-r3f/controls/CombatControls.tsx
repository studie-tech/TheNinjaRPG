"use client";

import { OrbitControls } from "@react-three/drei";

interface CombatControlsProps {
  enableRotate?: boolean;
  zoomSpeed?: number;
  minZoom?: number;
  maxZoom?: number;
}

/**
 * Combat Controls - OrbitControls configured for combat scene
 * - Zoom only, no rotation
 * - Limited zoom range (1-3x)
 */
export const CombatControls: React.FC<CombatControlsProps> = ({
  enableRotate = false,
  zoomSpeed = 0.3,
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

export default CombatControls;
