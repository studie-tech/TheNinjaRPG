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
    const candidate =
      candidates.length > 0 ? candidates[randInt(candidates.length, rng)] : undefined;
    // Fall back to cfg.sector only if it is itself placeable; otherwise roll a placeable
    // sector so an all-reserved list can never resolve to an invalid NPC position.
    sector =
      candidates.length > 0
        ? (candidate ?? cfg.sector)
        : isPlaceableSector(cfg.sector)
          ? cfg.sector
          : pickPlaceableSector(rng);
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
 * Decides whether to auto-open the arrival prompt for an overworld NPC and for which one.
 * Fresh-arrival semantics, keyed on `npcPlacementId`:
 *  - NPC on the player's tile that is not the last-prompted one → prompt it (and arm its id).
 *  - The already-prompted NPC is still under the player → no prompt (no nag while standing).
 *  - No NPC on the player's tile → re-arm (clear), so returning later prompts again.
 * Deterministic `find` means two NPCs sharing a tile never double-prompt: the first match wins
 * and stays armed while it remains.
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
 * Companion to `arrivalPromptDecision`: an already-open arrival prompt is stale once it no longer
 * describes reality — its NPC left the sector data, or it and the player no longer share a tile
 * (either of them moved). Checked against the NPC's live row, not the captured prompt, so an NPC
 * that walks away closes it too. `arrivalPromptDecision` cannot answer this: it reports `prompt:
 * null` both when no NPC is here AND when the NPC here is already armed, so its result alone cannot
 * distinguish "walked off" from "still standing here, already prompted".
 */
export const isArrivalPromptStale = (args: {
  promptedPlacementId: string | null;
  npcs: { npcPlacementId?: string | null; longitude: number; latitude: number }[];
  playerLongitude: number | undefined;
  playerLatitude: number | undefined;
}): boolean => {
  if (!args.promptedPlacementId) return false;
  const live = args.npcs.find((n) => n.npcPlacementId === args.promptedPlacementId);
  // Despawn is decided without the player's position, so an unknown position (a transient
  // undefined `userData`) still closes a prompt whose NPC is gone, as the despawn check did
  // before it was folded in here. An unknown position only suspends the tile comparison.
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
   * `false` = bound to this placement but not yet reachable, so not actionable. Callers set it for
   * two reasons: the `consecutiveObjectives` tracker chain (an objective not yet reached via
   * `selectedNextObjectiveId`) and — for non-consecutive quests — the bound-objective ordering gate
   * (an earlier placement-bound objective on the same quest is still incomplete). Absent/`true` =
   * actionable; fresh quests with no tracker are treated as available.
   */
  available?: boolean;
};

/** Objective tasks whose behavior is defined for an overworld placement binding. */
export const OVERWORLD_BOUND_OBJECTIVE_TASKS = [
  "defeat_opponents",
  "deliver_item",
  "dialog",
] as const;

/** Returns whether a quest objective type can be bound to an overworld AI placement. */
export const isSupportedOverworldBindingTask = (task: string): boolean =>
  (OVERWORLD_BOUND_OBJECTIVE_TASKS as readonly string[]).includes(task);

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
 * Generic over the caller's objective shape so a projection that carries extra fields (e.g. the
 * un-projected `source` objective) gets them back on the match, instead of every caller re-scanning
 * `getUserQuests` to recover what the projection dropped.
 *
 * `ignoreItemOwnership` skips the `deliver_item` possession check. The server passes the player's
 * full inventory to decide real actionability; the client (which holds only equipped items, so it
 * cannot confirm possession) sets this to *predict* the interaction for CTA copy — treating a
 * reachable delivery as actionable so the prompt reads "Deliver" instead of the generic mission
 * text. The server re-checks possession authoritatively on click.
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
      // Consecutive-ordering gate: an objective bound to this tile but not yet reachable in the
      // quest's objective chain is not actionable. Without this, a player who walks straight to a
      // later objective's placement would trigger its dialog / delivery / PvE battle out of
      // sequence — getNewTrackers refuses to credit it, so they'd fight (and risk HP) for nothing.
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
 * Objective-order reachability for placement-bound objectives: objective `index` is actionable only
 * once every EARLIER placement-bound objective on the same quest is done. Non-bound objectives never
 * gate. This helper does not read `consecutiveObjectives`; callers apply it only to non-consecutive
 * quests (consecutive quests already order via the tracker chain). Without it a non-consecutive quest
 * that binds several objectives to different NPCs would let a later objective's dialog / battle /
 * delivery fire before an earlier bound objective completed — getNewTrackers refuses to credit it,
 * so the player would act (and risk HP) for nothing.
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
 * CTA copy for the overworld arrival modal. The server's `interactWithOverworldAi` dispatches on
 * the NPC's actionable bound objective before falling back to a mission grant, so the prompt must
 * match what the click will actually do: fight a defeat target, talk through a dialog objective,
 * hand over a delivery, or (no bound objective) request a mission. `boundTask` is the task of the
 * actionable bound objective for this NPC's placement (from {@link findActionableBoundObjective}),
 * or null when none applies. HOSTILE NPCs always attack.
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
    // A placement is exactly one NPC on one tile: startOverworldBattle spawns a single target
    // (that placement's AI) and defeat_opponents completes on the first matching kill, not on a
    // wave count. So the count is fixed at 1 here rather than carried over from any prior
    // opponentAIs edit — a higher stored `number` would be dead metadata that contradicts the
    // one-NPC fight the placement actually starts. Multi-wave doesn't fit the placement model.
    return { ...o, opponentAIs: [{ ids: [ai], number: 1 }] };
  });
  return { objectives: next, missing };
};

