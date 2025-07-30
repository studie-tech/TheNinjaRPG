import { drizzleDB } from "@/server/db";
import { sector } from "@/drizzle/schema";
import { eq, lte } from "drizzle-orm";
import { lockWithDailyTimer, handleEndpointError } from "@/libs/gamesettings";
import { updateGameSetting } from "@/libs/gamesettings";
import { cookies } from "next/headers";
import { GSP_NO_RETURNED_VALUE } from "next/dist/lib/constants";

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
    }

    const message = `Shrine maintenance completed: ${sectorsChecked} sectors checked, ${shrinesDowngraded} shrines downgraded, ${shrinesDestroyed} shrines destroyed`;

    return new Response(message, { status: 200 });
  } catch (cause) {
    // Rollback
    await updateGameSetting(drizzleDB, ENDPOINT_NAME, 0, timerCheck.prevTime);
    return handleEndpointError(cause);
  }
}
