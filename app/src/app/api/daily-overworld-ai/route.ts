import { eq, ne, sql } from "drizzle-orm";
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

export async function GET() {
  // Touch a dynamic API so Next.js does not statically cache this GET handler
  await cookies();

  // Check timer
  const timerCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewDay && timerCheck.response) return timerCheck.response;

  try {
    // Fetch all non-fixed placements (sectorType !== "specific")
    const placements = await drizzleDB.query.overworldAiPlacement.findMany({
      where: ne(overworldAiPlacement.sectorType, "specific"),
    });

    // Re-randomize positions for all active non-fixed placements in parallel
    await Promise.all(
      placements
        .filter((p) => p.isActive)
        .map((p) => {
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
}
