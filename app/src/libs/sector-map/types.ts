import type { CombatBiome } from "@/drizzle/constants";

export type SectorMapZone =
  | "wilderness"
  | "village"
  | "safezone"
  | "water"
  | "road"
  | "structure"
  | "shrine";

/** Canonical object types the importer accepts (runtime list so consumers and
 * tests derive from one source instead of copying it) */
export const SECTOR_MAP_OBJECT_TYPES = [
  "anchor",
  "decoration",
  "exit",
  "landmark",
  "shrine",
  "structure",
] as const;
export type SectorMapObjectType = (typeof SECTOR_MAP_OBJECT_TYPES)[number];

/** Anchor key string; conventionally namespaced "spawn.*", "structure.*",
 * "shrine.*", "exit.*", "quest.*" */
export type SectorMapAnchorKey = string;

export interface NormalizedSectorTile {
  x: number;
  y: number;
  /** Open terrain-registry key (built-ins or creator-defined kinds) */
  terrain: string;
  walkCost: number;
  blocked: boolean;
  zone: SectorMapZone;
  battleBiome: CombatBiome;
  assetKey?: string;
  /** Set to false to suppress procedural sprite decorations on this tile */
  decoration?: boolean;
}

export interface NormalizedSectorObject {
  id: string;
  type: SectorMapObjectType;
  x: number;
  y: number;
  route?: string;
  assetKey?: string;
  anchorKey?: SectorMapAnchorKey;
  /** TOTAL sprite height in hex-height units (from an explicit property or a
   *  Tiled resize); when absent the asset library's renderScale default applies */
  scale?: number;
  /** Horizontal offset as a fraction of tile width (decorations); derived from
   *  the Tiled pixel position so placement is WYSIWYG */
  offsetX?: number;
  /** Vertical offset as a fraction of tile height (decorations); positive is
   *  down, matching Tiled screen space */
  offsetY?: number;
}

export interface NormalizedSectorAnchor {
  key: SectorMapAnchorKey;
  x: number;
  y: number;
}

export interface NormalizedSectorExit {
  fromAnchor: SectorMapAnchorKey;
  targetSector: number;
  targetAnchor: SectorMapAnchorKey;
  travelCost?: number;
}

export interface NormalizedSectorMap {
  formatVersion: number;
  sector: number;
  name: string;
  width: number;
  height: number;
  tiles: NormalizedSectorTile[];
  objects: NormalizedSectorObject[];
  anchors: NormalizedSectorAnchor[];
  exits: NormalizedSectorExit[];
  metadata: {
    importedAt: string;
    source: "tiled";
    sourceHash?: string;
    tiledVersion?: string;
  };
}

export interface SectorCoordinate {
  x: number;
  y: number;
}
