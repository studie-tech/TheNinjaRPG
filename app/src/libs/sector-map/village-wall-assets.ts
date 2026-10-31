import type { VillageWallAxis, VillageWallEdgeKind } from "./village-walls";

export interface VillageWallSpriteSpec {
  url: string;
  frame?: { x: number; y: number; width: number; height: number };
  /** Square sprite canvas size in hex-height units. */
  scale: number;
  /** Normalized vertical location of the wall's ground/contact midpoint. */
  anchorY: number;
}

export interface VillageWallPanelSpriteSpec {
  url: string;
  frame?: { x: number; y: number; width: number; height: number };
  /** Flush connection points in normalized, top-origin image coordinates. */
  connectors: readonly [{ x: number; y: number }, { x: number; y: number }];
  /** Full sprite-canvas height in hex-height units for horizontal pieces. */
  height: number;
}

export interface VillageWallKit {
  version: string;
  panels: Record<VillageWallAxis, VillageWallPanelSpriteSpec>;
  gates: Record<VillageWallAxis, VillageWallPanelSpriteSpec>;
  pier: VillageWallSpriteSpec;
  tower: VillageWallSpriteSpec;
  maxTowers: number;
}

/** Atlas contact points fit cedar-and-stone walls to the hex lattice without tilting upright posts. */
const wallPanel = (
  rectangle: readonly [number, number, number, number],
  contacts: readonly [number, number, number, number],
  height: number,
): VillageWallPanelSpriteSpec => {
  const [x, y, width, frameHeight] = rectangle;
  return {
    url: "/world-art/village-walls.webp",
    frame: { x, y, width, height: frameHeight },
    connectors: [
      { x: (contacts[0] - x) / width, y: (contacts[1] - y) / frameHeight },
      { x: (contacts[2] - x) / width, y: (contacts[3] - y) / frameHeight },
    ],
    height,
  };
};

/** Wall roles share the village roof and masonry palette, with separate traversable gate openings. */
export const STONE_VILLAGE_WALL_KIT: VillageWallKit = {
  version: "cedar-stone",
  panels: {
    horizontal: wallPanel([13, 94, 171.5, 122.5], [24, 161.5, 171.5, 205], 1.3),
    diagonalDown: wallPanel([201, 98.5, 182.5, 131.5], [210, 161, 368.5, 218.5], 1.3),
    diagonalUp: wallPanel([393, 87.5, 167, 138.5], [406, 208.5, 550.5, 157], 1.3),
  },
  gates: {
    horizontal: wallPanel([565, 70, 193.5, 172], [579, 185.5, 745.5, 229.5], 2.1),
    diagonalDown: wallPanel([15.5, 278, 191.5, 179.5], [27, 390, 192, 443.5], 2.1),
    diagonalUp: wallPanel([215.5, 282.5, 208.5, 175], [229, 443.5, 410, 389.5], 2.1),
  },
  pier: {
    url: "/world-art/village-walls.webp",
    frame: { x: 472.5, y: 329, width: 81.5, height: 113 },
    scale: 1.1,
    anchorY: 0.92,
  },
  tower: {
    url: "/world-art/village-walls.webp",
    frame: { x: 595, y: 249.5, width: 141, height: 206 },
    scale: 2.1,
    anchorY: 0.925,
  },
  maxTowers: 4,
};

/** Gate artwork follows the opening's ground-plane slope so a uniform fit needs only a small residual shear. */
export const getVillageWallSpriteSpec = (
  kit: VillageWallKit,
  kind: VillageWallEdgeKind,
  axis: VillageWallAxis,
  slope?: number,
) => {
  if (kind !== "gate") return kit.panels[axis];
  if (slope === undefined) return kit.gates[axis];
  const error = (spec: VillageWallPanelSpriteSpec) => {
    const [a, b] = spec.connectors;
    return spec.frame
      ? Math.abs(
          slope + ((b.y - a.y) * spec.frame.height) / ((b.x - a.x) * spec.frame.width),
        )
      : Infinity;
  };
  return Object.values(kit.gates).reduce(
    (closest, candidate) => (error(candidate) < error(closest) ? candidate : closest),
    kit.gates[axis],
  );
};
