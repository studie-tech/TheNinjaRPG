"use client";

import { useMemo } from "react";
import { Line } from "@react-three/drei";
import { Vector3 } from "three";
import { createTexture } from "@/libs/threejs/util";
import type { Village } from "@/drizzle/schema";
import type { GlobalPoint } from "@/libs/travel/types";

interface VillageLabelProps {
  village: Village;
  sector: GlobalPoint;
}

/**
 * Village Label component for Map
 * Creates a label with line pointing to village location on globe
 */
export const VillageLabel: React.FC<VillageLabelProps> = ({ village, sector }) => {
  // Create canvas texture for label
  const labelTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    const [w, h, r, f] = [100, 40, 4, 42 - village.name.length * 2];
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext("2d");

    if (context) {
      context.globalAlpha = 0.9;
      context.fillStyle = village.hexColor;
      context.lineWidth = 4;
      context.strokeStyle = "black";
      if (context.roundRect) {
        context.roundRect(r / 2, r / 2, w - r, h - r, r);
      } else {
        context.rect(r / 2, r / 2, w - r, h - r);
      }
      context.stroke();
      context.fill();
      context.globalAlpha = 1.0;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = "black";
      context.strokeStyle = "#F0F0F0";
      context.font = `${f}px arial narrow`;
      context.strokeText(village.mapName || village.name, w / 2, h / 2);
      context.fillText(village.mapName || village.name, w / 2, h / 2);
    }

    return createTexture(canvas);
  }, [village]);

  // Line connecting to surface
  const linePoints: [number, number, number][] = [
    [sector.x / 3, sector.y / 3, sector.z / 3],
    [sector.x / 2.5, sector.y / 2.5, sector.z / 2.5],
  ];

  return (
    <group>
      {/* Connecting line */}
      <Line points={linePoints} color="#000000" lineWidth={1} />

      {/* Label sprite */}
      <sprite
        position={[sector.x / 2.5, sector.y / 2.5, sector.z / 2.5]}
        scale={[100 / 40, 40 / 40, 1]}
      >
        <spriteMaterial map={labelTexture} />
      </sprite>
    </group>
  );
};

export default VillageLabel;

