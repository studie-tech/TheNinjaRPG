import type {
  AllianceState,
  OverworldInteractionType,
  UserRank,
  UserStatus,
} from "@/drizzle/constants";
import type { CharacterAnimation } from "@/libs/spriteAnimations";
import type { VillageDutyPatrol } from "@/libs/villageDuty";

type NonEmptyArray<T> = T[] & { 0: T };

export interface GlobalPoint {
  x: number;
  y: number;
  z: number;
}

export interface GlobalTile {
  /**
   * Boundary corners. The generator writes their coordinates with toFixed(3), so
   * hexasphere.json holds them as numeric strings despite this type; readers must
   * coerce them to numbers.
   */
  b: NonEmptyArray<GlobalPoint>;
  c: GlobalPoint; // centerPoint
  t: number; // 0=ocean, 1=land, 2=desert
  /** Row-major sub-sector terrain samples used only for smooth global rendering. */
  v?: number[];
  /** Row-major packed RGB colors at sub-sector grid vertices. */
  vc: number[];
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
  projection: "cylindrical";
  generation?: string;
  visualScale: number;
  polarCapColumns: number;
  polarCapRows: number;
  polarCapColors: {
    north: number[];
    south: number[];
  };
  landThreshold?: number;
  protectedLandSectors?: number[];
  columns: number;
  rows: number;
  latitudeLimit: number;
  tiles: NonEmptyArray<GlobalTile>;
}

export interface SectorUser {
  /** Viewer-safe resolved art; the sector router substitutes uniforms for masked identities. */
  spriteAppearance?: import("@/validators/lpc").SpriteAppearance;
  /** Full-body art drawn in place of the layered character, at twice an NPC's height. */
  bodyArt?: string;
  /** Idle sheet looped in place of `bodyArt`'s still image. */
  bodyIdle?: CharacterAnimation;
  /** Walking sheet played in place of `bodyIdle` while the user moves. */
  bodyMove?: CharacterAnimation;
  /** A village-duty copy has its own map identity and cannot be attacked or healed as a player. */
  isVillageDuty?: boolean;
  /** Owner ID for profile links, present only when the protector is unmasked. */
  villageDutyUserId?: string;
  userId: string;
  username: string;
  /** Viewer-specific anonymity from the authenticated sector snapshot. */
  isMasked?: boolean;
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
  /** Viewer-specific war side from the authenticated sector snapshot; null when it found none. */
  warRelationship?: "ALLY" | "ENEMY" | null;
  status: UserStatus;
  battleId: string | null;
  /** Whether this rendered sector entity is a staff-configured overworld NPC. */
  isNpc?: boolean;
  /** Stable placement identity used for NPC rendering and interaction requests. */
  npcPlacementId?: string;
  /** Determines whether the NPC exposes a talk or attack interaction. */
  npcInteractionType?: OverworldInteractionType;
  /** Optimistic concurrency version for interactions with a moving NPC placement. */
  npcPositionVersion?: number;
  /** Which copy of the placement this is, and which member of its group. */
  npcCopy?: number;
  npcMember?: number;
  /** Present while the NPC roams; `longitude`/`latitude` then hold its anchor tile. */
  npcWander?: {
    seed: string;
    anchor: { x: number; y: number };
    radius: number;
    wildOnly: boolean;
    /** Restrict generated patrol destinations to village-zoned tiles. */
    villageOnly?: boolean;
    /** Shared server pursuit; scenes interpolate it without per-frame requests. */
    pursuit?: NonNullable<VillageDutyPatrol["pursuit"]>;
  };
  /** Drawn height relative to the default NPC height. */
  npcScale?: number;
  /** Walk and idle sheets that replace the NPC's still artwork on the map. */
  npcSheets?: { idle?: CharacterAnimation; move?: CharacterAnimation };
}
