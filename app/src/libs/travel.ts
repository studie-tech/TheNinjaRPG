import type { CombatBiome } from "@/drizzle/constants";
import {
  MAP_GLOBAL_TRAVEL_TIME_CAP_SECS,
  MAP_WAKE_ISLAND_SECTOR,
} from "@/drizzle/constants";
import { COMBAT_LOBBY_SECONDS, COMBAT_SECONDS } from "@/libs/combat/constants";
import { isQuestComplete } from "@/libs/objectives";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import {
  chebyshevDistance,
  findNearestWalkableCoordinate,
  getSectorTile,
} from "@/libs/sector-map/validation";
import type { GlobalMapData, SectorPoint } from "@/libs/sector-map/world-types";
import type { UserWithRelations } from "@/server/api/routers/profile";
import { secondsFromNow } from "@/utils/time";
import { type GlobeJourney, globeJourneySchema } from "@/validators/travel";
import type { UserCachePatch } from "@/validators/userCache";

/** Restore only the presentation metadata belonging to this account's confirmed trip. */
export const resolveGlobeJourney = (
  stored: unknown,
  user:
    | Pick<
        NonNullable<UserWithRelations>,
        "userId" | "sector" | "status" | "travelFinishAt"
      >
    | undefined,
): GlobeJourney | null => {
  if (user?.status !== "TRAVEL" || !user.travelFinishAt) return null;
  const parsed = globeJourneySchema.safeParse(stored);
  if (!parsed.success) return null;
  const journey = parsed.data;
  return journey.userId === user.userId &&
    journey.toSector === user.sector &&
    journey.fromSector !== journey.toSector &&
    journey.finishAt === user.travelFinishAt.getTime()
    ? journey
    : null;
};

/**
 * Gets the biome for a globe tile terrain type (0=ocean, 1=land, 2=desert, 3=ice)
 */
export const getBiomeFromTileType = (tileType: number): CombatBiome => {
  return tileType === 0
    ? "ocean"
    : tileType === 1
      ? "ground"
      : tileType === 2
        ? "dessert"
        : "ice";
};

/**
 * Resolve the visible biome at a named authored-map anchor. The local tile is
 * authoritative for structures standing on it; the globe's sector-center
 * biome is only a fallback for incomplete legacy maps.
 */
export const getBiomeAtSectorAnchor = (
  sectorMap: Pick<NormalizedSectorMap, "tiles" | "anchors">,
  anchorKey: string,
  globalTileType: number,
): CombatBiome => {
  const anchor = sectorMap.anchors.find((candidate) => candidate.key === anchorKey);
  const tile = anchor ? getSectorTile(sectorMap, anchor) : undefined;
  const visibleBiome =
    tile?.terrain === "ocean" ||
    tile?.terrain === "ground" ||
    tile?.terrain === "dessert" ||
    tile?.terrain === "ice" ||
    tile?.terrain === "snow"
      ? tile.terrain
      : undefined;
  return visibleBiome ?? tile?.battleBiome ?? getBiomeFromTileType(globalTileType);
};

/**
 * Walkable landing point a short walk from a point of interest, or null when the
 * sector offers none in range. Deliberately not the tile itself: arriving on top
 * of a quest target would skip the approach the objective asks for. The default
 * range is bounded by what a zoomed-in sector camera actually shows -- about
 * three tiles above and below the player -- so the target lands on screen.
 */
export const findLandingNear = (
  sectorMap: Pick<NormalizedSectorMap, "tiles">,
  target: { x: number; y: number },
  randomIndex: (upperBound: number) => number,
  minDistance = 2,
  maxDistance = 3,
) => {
  const candidates = sectorMap.tiles.filter((tile) => {
    const distance = chebyshevDistance(tile, target);
    return distance >= minDistance && distance <= maxDistance;
  });
  if (candidates.length === 0) return null;
  const tile = candidates[randomIndex(candidates.length)];
  return tile ? { x: tile.x, y: tile.y } : null;
};

/** Center global arrivals on the map, using the nearest tile when its center is absent. */
export const findGlobalTravelDestination = (
  sectorMap: Pick<NormalizedSectorMap, "width" | "height" | "tiles" | "anchors">,
) =>
  findNearestWalkableCoordinate(
    sectorMap,
    { x: Math.floor(sectorMap.width / 2), y: Math.floor(sectorMap.height / 2) },
    null,
  );

/**
 * Travel seconds between two sectors on the hexasphere: half the great-circle distance
 * between their centres (5 when that rounds down to 0), capped at
 * MAP_GLOBAL_TRAVEL_TIME_CAP_SECS. Travel to Wake Island is instant; unknown tiles take
 * the cap.
 */
export const calcGlobalTravelTime = (
  sectorA: number,
  sectorB: number,
  map: GlobalMapData,
) => {
  if (sectorB === MAP_WAKE_ISLAND_SECTOR) return 0;
  const a = map?.tiles[sectorA]?.c;
  const b = map?.tiles[sectorB]?.c;
  const r = map?.radius;
  if (a && b && r) {
    const distance = r * Math.acos((a.x * b.x + a.y * b.y + a.z * b.z) / r ** 2);
    const secs = Math.floor(distance / 2) || 5;
    return Math.min(secs, MAP_GLOBAL_TRAVEL_TIME_CAP_SECS);
  }
  return MAP_GLOBAL_TRAVEL_TIME_CAP_SECS;
};

