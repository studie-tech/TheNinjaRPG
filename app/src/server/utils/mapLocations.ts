import { publicQuestLocations } from "@/libs/mapLocations";
import { getServerPusher } from "@/libs/pusher";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import { findNearestReachableCoordinate } from "@/libs/sector-map/validation";
import {
  findDungeonForIsStructureAssetUsed,
  findQuestForIsStructureAssetUsed,
  listMapAssetForValidateQuestStructures,
  listOverworldAiPlacementForValidateQuestStructures,
  listQuestForFetchPublicQuestLocations,
} from "@/queries/worldMap";
import type { DrizzleClient } from "@/server/db";
import { fetchPublishedSectorMaps } from "@/server/utils/sectorMap";
import { MAP_LOCATION_REFRESH_MS, type MapLocation } from "@/validators/mapLocation";

import type { AllObjectivesType } from "@/validators/objectives";

type PublicQuest = Parameters<typeof publicQuestLocations>[0][number];
const publicLocationCache = new WeakMap<
  DrizzleClient,
  { quests: PublicQuest[]; at: number; generation: number }
>();
let publicLocationGeneration = 0;
/** Invalidate client-local entries and prevent in-flight reads from refilling them. */
export const invalidatePublicQuestLocations = () => {
  publicLocationGeneration += 1;
};

/**
 * Load neutral scenery with one indexed query, independent of player history.
 * Publication guards bypass the cache with `fresh` and include future events with `includeScheduled`.
 * A notification's `revision` bypasses older caches on other workers; dates are checked per read.
 */
export const fetchPublicQuestLocations = async (
  client: DrizzleClient,
  {
    fresh = false,
    revision = 0,
    includeScheduled = false,
  }: { fresh?: boolean; revision?: number; includeScheduled?: boolean } = {},
) => {
  const cached = publicLocationCache.get(client);
  const quests =
    !fresh &&
    cached &&
    cached.at >= revision &&
    cached.generation === publicLocationGeneration &&
    Date.now() - cached.at < MAP_LOCATION_REFRESH_MS
      ? cached.quests
      : await loadPublicQuests(client);
  return publicQuestLocations(
    includeScheduled
      ? quests.map((q) => ({ ...q, startsAt: null, endsAt: null }))
      : quests,
  );
};

/** Read the quests and cache them unless an edit invalidated the read meanwhile. */
const loadPublicQuests = async (client: DrizzleClient) => {
  const generation = publicLocationGeneration;
  // A slow read cannot claim freshness newer than its snapshot.
  const startedAt = Date.now();
  const quests = await listQuestForFetchPublicQuestLocations(client);
  // A query started before an edit must not repopulate the invalidated cache.
  if (generation === publicLocationGeneration)
    publicLocationCache.set(client, { quests, at: startedAt, generation });
  return quests;
};

/** Global event contains no quest details; polling/focus refresh recovers missed notifications. */
export const notifyMapLocationsChanged = async () => {
  invalidatePublicQuestLocations();
  try {
    await getServerPusher().trigger("map-content", "updated", { revision: Date.now() });
  } catch (error) {
    console.warn("Map content notification failed", error);
  }
};

/** Require the authored entrance itself to be reachable; never silently relocate public scenery. */
export const validateMapLocationTiles = (
  locations: MapLocation[],
  maps: ReadonlyMap<
    number,
    Pick<NormalizedSectorMap, "width" | "height" | "tiles" | "anchors">
  >,
) => {
  for (const location of locations) {
    const map = maps.get(location.sector);
    const reachable =
      map &&
      findNearestReachableCoordinate(map, {
        x: location.longitude,
        y: location.latitude,
      });
    if (
      !reachable ||
      reachable.x !== location.longitude ||
      reachable.y !== location.latitude
    )
      return `${location.name}: choose a reachable entrance tile on the published sector map`;
  }
  return null;
};

/**
 * Return an author-facing error or null, batching asset, NPC and published-map checks.
 * Only public targets require an authored reachable tile; private targets resolve for each run.
 */
export const validateQuestStructures = async (
  client: DrizzleClient,
  data: {
    id?: string;
    publicLocations: boolean;
    content: { objectives: AllObjectivesType[] };
  },
) => {
  const objectives = data.content.objectives.filter((o) => o.structureAssetId);
  if (!objectives.length) return null;
  const locations = data.publicLocations
    ? publicQuestLocations([
        {
          ...data,
          id: data.id ?? "draft",
          hidden: false,
          startsAt: null,
          endsAt: null,
        },
      ])
    : [];
  const ids = [...new Set(objectives.map((o) => o.structureAssetId))];
  const placementIds = objectives
    .map((o) => o.overworldPlacementId)
    .filter((id): id is string => !!id);
  const [assets, maps, placements] = await Promise.all([
    listMapAssetForValidateQuestStructures(client, ids),
    locations.length
      ? fetchPublishedSectorMaps(client, [...new Set(locations.map((l) => l.sector))])
      : new Map<number, NormalizedSectorMap>(),
    placementIds.length
      ? listOverworldAiPlacementForValidateQuestStructures(client, placementIds)
      : [],
  ]);
  if (
    placements.some((p) => p.sectorType !== "specific" || p.locationType !== "specific")
  )
    return "Structures cannot be attached to roaming NPC placements.";
  if (ids.some((id) => !assets.some((asset) => asset.id === id)))
    return "A structure asset no longer exists. Choose another asset.";
  return validateMapLocationTiles(locations, maps);
};

/** Preflight saved quest and dungeon references before deleting shared artwork. */
export const isStructureAssetUsed = async (client: DrizzleClient, assetId: string) => {
  const [questReference, dungeonReference] = await Promise.all([
    findQuestForIsStructureAssetUsed(client, assetId),
    findDungeonForIsStructureAssetUsed(client, assetId),
  ]);
  return !!questReference || !!dungeonReference;
};
