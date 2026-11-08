import { lockWithDailyTimer, runClaimedCron } from "@/libs/gamesettings";
import {
  resolveOverworldPosition,
  snapOverworldPositionToWalkable,
} from "@/libs/overworldAi";
import { snapToWanderTile } from "@/libs/overworldWander";
import {
  listOverworldAiPlacementForGET,
  updateOverworldAiPlacementForGET,
} from "@/queries/overworldAi";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";
import { fetchPublishedSectorMaps, habitatSectorPool } from "@/server/utils/sectorMap";

const ENDPOINT_NAME = "daily-overworld-ai";

/**
 * Repositions every active randomized overworld AI placement for the new day.
 * The handler authenticates the cron request, serializes execution with the daily timer, and
 * validates all destinations before persisting any position updates.
 */
export const GET = async (request: Request) => {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  // Check timer
  const timerCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME);

  return runClaimedCron(timerCheck, "/api/daily-overworld-ai", async () => {
    // Fetch active placements with any positional randomness — a random sector OR a random
    // tile within a fixed sector (sectorType=specific, locationType=random). Only fully-fixed
    // placements (specific/specific) stay put; resolveOverworldPosition keeps the fixed axes.
    // isActive is pushed into the query (index-backed) so inactive rows are never transferred.
    const placements = await listOverworldAiPlacementForGET(drizzleDB);

    const resolved = placements.map((placement) => ({
      placement,
      position: resolveOverworldPosition(
        placement,
        Math.random,
        habitatSectorPool(placement.habitats),
      ),
    }));
    // One batched map read (plus the shared short-lived cache) avoids a map query per NPC while
    // ensuring every daily roll lands on a tile the movement/pathfinding code can reach.
    const maps = await fetchPublishedSectorMaps(
      drizzleDB,
      resolved.map(({ position }) => position.sector),
    );

    // Validate every roll before issuing writes. A bad/missing map should fail the cron without
    // partially moving the placements that happened to appear earlier in this array.
    const snapped = resolved.map(({ placement, position }) => {
      const map = maps.get(position.sector);
      if (!map) throw new Error(`Sector ${position.sector} has no published map`);
      // Wildlife keeps to the wild; later copies roll from the bumped version on read.
      const wild = placement.wildOnly
        ? snapToWanderTile(map, { x: position.longitude, y: position.latitude }, true)
        : null;
      const pos = wild
        ? { sector: position.sector, longitude: wild.x, latitude: wild.y }
        : snapOverworldPositionToWalkable(position, map);
      if (!pos) throw new Error(`Sector ${position.sector} has no walkable tile`);
      return { placement, pos };
    });

    // Re-randomize positions for all fetched placements in parallel
    await Promise.all(
      snapped.map(({ placement, pos }) => {
        return updateOverworldAiPlacementForGET(drizzleDB, pos, placement);
      }),
    );

    return Response.json("OK");
  });
};