/**
 * Decision for the single "active NPC mission" slot (`activeNpcQuestId`). The slot — not the
 * quest type — is authoritative: "block" while it points to a still-active quest,
 * "clear-stale" when it points to a completed/absent quest (release it so a new grant can
 * claim it), and "free" when no slot is held.
 */
export const npcMissionSlotDecision = (
  activeNpcQuestId: string | null | undefined,
  activeQuests: { questId: string; endAt?: Date | string | null }[],
): "free" | "block" | "clear-stale" => {
  if (!activeNpcQuestId) return "free";
  const stillActive = activeQuests.some(
    (q) => q.questId === activeNpcQuestId && !q.endAt,
  );
  return stillActive ? "block" : "clear-stale";
};

/** Placements to offer for an objective's overworld binding: when one or more opponent
 *  AIs are selected, only placements whose AI is among them; otherwise all placements. */
export const filterPlacementsByAi = <T extends { aiTemplateUserId: string }>(
  placements: T[],
  selectedAiIds: string[],
): T[] =>
  selectedAiIds.length === 0
    ? placements
    : placements.filter((p) => selectedAiIds.includes(p.aiTemplateUserId));

/** Objective tasks completed by interacting with a friendly overworld NPC. */
export const FRIENDLY_INTERACTION_TASKS = ["deliver_item", "dialog"] as const;

/**
 * Validates that every deliver_item/dialog objective binds to an EXISTING FRIENDLY overworld
 * placement. The editor scopes its placement dropdown to FRIENDLY, but the save path must
 * enforce it too so a dangling or HOSTILE binding (which the player could never resolve)
 * cannot be persisted. defeat_opponents bindings are validated separately via opponent derivation.
 */
export const validateFriendlyPlacementBindings = (
  objectives: { task: string; overworldPlacementId?: string }[],
  placementById: Map<string, { interactionType: string }>,
): { check: boolean; message: string } => {
  for (const o of objectives) {
    if (
      !(FRIENDLY_INTERACTION_TASKS as readonly string[]).includes(o.task) ||
      !o.overworldPlacementId
    ) {
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
      (FRIENDLY_INTERACTION_TASKS as readonly string[]).includes(o.task) &&
      o.overworldPlacementId === placementId,
  );

/** Placements to offer for an objective's overworld binding, scoped by task:
 *  friendly-interaction tasks (deliver_item/dialog) → only FRIENDLY placements;
 *  otherwise narrow by the selected opponent AI(s) via filterPlacementsByAi. */
export const placementsForObjective = <
  T extends { aiTemplateUserId: string; interactionType: string },
>(
  placements: T[],
  args: { task: string; selectedAiIds: string[] },
): T[] =>
  !isSupportedOverworldBindingTask(args.task)
    ? []
    : (FRIENDLY_INTERACTION_TASKS as readonly string[]).includes(args.task)
      ? placements.filter((p) => p.interactionType === "FRIENDLY")
      : filterPlacementsByAi(placements, args.selectedAiIds);
