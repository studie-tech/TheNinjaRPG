import type {
  OverworldInteractionType,
  OverworldLocationType,
  OverworldSectorType,
} from "@/drizzle/constants";
import {
  MAP_TOTAL_SECTORS,
  MAP_WAKE_ISLAND_SECTOR,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
  SECTOR_HEIGHT,
  SECTOR_WIDTH,
} from "@/drizzle/constants";
import type { SectorUser } from "@/libs/threejs/types";

const RESERVED_SECTORS = new Set<number>([
  MAP_WAKE_ISLAND_SECTOR,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
]);

export const isPlaceableSector = (sector: number): boolean =>
  sector >= 0 && sector < MAP_TOTAL_SECTORS && !RESERVED_SECTORS.has(sector);

const randInt = (maxExclusive: number, rng: () => number) =>
  Math.min(maxExclusive - 1, Math.floor(rng() * maxExclusive));

const pickPlaceableSector = (rng: () => number): number => {
  // Bounded scan from a random start so a reserved hit deterministically rolls forward.
  let sector = randInt(MAP_TOTAL_SECTORS, rng);
  for (let i = 0; i < MAP_TOTAL_SECTORS; i++) {
    if (isPlaceableSector(sector)) return sector;
    sector = (sector + 1) % MAP_TOTAL_SECTORS;
  }
  return 0;
};

export interface OverworldPositionConfig {
  sectorType: OverworldSectorType;
  locationType: OverworldLocationType;
  sector: number;
  longitude: number;
  latitude: number;
  sectorList: number[];
}

export const resolveOverworldPosition = (
  cfg: OverworldPositionConfig,
  rng: () => number = Math.random,
): { sector: number; longitude: number; latitude: number } => {
  let sector = cfg.sector;
  if (cfg.sectorType === "random") {
    sector = pickPlaceableSector(rng);
  } else if (cfg.sectorType === "from_list") {
    const candidates = cfg.sectorList.filter(isPlaceableSector);
    // Fall back to cfg.sector only if it is itself placeable; otherwise roll a placeable
    // sector so an all-reserved list can never resolve to an invalid NPC position.
    sector =
      candidates.length > 0
        ? candidates[randInt(candidates.length, rng)]!
        : isPlaceableSector(cfg.sector)
          ? cfg.sector
          : pickPlaceableSector(rng);
  }
  const longitude =
    cfg.locationType === "random" ? randInt(SECTOR_WIDTH, rng) : cfg.longitude;
  const latitude =
    cfg.locationType === "random" ? randInt(SECTOR_HEIGHT, rng) : cfg.latitude;
  return { sector, longitude, latitude };
};

type PlacementForRender = {
  id: string;
  aiTemplateUserId: string;
  interactionType: OverworldInteractionType;
  sector: number;
  longitude: number;
  latitude: number;
  positionVersion: number;
};

type TemplateForRender = {
  userId: string;
  username: string;
  avatar: string | null;
  avatarLight: string | null;
  curHealth: number;
  maxHealth: number;
  level: number;
  rank: SectorUser["rank"];
};

export const placementToSectorUser = (
  placement: PlacementForRender,
  template: TemplateForRender,
): SectorUser => ({
  userId: template.userId,
  username: template.username,
  curHealth: template.curHealth,
  maxHealth: template.maxHealth,
  avatar: template.avatar,
  avatarLight: template.avatarLight,
  sector: placement.sector,
  longitude: placement.longitude,
  latitude: placement.latitude,
  location: null,
  villageId: null,
  level: template.level,
  rank: template.rank,
  isOutlaw: false,
  isBanned: false,
  immunityUntil: new Date(0),
  robImmunityUntil: new Date(0),
  updatedAt: new Date(),
  allianceStatus: placement.interactionType === "HOSTILE" ? "ENEMY" : "NEUTRAL",
  status: "AWAKE",
  battleId: null,
  isNpc: true,
  npcPlacementId: placement.id,
  npcInteractionType: placement.interactionType,
  npcPositionVersion: placement.positionVersion,
});

type BoundObjective = {
  id: string;
  task: string;
  overworldPlacementId?: string;
  done?: boolean;
  deliverItemIds?: string[];
};

/**
 * Absolute-chance band-walk: each quest owns a [acc, acc+chance) band on [0,100).
 * r past the summed chances → null ("nothing"). Order is the caller-provided (stable) order.
 */
export const pickWeightedQuest = (
  eligible: { questId: string; chance: number }[],
  r: number,
): string | null => {
  let acc = 0;
  for (const q of eligible) {
    acc += q.chance;
    if (r < acc) return q.questId;
  }
  return null;
};

export const findActionableBoundObjective = (args: {
  activeQuests: { questId: string; objectives: BoundObjective[] }[];
  ownedItemIds: string[];
  placementId: string;
}): { questId: string; objective: BoundObjective } | null => {
  const owned = new Set(args.ownedItemIds);
  for (const quest of args.activeQuests) {
    for (const objective of quest.objectives) {
      if (objective.done) continue;
      if (objective.overworldPlacementId !== args.placementId) continue;
      if (
        objective.task === "deliver_item" &&
        !(objective.deliverItemIds ?? []).every((id) => owned.has(id))
      ) {
        continue; // matching location/identity, but not actionable yet
      }
      return { questId: quest.questId, objective };
    }
  }
  return null;
};
