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
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import { findNearestWalkableCoordinate } from "@/libs/sector-map/validation";
import type { SectorUser } from "@/libs/threejs/types";
import { isInArray } from "@/utils/array";

const RESERVED_SECTORS = new Set<number>([
  MAP_WAKE_ISLAND_SECTOR,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
]);

/** Returns whether a sector can host an overworld AI placement. */
export const isPlaceableSector = (sector: number): boolean =>
  sector >= 0 && sector < MAP_TOTAL_SECTORS && !RESERVED_SECTORS.has(sector);

/** Converts an RNG sample into an integer in `[0, maxExclusive)`. */
const randInt = (maxExclusive: number, rng: () => number) =>
  Math.min(maxExclusive - 1, Math.floor(rng() * maxExclusive));

/** Selects a valid placement sector while deterministically skipping reserved sectors. */
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

/**
 * Resolves a placement configuration into concrete sector and tile coordinates.
 * Invalid or reserved configured sectors fall back to a randomly selected placeable sector.
 */
export const resolveOverworldPosition = (
  cfg: OverworldPositionConfig,
  rng: () => number = Math.random,
): { sector: number; longitude: number; latitude: number } => {
  let sector = cfg.sector;
  if (cfg.sectorType === "random") {
    sector = pickPlaceableSector(rng);
  } else if (cfg.sectorType === "from_list") {
    const candidates = cfg.sectorList.filter(isPlaceableSector);
    if (candidates.length > 0) {
      sector = candidates[randInt(candidates.length, rng)] as number;
    } else {
      // An all-reserved list falls back to a valid configured sector or a fresh roll.
      sector = isPlaceableSector(cfg.sector) ? cfg.sector : pickPlaceableSector(rng);
    }
  } else {
    // "specific": honor the admin-chosen sector, but guard it the same way random/from_list
    // do so a reserved sector (Wake Island / War-Torn Battleground) can never be pinned.
    sector = isPlaceableSector(cfg.sector) ? cfg.sector : pickPlaceableSector(rng);
  }
  const longitude =
    cfg.locationType === "random" ? randInt(SECTOR_WIDTH, rng) : cfg.longitude;
  const latitude =
    cfg.locationType === "random" ? randInt(SECTOR_HEIGHT, rng) : cfg.latitude;
  return { sector, longitude, latitude };
};

/**
 * Snap a resolved placement onto the nearest walkable tile in its published sector map.
 * `fallbackAnchor=null` deliberately prefers the nearest tile over the sector spawn so random
 * placements do not pile up at spawn whenever their first roll lands on blocked terrain.
 */
