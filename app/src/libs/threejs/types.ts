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
  n?: number[]; // quad neighbors [north, east, south, west] sector ids
  ne?: number[]; // entry edge on each neighbor [N,E,S,W]: which edge (0..3) the
  // crossing enters through. Within a cube face this is (k+2)%4 (aligned grid);
  // across the 12 cube-edge seams it encodes the 90/270 rotation.
}

export interface SectorPoint {
  x: number;
  y: number;
}

export interface GlobalMapData {
  radius: number;
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
