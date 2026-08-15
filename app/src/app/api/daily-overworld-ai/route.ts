import { and, eq, ne, or, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { overworldAiPlacement } from "@/drizzle/schema";
import {
  handleEndpointError,
  lockWithDailyTimer,
  updateGameSetting,
} from "@/libs/gamesettings";
import {
  resolveOverworldPosition,
  snapOverworldPositionToWalkable,
} from "@/libs/overworldAi";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";
import { fetchPublishedSectorMaps } from "@/server/utils/sectorMap";

const ENDPOINT_NAME = "daily-overworld-ai";

/**
 * Repositions every active randomized overworld AI placement for the new day.
 * The handler authenticates the cron request, serializes execution with the daily timer, and
 * validates all destinations before persisting any position updates.
 */
export const GET = async (request: Request) => {
  // Touch a dynamic API so Next.js does not statically cache this GET handler
  await cookies();

  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  // Check timer
  const timerCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewDay && timerCheck.response) return timerCheck.response;

  try {
    // Fetch active placements with any positional randomness — a random sector OR a random
    // tile within a fixed sector (sectorType=specific, locationType=random). Only fully-fixed
    // placements (specific/specific) stay put; resolveOverworldPosition keeps the fixed axes.
    // isActive is pushed into the query (index-backed) so inactive rows are never transferred.
    const placements = await drizzleDB.query.overworldAiPlacement.findMany({
      where: and(
        eq(overworldAiPlacement.isActive, true),
        or(
          ne(overworldAiPlacement.sectorType, "specific"),
          ne(overworldAiPlacement.locationType, "specific"),
        ),
      ),
    });

    const resolved = placements.map((placement) => ({
      placement,
      position: resolveOverworldPosition(placement),
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
      const pos = snapOverworldPositionToWalkable(position, map);
      if (!pos) throw new Error(`Sector ${position.sector} has no walkable tile`);
      return { placement, pos };
    });

    // Re-randomize positions for all fetched placements in parallel
    await Promise.all(
      snapped.map(({ placement, pos }) => {
        return drizzleDB
          .update(overworldAiPlacement)
          .set({
            sector: pos.sector,
            longitude: pos.longitude,
            latitude: pos.latitude,
            positionVersion: sql`${overworldAiPlacement.positionVersion} + 1`,
          })
          .where(eq(overworldAiPlacement.id, placement.id));
      }),
    );

    return Response.json("OK");
  } catch (cause) {
    // Rollback
    await updateGameSetting(drizzleDB, ENDPOINT_NAME, 0, timerCheck.prevTime);
    return await handleEndpointError(cause);
  }
};
