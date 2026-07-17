import { and, eq, ne, or, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { overworldAiPlacement } from "@/drizzle/schema";
import {
  handleEndpointError,
  lockWithDailyTimer,
  updateGameSetting,
} from "@/libs/gamesettings";
import { resolveOverworldPosition } from "@/libs/overworldAi";
import { drizzleDB } from "@/server/db";

const ENDPOINT_NAME = "daily-overworld-ai";

export const GET = async (request: Request) => {
  // Touch a dynamic API so Next.js does not statically cache this GET handler
  await cookies();

  // Verify CRON_SECRET header for authentication (Vercel injects it for scheduled crons)
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret) {
    return Response.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return Response.json(
      { error: "Unauthorized - Invalid or missing authorization header" },
      { status: 401 },
    );
  }

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

    // Re-randomize positions for all fetched placements in parallel
    await Promise.all(
      placements.map((p) => {
        const pos = resolveOverworldPosition(p);
        return drizzleDB
          .update(overworldAiPlacement)
          .set({
            sector: pos.sector,
            longitude: pos.longitude,
            latitude: pos.latitude,
            positionVersion: sql`${overworldAiPlacement.positionVersion} + 1`,
          })
          .where(eq(overworldAiPlacement.id, p.id));
      }),
    );

    return Response.json("OK");
  } catch (cause) {
    // Rollback
    await updateGameSetting(drizzleDB, ENDPOINT_NAME, 0, timerCheck.prevTime);
    return await handleEndpointError(cause);
  }
};
