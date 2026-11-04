import { and, eq, gte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { STRONGHOLD_MONTHLY_MAINTENANCE } from "@/drizzle/constants";
import { clan, village } from "@/drizzle/schema";
import { lockWithDailyTimer, runClaimedCron } from "@/libs/gamesettings";
import {
  executeRowsForGET,
  selectVillageForGET,
  selectVillageForGET2,
} from "@/queries/clan";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";

const ENDPOINT_NAME = "daily-hideout-downgrade";

export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  // Check timer
  const timerCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME);

  return runClaimedCron(timerCheck, "/api/daily-hideout-downgrade", async () => {
    // Fetch Strongholds whose monthly maintenance is due.
    const strongholdsDueForMaintainance = await selectVillageForGET(drizzleDB);

    // Claim maintenance and charge or downgrade together, using the current locked balance.
    await Promise.all(
      strongholdsDueForMaintainance.map(({ Clan: faction, Village: settlement }) => {
        const guards = and(
          eq(clan.id, faction.id),
          eq(village.id, settlement.id),
          eq(village.type, "STRONGHOLD"),
          eq(village.lastMaintenancePaidAt, settlement.lastMaintenancePaidAt),
        );
        // LIMIT prevents derived-table merging. The locking snapshot keeps the payment
        // decision independent of joined UPDATE assignment order and sees waiting debits.
        const snapshot = selectVillageForGET2(drizzleDB, guards);
        const canPay = gte(snapshot.points, STRONGHOLD_MONTHLY_MAINTENANCE);
        return retryOnDeadlock(() =>
          executeRowsForGET(drizzleDB, snapshot, canPay, guards),
        );
      }),
    );

    return NextResponse.json({
      success: true,
      message: `Processed ${strongholdsDueForMaintainance.length} strongholds`,
    });
  });
}
