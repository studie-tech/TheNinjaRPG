import { drizzleDB } from "@/server/db";
import { sector, village } from "@/drizzle/schema";
import { eq, lte, and, sql } from "drizzle-orm";
import { lockWithDailyTimer, handleEndpointError } from "@/libs/gamesettings";
import { updateGameSetting } from "@/libs/gamesettings";
import { cookies } from "next/headers";
import { processDueScheduledBoosts } from "@/utils/shrine";

const ENDPOINT_NAME = "shrine-maintenance";

export async function GET() {
  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  // Check timer - run once per day
  const timerCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewDay && timerCheck.response) return timerCheck.response;

  try {
    const now = new Date();

    // Find all sectors with overdue maintenance
    const overdueSectors = await drizzleDB.query.sector.findMany({
      where: lte(sector.nextMaintainanceDueDate, now),
      with: {
        village: {
          columns: {
            name: true,
          },
        },
      },
    });

    const sectorsChecked = overdueSectors.length;
    let shrinesDowngraded = 0;
    let shrinesDestroyed = 0;

    if (overdueSectors.length > 0) {
      // Process each overdue sector
      const downgradePromises = overdueSectors.map((sectorData) => {
        const newLevel = sectorData.shrineLevel - 1;

        if (newLevel < 1) {
          shrinesDestroyed++;
          return drizzleDB.delete(sector).where(eq(sector.id, sectorData.id));
        } else {
          shrinesDowngraded++;
          return drizzleDB
            .update(sector)
            .set({ shrineLevel: newLevel })
            .where(eq(sector.id, sectorData.id));
        }
      });

      // Execute all downgrades in parallel
      await Promise.all(downgradePromises);

    // After maintenance, process due scheduled boosts for all villages
    const villages = await drizzleDB.query.village.findMany({
      columns: { id: true, tokens: true, shrineSettings: true },
    });
    let schedulesProcessed = 0;
    let totalTokensSpent = 0;
    if (villages.length > 0) {
      // Preload sector levels for level3 count
      const allSectors = await drizzleDB.query.sector.findMany({
        columns: { villageId: true, shrineLevel: true },
      });
      const level3Count: Record<string, number> = {};
      for (const s of allSectors) {
        if (!s.villageId) continue;
        if (s.shrineLevel === 3) level3Count[s.villageId] = (level3Count[s.villageId] || 0) + 1;
      }
      for (const v of villages) {
        const lvl3 = level3Count[v.id] || 0;
        const { updatedSettings, processedIds, tokensSpent } = processDueScheduledBoosts(
          v.shrineSettings as any,
          v.tokens,
          lvl3,
          now,
        );
        if (processedIds.length > 0) {
          schedulesProcessed += processedIds.length;
          totalTokensSpent += tokensSpent;
          await drizzleDB
            .update(village)
            .set({ tokens: sql`${village.tokens} - ${tokensSpent}`, shrineSettings: updatedSettings as any })
            .where(and(eq(village.id, v.id)));
        }
      }
    }

    const message = `Shrine maintenance completed: ${sectorsChecked} sectors checked, ${shrinesDowngraded} shrines downgraded, ${shrinesDestroyed} shrines destroyed. Scheduled boosts processed: ${schedulesProcessed}, tokens spent: ${totalTokensSpent}`;

    return new Response(message, { status: 200 });
    }

    const message = `Shrine maintenance completed: ${sectorsChecked} sectors checked, ${shrinesDowngraded} shrines downgraded, ${shrinesDestroyed} shrines destroyed`;

    return new Response(message, { status: 200 });
  } catch (cause) {
    // Rollback
    await updateGameSetting(drizzleDB, ENDPOINT_NAME, 0, timerCheck.prevTime);
    return handleEndpointError(cause);
  }
}
