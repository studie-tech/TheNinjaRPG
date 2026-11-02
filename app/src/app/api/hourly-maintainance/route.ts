import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { handleEndpointError, lockWithHourlyTimer } from "@/libs/gamesettings";
import {
  deleteBountySignups,
  listBountyForBountyExpire,
  updateBountyForBountyExpire,
} from "@/queries/bounty";
import {
  deleteAbEventForDeleteExpiredVisitorAnalytics,
  deleteVisitorLogForDeleteExpiredVisitorAnalytics,
} from "@/queries/data";
import { countUsersActiveInLastDay } from "@/queries/profile";
import { refundBountyContributions } from "@/server/api/routers/bounty";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";
import { accrueVillageStructureMaintenance } from "@/server/utils/villageMaintenance";
import { MONTH_S, secondsFromNow } from "@/utils/time";

const ENDPOINT_NAME = "hourly-maintainance";
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
// Visitor analytics are pseudonymous first-party statistics, kept for 13 months
const VISITOR_ANALYTICS_RETENTION_S = 13 * MONTH_S;

export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  // disable cache for this server action
  await cookies();

  // Check timer
  const timerCheck = await lockWithHourlyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewHour && timerCheck.response) return timerCheck.response;

  try {
    // Expired bounties
    const [expiredBounties, activeCount, expiredAnalytics, villageMaintenance] =
      await Promise.all([
        bountyExpire(),
        dailyActivePlayers(timerCheck),
        deleteExpiredVisitorAnalytics(),
        accrueVillageStructureMaintenance(drizzleDB),
      ]);

    // Return response
    return NextResponse.json({
      success: true,
      message: `Expired ${expiredBounties.length} bounties and refunded all contributions and updated active players count to ${activeCount}`,
      expiredBountiesCount: expiredBounties.length,
      activeCount: activeCount,
      expiredAnalytics,
      villageMaintenance,
    });
  } catch (error) {
    return await handleEndpointError(error);
  }
}

/**
 * Expire bounties that are OPEN and older than 1 week
 * @returns The number of expired bounties
 */
const bountyExpire = async () => {
  // Find bounties that are OPEN and older than 1 week
  const oneWeekAgo = new Date(Date.now() - ONE_WEEK_MS);
  const expiredBounties = await listBountyForBountyExpire(drizzleDB, oneWeekAgo);

  if (expiredBounties.length === 0) {
    return expiredBounties;
  }

  // Process all expired bounties in parallel; a bounty claimed or retracted since the
  // listing loses the OPEN compare-and-swap and is left to that flow
  await Promise.all(
    expiredBounties.map(async (expiredBounty) => {
      const result = await updateBountyForBountyExpire(drizzleDB, expiredBounty);
      if (result.rowsAffected === 0) return;
      await Promise.all([
        deleteBountySignups(drizzleDB, expiredBounty.id),
        refundBountyContributions(drizzleDB, expiredBounty.id),
      ]);
    }),
  );
  return expiredBounties;
};

const dailyActivePlayers = async (
  timerCheck: Awaited<ReturnType<typeof lockWithHourlyTimer>>,
) => {
  // Count users active in the last 24 hours (updatedAt within last 24 hours)
  const result = await countUsersActiveInLastDay(drizzleDB); // 24 hours = 3600 * 24 seconds

  const activeCount = result?.[0]?.count ?? 0;

  // Update the game setting with the count
  await timerCheck.update(activeCount, new Date());

  return activeCount;
};

/**
 * Delete visitor analytics older than their retention period
 */
const deleteExpiredVisitorAnalytics = async () => {
  const cutoff = secondsFromNow(-VISITOR_ANALYTICS_RETENTION_S);
  const [visits, abEvents] = await Promise.all([
    deleteVisitorLogForDeleteExpiredVisitorAnalytics(drizzleDB, cutoff),
    deleteAbEventForDeleteExpiredVisitorAnalytics(drizzleDB, cutoff),
  ]);
  return { visits: visits.rowsAffected, abEvents: abEvents.rowsAffected };
};
