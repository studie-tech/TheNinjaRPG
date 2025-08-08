import { NextResponse } from "next/server";
import { and, eq, lt, sql } from "drizzle-orm";
import { drizzleDB } from "@/server/db";
import { bounty, bountySignup, bountyContribution, userData, type BountyContribution } from "@/drizzle/schema";
import { lockWithHourlyTimer, handleEndpointError } from "@/libs/gamesettings";
import { cookies } from "next/headers";

const ENDPOINT_NAME = "hourly-bounty-expire";
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

export async function GET() {
  // disable cache for this server action
  await cookies();

  // Check timer
  const timerCheck = await lockWithHourlyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewHour && timerCheck.response) return timerCheck.response;

  try {
    // Find bounties that are OPEN and older than 1 week
    const oneWeekAgo = new Date(Date.now() - ONE_WEEK_MS);
    const expiredBounties = await drizzleDB.query.bounty.findMany({
      where: and(
        eq(bounty.status, "OPEN"),
        lt(bounty.createdAt, oneWeekAgo)
      ),
      with: {
        hunters: true,
      },
    });

    if (expiredBounties.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No bounties to expire",
      });
    }

    // Process all expired bounties in parallel
    await Promise.all(
      expiredBounties.map(async (expiredBounty) => {
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

    return NextResponse.json({
      success: true,
      message: `Expired ${expiredBounties.length} bounties and refunded all contributions`,
      expiredBountiesCount: expiredBounties.length,
    });
  } catch (error) {
    return handleEndpointError(error);
  }
}