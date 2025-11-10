"use client";

import { useMemo } from "react";
import { DoubleSide } from "three";
import type { GlobalPoint } from "@/libs/travel/types";

interface WarHighlight {
  sectorId: number;
  position: GlobalPoint;
  color: string;
}

interface WarHighlightsProps {
  highlights: WarHighlight[];
}

/**
 * War Highlights for Map
 * Shows war zones on the globe
 */
export const WarHighlights: React.FC<WarHighlightsProps> = ({ highlights }) => {
  const markers = useMemo(
    () =>
      highlights.map((highlight) => ({
        id: highlight.sectorId,
        position: [
          highlight.position.x / 3,
          highlight.position.y / 3,
          highlight.position.z / 3,
        ] as [number, number, number],
        color: highlight.color,
      })),
    [highlights]
  );

  return (
    <>
      {markers.map((marker) => (
        <sprite key={marker.id} position={marker.position} scale={[5, 5, 5]}>
          <spriteMaterial
            color={marker.color}
            transparent
            opacity={0.6}
            side={DoubleSide}
            depthWrite={false}
            depthTest={false}
          />
        </sprite>
      ))}
    </>
  );
};

export default WarHighlights;

