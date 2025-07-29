import { drizzleDB } from "@/server/db";
import { sector, village } from "@/drizzle/schema";
import { eq, gte } from "drizzle-orm";
import { lockWithDailyTimer, handleEndpointError } from "@/libs/gamesettings";
import { updateGameSetting } from "@/libs/gamesettings";
import { cookies } from "next/headers";
import { WAR_SHRINE_MAINTENANCE_DAYS } from "@/drizzle/constants";
import { secondsFromNow } from "@/utils/time";

const ENDPOINT_NAME = "shrine-maintenance";

export async function GET() {
  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  // Check timer - run once per day
  const timerCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewDay && timerCheck.response) return timerCheck.response;

  try {
    // Find all villages that need maintenance checks
    const [villages, sectors] = await Promise.all([
      drizzleDB.query.village.findMany({
        columns: {
          id: true,
          name: true,
          shrineSettings: true,
        },
      }),
      drizzleDB.query.sector.findMany(),
    ]);

    let maintenanceChecked = 0;
    let shrinesDowngraded = 0;

    for (const villageData of villages) {
      const settings = villageData.shrineSettings;
      const nextMaintainanceDueDate = settings.nextMaintainanceDueDate
        ? new Date(settings.nextMaintainanceDueDate)
        : new Date();
      const now = new Date();
      const isOverdue = nextMaintainanceDueDate <= now;

      // Get all sectors belonging to this village that have shrines
      const villageSectors = sectors.filter((s) => s.villageId === villageData.id);

      if (isOverdue) {
        console.log(villageData.name, villageSectors);
      }

      // Downgrade each shrine in parallel
      const [downgradeResults] = await Promise.all([
        isOverdue
          ? await Promise.all(
              villageSectors.map((sectorData) => {
                const newLevel = sectorData.shrineLevel - 1;
                if (newLevel < 1) {
                  return drizzleDB.delete(sector).where(eq(sector.id, sectorData.id));
                } else {
                  return drizzleDB
                    .update(sector)
                    .set({ shrineLevel: newLevel })
                    .where(eq(sector.id, sectorData.id));
                }
              }),
            )
          : Promise.resolve([]),
        drizzleDB
          .update(village)
          .set({
            shrineSettings: {
              nextMaintainanceDueDate: secondsFromNow(
                WAR_SHRINE_MAINTENANCE_DAYS * 24 * 60 * 60,
              ).toISOString(),
              ...settings,
            },
          })
          .where(eq(village.id, villageData.id)),
      ]);
      shrinesDowngraded += downgradeResults.length;
      maintenanceChecked++;
    }

    return new Response(
      `Shrine maintenance completed: ${maintenanceChecked} villages checked, ${shrinesDowngraded} shrines downgraded`,
      { status: 200 },
    );
  } catch (cause) {
    // Rollback
    await updateGameSetting(drizzleDB, ENDPOINT_NAME, 0, timerCheck.prevTime);
    return handleEndpointError(cause);
  }
}
