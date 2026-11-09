import alea from "alea";
import type {
  OverworldInteractionType,
  OverworldLocationType,
  OverworldSectorType,
} from "@/drizzle/constants";
import {
  MAP_TOTAL_SECTORS,
  MAP_WAKE_ISLAND_SECTOR,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
  OVERWORLD_MAX_GROUPS_PER_SECTOR,
  SECTOR_HEIGHT,
  SECTOR_WIDTH,
} from "@/drizzle/constants";
import { oddQHexDistance } from "@/libs/hexgrid";
import {
  snapToWanderTile,
  type WanderTile,
  wanderGroupSize,
  wanderPose,
  wanderPoseTile,
  wanderSeed,
  wanderSpots,
} from "@/libs/overworldWander";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import { findNearestWalkableCoordinate } from "@/libs/sector-map/validation";
import type { SectorUser } from "@/libs/sector-map/world-types";
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

/**
 * Selects a random sector outside the reserved Wake Island / War-Torn Battleground sectors,
 * deterministically rolling forward past a reserved hit. Shared by overworld placements and
 * quest objectives with a random sector.
 */
export const pickPlaceableSector = (rng: () => number = Math.random): number => {
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
 * Sectors a random placement may land in. An empty pool means every placeable sector; a habitat
 * filter narrows it to the matching globe regions.
 */
export type OverworldSectorPool = readonly number[];

/**
 * Resolves a placement configuration into concrete sector and tile coordinates.
 * Invalid or reserved configured sectors fall back to a randomly selected placeable sector.
 */
export const resolveOverworldPosition = (
  cfg: OverworldPositionConfig,
  rng: () => number = Math.random,
  pool: OverworldSectorPool = [],
): { sector: number; longitude: number; latitude: number } => {
  let sector = cfg.sector;
  // A biome placement stores one sample spot from its pool; its groups come from each sector.
  if (cfg.sectorType === "random" || cfg.sectorType === "biome") {
    sector = pool.length
      ? (pool[randInt(pool.length, rng)] as number)
      : pickPlaceableSector(rng);
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

export type OverworldCopySource = OverworldPositionConfig & {
  id: string;
  positionVersion: number;
  spawnCount: number;
  groupMin: number;
  groupMax: number;
  wildOnly: boolean;
};

/** Seeded positions of later copies, keyed by everything that decides them. */
const copyPositionCache = new Map<
  string,
  { sector: number; longitude: number; latitude: number }[]
>();

/**
 * Unsnapped position of every copy. Copy 0 is the stored tile, which the daily reroll moves;
 * later copies roll from a seed that changes with that reroll, so they move on the same day.
 */
export const placementCopyPositions = (
  placement: OverworldCopySource,
  pool: OverworldSectorPool = [],
) => {
  const key = [
    placement.id,
    placement.positionVersion,
    placement.spawnCount,
    placement.sectorType,
    placement.locationType,
    placement.sector,
    placement.longitude,
    placement.latitude,
    placement.sectorList.join("."),
    pool.length,
    pool[0],
  ].join(":");
  let positions = copyPositionCache.get(key);
  if (!positions) {
    positions = Array.from({ length: Math.max(1, placement.spawnCount) }, (_, copy) =>
      copy === 0
        ? {
            sector: placement.sector,
            longitude: placement.longitude,
            latitude: placement.latitude,
          }
        : resolveOverworldPosition(
            placement,
            alea(wanderSeed(placement.id, placement.positionVersion, copy)),
            pool,
          ),
    );
    if (copyPositionCache.size > 256) copyPositionCache.clear();
    copyPositionCache.set(key, positions);
  }
  return positions;
};

export type OverworldCopy = {
  copy: number;
  sector: number;
  anchor: WanderTile;
  seed: string;
  groupSize: number;
};

/**
 * Copies standing in `sector`, anchored on tiles they can roam from. Copy 0 keeps its stored
 * tile exactly unless it must stay wild, since staff may have placed it on a doorstep on purpose.
 */
export const placementCopiesInSector = (
  placement: OverworldCopySource,
  sector: number,
  map: NormalizedSectorMap,
  pool: OverworldSectorPool = [],
): OverworldCopy[] => {
  if (placement.sectorType === "biome")
    return biomeCopiesInSector(placement, sector, map, pool);
  return placementCopyPositions(placement, pool).flatMap((position, copy) => {
    if (position.sector !== sector) return [];
    // Wildlife copies always land in the wild, including a seeded first copy. The stored copy
    // stays on its tile when the sector has no land to roam, so a bound quest can still reach it.
    const stored = { x: position.longitude, y: position.latitude };
    const anchor =
      copy === 0 && !placement.wildOnly
        ? stored
        : (snapToWanderTile(map, stored, placement.wildOnly) ??
          (copy === 0 ? stored : null));
    if (!anchor) return [];
    const seed = wanderSeed(placement.id, placement.positionVersion, copy);
    return [
      {
        copy,
        sector,
        anchor,
        seed,
        groupSize: wanderGroupSize(seed, placement.groupMin, placement.groupMax),
      },
    ];
  });
};

/**
 * A biome placement's groups in one sector, rolled from the sector itself so every sector of
 * the habitat is populated and no request enumerates the world. Copy numbers stay unique per
 * placement: `sector * OVERWORLD_MAX_GROUPS_PER_SECTOR + slot`.
 */
const biomeCopiesInSector = (
  placement: OverworldCopySource,
  sector: number,
  map: NormalizedSectorMap,
  pool: OverworldSectorPool,
): OverworldCopy[] => {
  const inBiome = pool.length ? poolSet(pool).has(sector) : isPlaceableSector(sector);
  if (!inBiome) return [];
  const slots = Math.min(placement.spawnCount, OVERWORLD_MAX_GROUPS_PER_SECTOR);
  return Array.from({ length: slots }).flatMap((_, slot) => {
    const copy = sector * OVERWORLD_MAX_GROUPS_PER_SECTOR + slot;
    const seed = wanderSeed(placement.id, placement.positionVersion, copy);
    const rng = alea(seed);
    const anchor = snapToWanderTile(
      map,
      { x: randInt(SECTOR_WIDTH, rng), y: randInt(SECTOR_HEIGHT, rng) },
      placement.wildOnly,
    );
    if (!anchor) return [];
    return [
      {
        copy,
        sector,
        anchor,
        seed,
        groupSize: wanderGroupSize(seed, placement.groupMin, placement.groupMax),
      },
    ];
  });
};

/** Whether a placement shows more than its stored copy. */
export const isMultiCopyPlacement = (placement: {
  sectorType: OverworldSectorType;
  spawnCount: number;
}) => placement.sectorType === "biome" || placement.spawnCount > 1;

const poolSets = new WeakMap<OverworldSectorPool, Set<number>>();
const poolSet = (pool: OverworldSectorPool) => {
  let set = poolSets.get(pool);
  if (!set) {
    set = new Set(pool);
    poolSets.set(pool, set);
  }
  return set;
};

/**
 * Whether a player on `player` can reach a copy at `timeMs`. A still NPC must share the player's
 * tile; a roaming group is in reach from any tile next to a member's current or next spot, which
 * absorbs the delay between a tap and the request.
 */
export const isOverworldCopyInReach = (args: {
  placement: OverworldCopySource & { wanderRadius: number };
  copy: number;
  map: NormalizedSectorMap;
  pool?: OverworldSectorPool;
  player: { sector: number; longitude: number; latitude: number };
  timeMs: number;
}): boolean => {
  const { placement, map, player } = args;
  const entry = placementCopiesInSector(placement, player.sector, map, args.pool).find(
    (candidate) => candidate.copy === args.copy,
  );
  if (!entry) return false;
  const near = (tile: WanderTile | null, reach: number) =>
    !!tile &&
    oddQHexDistance(tile.x, tile.y, player.longitude, player.latitude) <= reach;
  if (placement.wanderRadius < 1) return near(entry.anchor, 0);
  const config = {
    seed: entry.seed,
    anchor: entry.anchor,
    radius: placement.wanderRadius,
    spots: wanderSpots(map, entry.anchor, placement.wanderRadius, placement.wildOnly),
  };
  for (let member = 0; member < entry.groupSize; member++) {
    const pose = wanderPose(config, member, args.timeMs);
    if ([pose.from, pose.to, pose.via, wanderPoseTile(pose)].some((t) => near(t, 1)))
      return true;
  }
  return false;
};

type PlacementForRender = {
  id: string;
  aiTemplateUserId: string;
  interactionType: OverworldInteractionType;
  sector: number;
  longitude: number;
  latitude: number;
  positionVersion: number;
  wanderRadius: number;
  wildOnly: boolean;
  mapScale?: number;
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
  sheets?: SectorUser["npcSheets"];
};

/**
 * Adapts an overworld placement copy and AI template to the shared sector-user model. Each member
 * of a group is its own entry; a roaming one carries its anchor and wander seed.
 */
export const placementToSectorUser = (
  placement: PlacementForRender,
  template: TemplateForRender,
  copy?: OverworldCopy,
  member = 0,
): SectorUser => ({
  userId: template.userId,
  username: template.username,
  curHealth: template.curHealth,
  maxHealth: template.maxHealth,
  avatar: template.avatar,
  avatarLight: template.avatarLight,
  sector: copy?.sector ?? placement.sector,
  longitude: copy?.anchor.x ?? placement.longitude,
  latitude: copy?.anchor.y ?? placement.latitude,
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
  ...(placement.mapScale && placement.mapScale !== 100
    ? { npcScale: placement.mapScale / 100 }
    : {}),
  npcCopy: copy?.copy ?? 0,
  npcMember: member,
  ...(placement.wanderRadius > 0
    ? {
        npcWander: {
          seed: copy?.seed ?? wanderSeed(placement.id, placement.positionVersion, 0),
          anchor: copy?.anchor ?? { x: placement.longitude, y: placement.latitude },
          radius: placement.wanderRadius,
          wildOnly: placement.wildOnly,
        },
      }
    : {}),
  ...(template.sheets?.idle || template.sheets?.move
    ? { npcSheets: template.sheets }
    : {}),
});

/** One copy of a placement; members of a group share it. */
export const npcCopyKey = (npc: {
  npcPlacementId?: string | null;
  npcCopy?: number;
}) => (npc.npcPlacementId ? `${npc.npcPlacementId}:${npc.npcCopy ?? 0}` : null);

/**
 * NPCs with their current tile: a roaming one reports where its wander timeline has it at
 * `timeMs` rather than its anchor. `spots` caches each anchor's reachable tiles.
 */
export const liveNpcTiles = <T extends SectorUser>(
  npcs: readonly T[],
  map: NormalizedSectorMap | undefined,
  timeMs: number,
  spots: Map<string, WanderTile[]>,
): T[] =>
  npcs.map((npc) => {
    const wander = npc.npcWander;
    if (!wander || !map) return npc;
    const key = `${wander.seed}:${wander.radius}:${wander.wildOnly}`;
    let reachable = spots.get(key);
    if (!reachable) {
      reachable = wanderSpots(map, wander.anchor, wander.radius, wander.wildOnly);
      spots.set(key, reachable);
    }
    const tile = wanderPoseTile(
      wanderPose({ ...wander, spots: reachable }, npc.npcMember ?? 0, timeMs),
    );
    return tile.x === npc.longitude && tile.y === npc.latitude
      ? npc
      : { ...npc, longitude: tile.x, latitude: tile.y };
  });

/** Tiles from which a player can address an NPC: its own, or a neighbour while it roams. */
export const npcReach = (npc: { npcWander?: unknown }) => (npc.npcWander ? 1 : 0);

/**
 * Selects the first NPC under the player that has not already prompted. Finding no NPC clears the
 * remembered placement so returning to the tile can prompt again.
 */
export const arrivalPromptDecision = <
  T extends {
    npcPlacementId?: string | null;
    npcCopy?: number;
    longitude: number;
    latitude: number;
  },
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
  const key = npcHere ? npcCopyKey(npcHere) : null;
  if (!npcHere || !key) {
    return { prompt: null, lastPromptedPlacementId: null };
  }
  if (key === args.lastPromptedPlacementId) {
    return { prompt: null, lastPromptedPlacementId: args.lastPromptedPlacementId };
  }
  return { prompt: npcHere, lastPromptedPlacementId: key };
};

/**
 * Returns whether an open arrival prompt no longer matches the live NPC and player positions.
 * Unknown player coordinates suspend only the tile comparison; a despawn still closes the prompt.
 */
export const isArrivalPromptStale = (args: {
  /** Copy key from {@link npcCopyKey}. */
  promptedPlacementId: string | null;
  npcs: {
    npcPlacementId?: string | null;
    npcCopy?: number;
    npcWander?: unknown;
    longitude: number;
    latitude: number;
  }[];
  playerLongitude: number | undefined;
  playerLatitude: number | undefined;
}): boolean => {
  if (!args.promptedPlacementId) return false;
  const members = args.npcs.filter((n) => npcCopyKey(n) === args.promptedPlacementId);
  if (members.length === 0) return true;
  const { playerLongitude, playerLatitude } = args;
  if (playerLongitude === undefined || playerLatitude === undefined) return false;
  // A roaming group stays addressable while any member is next to the player.
  return !members.some(
    (n) =>
      oddQHexDistance(n.longitude, n.latitude, playerLongitude, playerLatitude) <=
      npcReach(n),
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
    : // Ambient placements are scenery and cannot carry an objective.
      placementsForInteractiveObjective(
        placements.filter((p) => p.interactionType !== "AMBIENT"),
        args,
      );

const placementsForInteractiveObjective = <
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
