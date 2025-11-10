"use client";

import { useMemo } from "react";
import { DoubleSide } from "three";
import type { GlobalPoint } from "@/libs/travel/types";
import type { StructureWithRelations } from "@/drizzle/schema";

interface QuestHighlightsProps {
  structures: StructureWithRelations[];
}

/**
 * Quest Highlights for Map
 * Shows quest objectives on the globe
 */
export const QuestHighlights: React.FC<QuestHighlightsProps> = ({ structures }) => {
  const markers = useMemo(
    () =>
      structures.map((structure) => {
        const sector = structure.sector as GlobalPoint;
        return {
          id: structure.id,
          position: [sector.x / 3, sector.y / 3, sector.z / 3] as [number, number, number],
        };
      }),
    [structures]
  );

  return (
    <>
      {markers.map((marker) => (
        <sprite key={marker.id} position={marker.position} scale={[5, 5, 5]}>
          <spriteMaterial
            color="yellow"
            transparent
            opacity={0.8}
            side={DoubleSide}
            depthWrite={false}
            depthTest={false}
          />
        </sprite>
      ))}
    </>
  );
};

export default QuestHighlights;

