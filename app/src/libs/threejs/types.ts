import type { AllianceState, UserRank, UserStatus } from "@/drizzle/constants";

type NonEmptyArray<T> = T[] & { 0: T };

export interface GlobalPoint {
  x: number;
  y: number;
  z: number;
}

export interface GlobalTile {
  b: NonEmptyArray<GlobalPoint>; // boundary
  c: GlobalPoint; // centerPoint
  t: number; // 0=ocean, 1=land, 2=desert
  /** Row-major sub-sector terrain samples used only for smooth global rendering. */
  v?: number[];
  /** Row-major packed RGB colors at sub-sector grid vertices. */
  vc?: number[];
  n?: number[]; // neighbors [north, east, south, west]; -1 at a polar boundary
  ne?: number[]; // entry edge on each neighbor; always the opposite edge for a
  // real cylindrical-grid neighbor, and -1 where the polar cap blocks travel
}

export interface SectorPoint {
  x: number;
  y: number;
}

export interface GlobalMapData {
  radius: number;
  projection?: "cylindrical";
  generation?: string;
  visualScale?: number;
  polarCapColumns?: number;
  polarCapRows?: number;
  polarCapColors?: {
    north: number[];
    south: number[];
  };
  landThreshold?: number;
  protectedLandSectors?: number[];
  columns?: number;
  rows?: number;
  latitudeLimit?: number;
  tiles: NonEmptyArray<GlobalTile>;
}

export interface SectorUser {
  userId: string;
  username: string;
  curHealth: number;
  maxHealth: number;
  avatar: string | null;
  avatarLight: string | null;
  sector: number;
  longitude: number;
  latitude: number;
  location: string | null;
  villageId: string | null;
  level: number;
  /** May be absent on partial live map updates until sector data reloads */
  experience?: number;
  rank: UserRank;
  isOutlaw: boolean;
  isBanned: boolean;
  immunityUntil: Date;
  robImmunityUntil: Date;
  updatedAt: Date;
  allianceStatus: AllianceState;
  status: UserStatus;
  battleId: string | null;
}
