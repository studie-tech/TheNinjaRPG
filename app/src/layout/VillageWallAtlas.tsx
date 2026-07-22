"use client";

import { useEffect, useRef } from "react";
import { Group, OrthographicCamera } from "three";
import {
  getVillageWallSpriteSpec,
  STONE_VILLAGE_WALL_KIT,
} from "@/libs/sector-map/village-wall-assets";
import type {
  VillageWallAxis,
  VillageWallEdgeKind,
} from "@/libs/sector-map/village-walls";
import {
  createVillageWallPanelSprite,
  createVillageWallSprite,
} from "@/libs/threejs/sector";
import { disposeGroupPreservingShared, setupScene } from "@/libs/threejs/util";

const states = Array.from({ length: 27 }, (_, index) => {
  let value = index;
  const ports = Array.from({ length: 3 }, () => {
    const state = value % 3;
    value = Math.floor(value / 3);
    return state as 0 | 1 | 2;
  });
  return { label: ports.map((state) => ["–", "W", "G"][state]).join(""), ports };
});

const arms: { axis: VillageWallAxis; endX: number; endY: number }[] = [
  { axis: "horizontal", endX: -1, endY: 0 },
  // Camera Y is inverted on screen: negative world Y slopes down-right.
  { axis: "diagonalDown", endX: 0.5, endY: -0.5 },
  { axis: "diagonalUp", endX: 0.5, endY: 0.5 },
];

/** Exhaustive three-port wall/gate junction atlas rendered by the real sprite path. */
const VillageWallAtlas = () => {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const width = Math.max(320, mount.getBoundingClientRect().width);
    const columns = width < 640 ? 3 : 9;
    const rows = Math.ceil(states.length / columns);
    const cellWidth = width / columns;
    const cellHeight = cellWidth * 0.9;
    const height = rows * cellHeight;
    const { scene, renderer } = setupScene({
      mountRef,
      width,
      height,
      sortObjects: false,
      color: 0x2563a6,
      colorAlpha: 1,
      width2height: height / width,
    });
    if (!renderer) return;
    mount.appendChild(renderer.domElement);
    const camera = new OrthographicCamera(0, width, height, 0, -10, 10);
    const group = new Group();
    states.forEach((state, stateIndex) => {
      const column = stateIndex % columns;
      const row = Math.floor(stateIndex / columns);
      const origin = {
        x: (column + 0.5) * cellWidth,
        y: (row + 0.55) * cellHeight,
      };
      const hexHeight = cellWidth * 0.34;
      state.ports.forEach((port, portIndex) => {
        if (port === 0) return;
        const arm = arms[portIndex];
        if (!arm) return;
        const kind: VillageWallEdgeKind = port === 2 ? "gate" : "wall";
        const spec = getVillageWallSpriteSpec(STONE_VILLAGE_WALL_KIT, kind, arm.axis);
        const sprite = createVillageWallPanelSprite(
          spec,
          origin,
          {
            x: origin.x + arm.endX * hexHeight,
            y: origin.y + arm.endY * hexHeight,
          },
          hexHeight,
        );
        group.add(sprite);
      });
      if (state.ports.some((port) => port !== 0)) {
        group.add(
          createVillageWallSprite(
            STONE_VILLAGE_WALL_KIT.pier,
            origin,
            hexHeight,
            "village_wall_pier",
          ),
        );
      }
    });
    scene.add(group);
    let animationFrame = 0;
    const render = () => {
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(render);
    };
    render();
    return () => {
      cancelAnimationFrame(animationFrame);
      disposeGroupPreservingShared(group);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div className="space-y-2">
      <div ref={mountRef} className="w-full overflow-hidden rounded-md" />
      <div className="grid grid-cols-3 gap-1 font-mono text-[10px] text-muted-foreground sm:grid-cols-9">
        {states.map((state, index) => (
          <div key={`${index}-${state.label}`} className="text-center">
            {index.toString().padStart(2, "0")} {state.label}
          </div>
        ))}
      </div>
    </div>
  );
};

export default VillageWallAtlas;
