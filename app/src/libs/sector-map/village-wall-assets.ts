import type { VillageWallAxis, VillageWallEdgeKind } from "./village-walls";

export interface VillageWallSpriteSpec {
  url: string;
  /** Square sprite canvas size in hex-height units. */
  scale: number;
  /** Normalized vertical location of the wall's ground/contact midpoint. */
  anchorY: number;
}

export interface VillageWallPanelSpriteSpec {
  url: string;
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

/**
 * The generator establishes the legacy-tower masonry language; reviewed
 * panels, gates and piers are then geometry-locked onto fixed 256px lossless
 * canvases so every lattice connector is exact. Semantic roles keep rendering
 * independent from mutable map-decoration keys.
 */
export const STONE_VILLAGE_WALL_KIT: VillageWallKit = {
  version: "stone-v13-seam-cap",
  panels: {
    horizontal: {
      url: "https://ui0arpl8sm.ufs.sh/f/village-wall-stone-v13-seam-cap-panel-horizontal.png",
      connectors: [
        { x: 0.078125, y: 0.6796875 },
        { x: 0.921875, y: 0.6796875 },
      ],
      height: 1.2,
    },
    diagonalDown: {
      url: "https://ui0arpl8sm.ufs.sh/f/village-wall-stone-v13-seam-cap-panel-diagonal-down.png",
      connectors: [
        { x: 0.078125, y: 0.48984375 },
        { x: 0.921875, y: 0.86953125 },
      ],
      height: 1.2,
    },
    diagonalUp: {
      url: "https://ui0arpl8sm.ufs.sh/f/village-wall-stone-v13-seam-cap-panel-diagonal-up.png",
      connectors: [
        { x: 0.078125, y: 0.86953125 },
        { x: 0.921875, y: 0.48984375 },
      ],
      height: 1.2,
    },
  },
  gates: {
    horizontal: {
      url: "https://ui0arpl8sm.ufs.sh/f/village-wall-stone-v13-seam-cap-gate-horizontal.png",
      connectors: [
        { x: 0.078125, y: 0.6796875 },
        { x: 0.921875, y: 0.6796875 },
      ],
      height: 1.2,
    },
    diagonalDown: {
      url: "https://ui0arpl8sm.ufs.sh/f/village-wall-stone-v13-seam-cap-gate-diagonal-down.png",
      connectors: [
        { x: 0.078125, y: 0.48984375 },
        { x: 0.921875, y: 0.86953125 },
      ],
      height: 1.2,
    },
    diagonalUp: {
      url: "https://ui0arpl8sm.ufs.sh/f/village-wall-stone-v13-seam-cap-gate-diagonal-up.png",
      connectors: [
        { x: 0.078125, y: 0.86953125 },
        { x: 0.921875, y: 0.48984375 },
      ],
      height: 1.2,
    },
  },
  pier: {
    url: "https://ui0arpl8sm.ufs.sh/f/village-wall-stone-v13-seam-cap-pier.png",
    scale: 1.05,
    anchorY: 0.71875,
  },
  tower: {
    url: "https://ui0arpl8sm.ufs.sh/f/village-wall-stone-v13-seam-cap-tower.png",
    scale: 1.1,
    anchorY: 0.7421875,
  },
  maxTowers: 4,
};

export const getVillageWallSpriteSpec = (
  kit: VillageWallKit,
  kind: VillageWallEdgeKind,
  axis: VillageWallAxis,
) => (kind === "gate" ? kit.gates[axis] : kit.panels[axis]);
