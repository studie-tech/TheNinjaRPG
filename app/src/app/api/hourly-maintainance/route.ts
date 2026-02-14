import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  type BountyContribution,
  bounty,
  bountyContribution,
  bountySignup,
  userData,
} from "@/drizzle/schema";
import {
  handleEndpointError,
  lockWithHourlyTimer,
  updateGameSetting,
} from "@/libs/gamesettings";
import { drizzleDB } from "@/server/db";
import { secondsFromNow } from "@/utils/time";

const ENDPOINT_NAME = "hourly-maintainance";
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

export async function GET() {
  // disable cache for this server action
  await cookies();

  // Check timer
  const timerCheck = await lockWithHourlyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewHour && timerCheck.response) return timerCheck.response;

  try {
    // Expired bounties
    const [expiredBounties, activeCount] = await Promise.all([
      bountyExpire(),
      dailyActivePlayers(),
    ]);

    // Return response
    return NextResponse.json({
      success: true,
      message: `Expired ${expiredBounties.length} bounties and refunded all contributions and updated active players count to ${activeCount}`,
      expiredBountiesCount: expiredBounties.length,
      activeCount: activeCount,
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
  const expiredBounties = await drizzleDB.query.bounty.findMany({
    where: and(eq(bounty.status, "OPEN"), lt(bounty.createdAt, oneWeekAgo)),
    with: {
      hunters: true,
    },
  });

  if (expiredBounties.length === 0) {
    return expiredBounties;
  }

  // Process all expired bounties in parallel
  await Promise.all(
    expiredBounties.map(async (expiredBounty: (typeof expiredBounties)[number]) => {
      // Get all contributions for this bounty
      const contributions = await drizzleDB.query.bountyContribution.findMany({
        where: eq(bountyContribution.bountyId, expiredBounty.id),
      });

      // Execute all mutations in parallel for each bounty
      await Promise.all([
        // Update bounty status to EXPIRED
        drizzleDB
          .update(bounty)
          .set({ status: "EXPIRED" })
          .where(eq(bounty.id, expiredBounty.id)),

        // Remove all hunter signups for this bounty
        drizzleDB
          .delete(bountySignup)
          .where(eq(bountySignup.bountyId, expiredBounty.id)),

        // Remove all contributions for this bounty
        drizzleDB
          .delete(bountyContribution)
          .where(eq(bountyContribution.bountyId, expiredBounty.id)),

        // Refund all contributors their money
        ...contributions.map((contribution: BountyContribution) =>
          drizzleDB
            .update(userData)
            .set({ money: sql`${userData.money} + ${contribution.amountRyo}` })
            .where(eq(userData.userId, contribution.contributorUserId)),
        ),
      ]);
    }),
  );
  return expiredBounties;
};

const dailyActivePlayers = async () => {
  // Count users active in the last 24 hours (updatedAt within last 24 hours)
  const result = await drizzleDB
    .select({ count: count() })
    .from(userData)
    .where(gte(userData.updatedAt, secondsFromNow(-3600 * 24))); // 24 hours = 3600 * 24 seconds

  const activeCount = result?.[0]?.count ?? 0;

  // Update the game setting with the count
  await updateGameSetting(drizzleDB, ENDPOINT_NAME, activeCount, new Date());

  return activeCount;
};