/**
 * Client cache patch when globe travel starts. Instant journeys (Wake Island
 * is 0 seconds) omit travelFinishAt so the arrival countdown cannot call
 * finishGlobalMove before startGlobalMove commits — that would no-op on the
 * still-AWAKE row, after which start would leave the player stuck traveling.
 */
export const optimisticGlobalTravelStart = (travelTimeSeconds: number) => ({
  status: "TRAVEL" as const,
  ...(travelTimeSeconds > 0
    ? { travelFinishAt: secondsFromNow(travelTimeSeconds) }
    : {}),
});

/** Merge arrival's public quest projection while retaining unloaded achievement progress. */
export const globalTravelFinishPatch = (
  current: Pick<NonNullable<UserWithRelations>, "userQuests" | "questData">,
  patch: UserCachePatch,
  projectedQuestIds: readonly string[] = [],
) => {
  const projected = new Set(projectedQuestIds);
  const teamQuestStates = ({ userQuests, questData }: typeof current) =>
    new Map(
      userQuests.flatMap((entry) => {
        const tracker = questData?.find((tracker) => tracker.id === entry.questId);
        return entry.quest.teamEnabled &&
          !entry.endAt &&
          !entry.completed &&
          tracker &&
          !tracker.failed
          ? [[entry.questId, isQuestComplete(entry.quest, tracker)] as const]
          : [];
      }),
    );
  const previousTeams = teamQuestStates(current);
  const arrivedTeams = teamQuestStates({
    userQuests: patch.userQuests ?? [],
    questData: patch.questData ?? [],
  });
  // Synthetic overworld achievements have no history row in the sparse arrival read.
  // Reconcile their locations and passive progress through the full profile flow.
  // Team eligibility and completion changes require authoritative navigation reconciliation.
  if (
    current.userQuests.some(
      (entry) => entry.questType === "achievement" && !projected.has(entry.questId),
    ) ||
    previousTeams.size !== arrivedTeams.size ||
    [...previousTeams].some(([id, complete]) => arrivedTeams.get(id) !== complete)
  )
    return undefined;
  const replaced = new Set([
    ...current.userQuests.map((entry) => entry.questId),
    ...projectedQuestIds,
  ]);
  return {
    ...patch,
    questData: [
      ...(current.questData ?? []).filter((tracker) => !replaced.has(tracker.id)),
      ...(patch.questData ?? []),
    ],
  };
};

/**
 * A fight nobody has touched for this long is abandoned. While any participant
 * has the battle open, idle turns time out and advance the round (stamping
 * Battle.updatedAt) at least every COMBAT_SECONDS, so a few missed rounds is a
 * safe margin.
 */
export const SECTOR_BATTLE_STALE_SECONDS = COMBAT_LOBBY_SECONDS + COMBAT_SECONDS * 5;

/** Statuses that place another player on the sector map. */
export const SECTOR_PRESENCE_STATUSES = ["AWAKE", "BATTLE"] as const;

/** Most players one sector arrival read resolves. */
export const SECTOR_ARRIVAL_BATCH_LIMIT = 50;

/** How long a viewer gathers a burst of sector arrivals into one read. */
export const SECTOR_ARRIVAL_BATCH_MS = 250;

/** Whether a sector broadcast's status can add its player to the sector map. */
export const isSectorPresenceStatus = (status: string | undefined) =>
  (SECTOR_PRESENCE_STATUSES as readonly (string | undefined)[]).includes(status);

/**
 * Drops BATTLE-status users whose fight is not live from the sector map.
 *
 * A user keeps status BATTLE until they personally settle the fight on the
 * combat page; the winner is released immediately, but a knocked-out player
 * who closed the tab stays in BATTLE against a battle row nobody advances
 * anymore (deleted by the cleaner only after a day). Without this filter those
 * players render as a crossed-swords marker for hours.
 */
export const filterLiveSectorBattleUsers = <
  T extends { status: string; battleId: string | null },
>(
  users: T[],
  liveBattleIds: ReadonlySet<string>,
) =>
  users.filter(
    (user) =>
      user.status !== "BATTLE" ||
      (user.battleId !== null && liveBattleIds.has(user.battleId)),
  );

/** Whether a position sits on a village-zone tile of the sector map. */
export const calcIsInVillage = (
  position: SectorPoint,
  sectorMap: Pick<NormalizedSectorMap, "tiles">,
) => getSectorTile(sectorMap, position)?.zone === "village";

/**
 * Whether a key press should leave the sector map alone: the player is typing
 * (chat, search, forms), holds a browser shortcut, or another handler used it.
 */
export const isTravelKeyBlocked = (event: KeyboardEvent): boolean => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey)
    return true;
  const target = event.target;
  return (
    target instanceof Element &&
    !!target.closest(
      "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
    )
  );
};