export const snapOverworldPositionToWalkable = (
  position: { sector: number; longitude: number; latitude: number },
  map: NormalizedSectorMap,
): { sector: number; longitude: number; latitude: number } | null => {
  const coordinate = findNearestWalkableCoordinate(
    map,
    { x: position.longitude, y: position.latitude },
    null,
  );
  return coordinate
    ? { sector: position.sector, longitude: coordinate.x, latitude: coordinate.y }
    : null;
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

/** Adapts a persisted overworld placement and AI template to the shared sector-user model. */
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

/**
 * Selects the first NPC under the player that has not already prompted. Finding no NPC clears the
 * remembered placement so returning to the tile can prompt again.
 */
export const arrivalPromptDecision = <
  T extends { npcPlacementId?: string | null; longitude: number; latitude: number },
>(args: {
  playerLongitude: number;
  playerLatitude: number;
  npcs: T[];
  lastPromptedPlacementId: string | null;
}): { prompt: T | null; lastPromptedPlacementId: string | null } => {
  const npcHere = args.npcs.find(
    (n) =>
      !!n.npcPlacementId &&
      n.longitude === args.playerLongitude &&
      n.latitude === args.playerLatitude,
  );
  if (!npcHere?.npcPlacementId) {
    return { prompt: null, lastPromptedPlacementId: null };
  }
  if (npcHere.npcPlacementId === args.lastPromptedPlacementId) {
    return { prompt: null, lastPromptedPlacementId: args.lastPromptedPlacementId };
  }
  return { prompt: npcHere, lastPromptedPlacementId: npcHere.npcPlacementId };
};

/**
 * Returns whether an open arrival prompt no longer matches the live NPC and player positions.
 * Unknown player coordinates suspend only the tile comparison; a despawn still closes the prompt.
 */
export const isArrivalPromptStale = (args: {
  promptedPlacementId: string | null;
  npcs: { npcPlacementId?: string | null; longitude: number; latitude: number }[];
  playerLongitude: number | undefined;
  playerLatitude: number | undefined;
}): boolean => {
  if (!args.promptedPlacementId) return false;
  const live = args.npcs.find((n) => n.npcPlacementId === args.promptedPlacementId);
  if (!live) return true;
  if (args.playerLongitude === undefined || args.playerLatitude === undefined)
    return false;
  return (
    live.longitude !== args.playerLongitude || live.latitude !== args.playerLatitude
  );
};

type BoundObjective = {
  id: string;
  task: string;
  overworldPlacementId?: string;
  done?: boolean;
  deliverItemIds?: string[];
  /**
   * `false` marks an objective as unreachable in its consecutive or placement-bound order.
   * Absent or `true` is actionable, including a fresh quest with no tracker.
   */
  available?: boolean;
};

/** Objective tasks whose behavior is defined for an overworld placement binding. */
const OVERWORLD_BOUND_OBJECTIVE_TASKS = [
  "defeat_opponents",
  "deliver_item",
  "dialog",
] as const;

/** Returns whether a quest objective type can be bound to an overworld AI placement. */
export const isSupportedOverworldBindingTask = (task: string): boolean =>
  isInArray(task, OVERWORLD_BOUND_OBJECTIVE_TASKS);

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

/**
 * Finds the first reachable, unfinished objective bound to a placement while preserving the
 * caller's objective subtype. `ignoreItemOwnership` supports client-side delivery CTA prediction;
 * the server performs the authoritative inventory check.
 */
export const findActionableBoundObjective = <T extends BoundObjective>(args: {
  activeQuests: { questId: string; objectives: T[] }[];
  ownedItemIds: string[];
  placementId: string;
  ignoreItemOwnership?: boolean;
}): { questId: string; objective: T } | null => {
  const owned = new Set(args.ownedItemIds);
  for (const quest of args.activeQuests) {
    for (const objective of quest.objectives) {
      if (objective.done) continue;
      if (objective.overworldPlacementId !== args.placementId) continue;
      // Ignore malformed legacy content that attached the shared base field to a task with no
      // overworld interaction semantics. Save validation prevents new instances of this shape.
      if (!isSupportedOverworldBindingTask(objective.task)) continue;
      // A bound objective must also be reachable in its quest's objective chain.
      if (objective.available === false) continue;
      if (
        !args.ignoreItemOwnership &&
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

/**
 * Returns whether all earlier supported placement-bound objectives are complete. Callers use this
 * for non-consecutive quests; consecutive quests already enforce tracker-chain ordering.
 */
export const earlierBoundObjectivesComplete = (
  objectives: {
    task?: string;
    overworldPlacementId?: string | null;
    done?: boolean | null;
  }[],
  index: number,
): boolean => {
  for (let j = 0; j < index; j++) {
    const prev = objectives[j];
    if (
      prev?.overworldPlacementId &&
      (prev.task === undefined || isSupportedOverworldBindingTask(prev.task)) &&
      !prev.done
    )
      return false;
  }
  return true;
};

export interface ArrivalPromptCta {
  question: string;
  action: string;
  dismiss: string;
}

/**
 * Returns arrival-modal copy matching the actionable bound objective. With no bound objective it
 * offers a mission; hostile NPCs always offer an attack.
 */
export const resolveArrivalPromptCta = (
  npc: {
    username: string;
    npcInteractionType?: OverworldInteractionType | null;
  },
  boundTask: string | null | undefined,
): ArrivalPromptCta => {
  if (npc.npcInteractionType === "HOSTILE") {
    return { question: `Attack ${npc.username}?`, action: "Attack", dismiss: "Leave" };
  }
  switch (boundTask) {
    case "defeat_opponents":
      return {
        question: `Fight ${npc.username}?`,
        action: "Fight",
        dismiss: "Not now",
      };
    case "dialog":
      return {
        question: `Speak with ${npc.username}?`,
        action: "Talk",
        dismiss: "Not now",
      };
    case "deliver_item":
      return {
        question: `Deliver to ${npc.username}?`,
        action: "Deliver",
        dismiss: "Not now",
      };
    default:
      return {
        question: `Request a mission from ${npc.username}?`,
        action: "Request mission",
        dismiss: "Not now",
      };
  }
};

/**
 * Single source of truth for overworld defeat targets: for each `defeat_opponents`
 * objective bound to a placement, set its opponentAIs to that placement's AI. The
 * placement is authoritative, so the admin never picks the AI twice. Returns the
 * (new) objectives plus any placement ids that could not be resolved.
 */
export const deriveOverworldOpponents = <
  T extends {
    task: string;
    overworldPlacementId?: string;
    opponentAIs?: { ids: string[]; number: number }[];
  },
>(
  objectives: T[],
  aiByPlacementId: Map<string, string>,
): { objectives: T[]; missing: string[] } => {
  const missing: string[] = [];
  const next = objectives.map((o) => {
    if (o.task !== "defeat_opponents" || !o.overworldPlacementId) return o;
    const ai = aiByPlacementId.get(o.overworldPlacementId);
    if (!ai) {
      missing.push(o.overworldPlacementId);
      return o;
    }
    // One placement represents one NPC and therefore one opponent, never a multi-wave target.
    return { ...o, opponentAIs: [{ ids: [ai], number: 1 }] };
  });
  return { objectives: next, missing };
};

/** Objective tasks completed by interacting with a friendly overworld NPC. */
const FRIENDLY_INTERACTION_TASKS = ["deliver_item", "dialog"] as const;

/**
 * Validates that every delivery or dialog binding resolves to a friendly placement.
 * Defeat bindings are validated separately while deriving their opponent.
 */
export const validateFriendlyPlacementBindings = (
  objectives: { task: string; overworldPlacementId?: string }[],
  placementById: Map<string, { interactionType: string }>,
): { check: boolean; message: string } => {
  for (const o of objectives) {
    if (!isInArray(o.task, FRIENDLY_INTERACTION_TASKS) || !o.overworldPlacementId) {
      continue;
    }
    const placement = placementById.get(o.overworldPlacementId);
    if (!placement) {
      return {
        check: false,
        message: `Bound overworld placement not found: ${o.overworldPlacementId}`,
      };
    }
    if (placement.interactionType !== "FRIENDLY") {
      return {
        check: false,
        message: `deliver_item/dialog objectives must bind to a FRIENDLY overworld placement (${o.overworldPlacementId} is ${placement.interactionType})`,
      };
    }
  }
  return { check: true, message: "" };
};

/**
 * Whether any deliver_item/dialog (FRIENDLY-interaction) objective binds the given placement.
 * Such bindings can only resolve at a FRIENDLY NPC, so a placement carrying one must not be
 * flipped to HOSTILE — the inverse of {@link validateFriendlyPlacementBindings}.
 */
export const hasFriendlyBindingToPlacement = (
  objectives: { task: string; overworldPlacementId?: string }[],
  placementId: string,
): boolean =>
  objectives.some(
    (o) =>
      isInArray(o.task, FRIENDLY_INTERACTION_TASKS) &&
      o.overworldPlacementId === placementId,
  );

/**
 * Scopes placement options by objective: friendly tasks require a friendly NPC, while defeat
 * objectives optionally narrow the list to placements using the selected opponent AIs.
 */
export const placementsForObjective = <
  T extends { aiTemplateUserId: string; interactionType: string },
>(
  placements: T[],
  args: { task: string; selectedAiIds: string[] },
): T[] =>
  !isSupportedOverworldBindingTask(args.task)
    ? []
    : isInArray(args.task, FRIENDLY_INTERACTION_TASKS)
      ? placements.filter((p) => p.interactionType === "FRIENDLY")
      : args.selectedAiIds.length === 0
        ? placements
        : placements.filter((p) => args.selectedAiIds.includes(p.aiTemplateUserId));
