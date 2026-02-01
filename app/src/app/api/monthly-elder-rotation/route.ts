import { eq, and, desc, isNotNull, asc, inArray, isNull } from "drizzle-orm";
import { drizzleDB } from "@/server/db";
import { userData, clan, village } from "@/drizzle/schema";
import { updateGameSetting } from "@/libs/gamesettings";
import { lockWithMonthlyTimer, handleEndpointError } from "@/libs/gamesettings";
import { cookies } from "next/headers";
import {
  KAGE_MAX_ELDERS,
  ELDER_NOMINATION_CUTOFF_DAY,
  ELDER_NOMINATION_DEADLINE_DAY,
} from "@/drizzle/constants";

export async function GET() {
  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  const now = new Date();
  const dayOfMonth = now.getUTCDate();

  // Route to appropriate handler based on day of month
  // Cron fires on ELDER_NOMINATION_CUTOFF_DAY (25th) and ELDER_NOMINATION_DEADLINE_DAY (28th)
  if (dayOfMonth === ELDER_NOMINATION_CUTOFF_DAY) {
    return handleCutoff();
  } else if (dayOfMonth === ELDER_NOMINATION_DEADLINE_DAY) {
    return handleRotation();
  } else {
    return Response.json(
      { error: "Elder rotation cron should only run on cutoff or deadline days" },
      { status: 400 },
    );
  }
}

/**
 * Cutoff handler - runs on ELDER_NOMINATION_CUTOFF_DAY (25th) to snapshot top 3 clans per village
 * This determines which clans are eligible for elder positions before the nomination window opens.
 */
async function handleCutoff() {
  const timerCheck = await lockWithMonthlyTimer(drizzleDB, "monthly-elder-cutoff");
  if (!timerCheck.isNewMonth && timerCheck.response) return timerCheck.response;

  try {
    const now = new Date();
    const currentMonth = now.getUTCMonth() + 1; // 1-12
    const currentYear = now.getUTCFullYear();

    const villages = await drizzleDB.query.village.findMany({
      where: eq(village.type, "VILLAGE"),
      columns: { id: true, name: true },
    });

    for (const villageData of villages) {
      // Clear previous cutoff fields for all clans in this village
      await drizzleDB
        .update(clan)
        .set({
          elderCutoffMonth: null,
          elderCutoffYear: null,
          elderCutoffRank: null,
        })
        .where(eq(clan.villageId, villageData.id));

      // Find top 3 clans by activityPoints, with points as tie-breaker
      const topClans = await drizzleDB.query.clan.findMany({
        where: eq(clan.villageId, villageData.id),
        orderBy: [desc(clan.activityPoints), desc(clan.points)],
        limit: KAGE_MAX_ELDERS,
        columns: {
          id: true,
          activityPoints: true,
        },
      });

      // Mark top clans that have activity points with their cutoff rank
      const clansWithActivity = topClans.filter((c) => c.activityPoints > 0);
      for (let i = 0; i < clansWithActivity.length; i++) {
        const topClan = clansWithActivity[i];
        if (topClan) {
          await drizzleDB
            .update(clan)
            .set({
              elderCutoffMonth: currentMonth,
              elderCutoffYear: currentYear,
              elderCutoffRank: i + 1, // 1, 2, or 3
            })
            .where(eq(clan.id, topClan.id));
        }
      }
    }

    return Response.json(
      `OK - Elder cutoff snapshot completed for ${villages.length} villages`,
    );
  } catch (cause) {
    await updateGameSetting(drizzleDB, "monthly-elder-cutoff", 0, timerCheck.prevTime);
    return handleEndpointError(cause);
  }
}

/**
 * Rotation handler - runs on ELDER_NOMINATION_DEADLINE_DAY (28th) to promote elders and reset points
 * By this time nominations have closed, so nominees are final and ready for promotion.
 */
async function handleRotation() {
  const timerCheck = await lockWithMonthlyTimer(drizzleDB, "monthly-elder-rotation");
  if (!timerCheck.isNewMonth && timerCheck.response) return timerCheck.response;

  try {
    const villages = await drizzleDB.query.village.findMany({
      where: eq(village.type, "VILLAGE"),
      columns: { id: true, name: true },
    });

    for (const villageData of villages) {
      // Find eligible clans using cutoff snapshot (set on ELDER_NOMINATION_CUTOFF_DAY)
      // If cutoff snapshot exists, use it; otherwise fall back to live calculation
      let eligibleClans = await drizzleDB.query.clan.findMany({
        where: and(eq(clan.villageId, villageData.id), isNotNull(clan.elderCutoffRank)),
        orderBy: asc(clan.elderCutoffRank), // Sort by rank 1, 2, 3
        columns: {
          id: true,
          leaderId: true,
          elderNomineeId: true,
          elderCutoffRank: true,
          activityPoints: true,
        },
      });

      // Fall back to live calculation if no cutoff snapshot exists
      if (eligibleClans.length === 0) {
        eligibleClans = await drizzleDB.query.clan.findMany({
          where: eq(clan.villageId, villageData.id),
          orderBy: [desc(clan.activityPoints), desc(clan.points)],
          limit: KAGE_MAX_ELDERS,
          columns: {
            id: true,
            leaderId: true,
            elderNomineeId: true,
            elderCutoffRank: true,
            activityPoints: true,
          },
        });
        eligibleClans = eligibleClans.filter((c) => c.activityPoints > 0);
      }

      // Demote current elders to JONIN
      await drizzleDB
        .update(userData)
        .set({ rank: "JONIN" })
        .where(and(eq(userData.villageId, villageData.id), eq(userData.rank, "ELDER")));

      // Batch fetch all nominees at once
      const nomineeIds = eligibleClans
        .map((c) => c.elderNomineeId || c.leaderId)
        .filter((id): id is string => id !== null);

      if (nomineeIds.length > 0) {
        const validNominees = await drizzleDB.query.userData.findMany({
          where: and(
            inArray(userData.userId, nomineeIds),
            eq(userData.villageId, villageData.id),
            eq(userData.isBanned, false),
            eq(userData.rank, "JONIN"),
            isNull(userData.anbuId),
          ),
          columns: { userId: true, clanId: true },
        });

        // Create map for O(1) lookups
        const validNomineeMap = new Map(validNominees.map((n) => [n.userId, n]));

        // Filter to nominees that are still in their eligible clan
        const toPromote = eligibleClans
          .map((clan) => {
            const nomineeId = clan.elderNomineeId || clan.leaderId;
            if (!nomineeId) return null;
            const nominee = validNomineeMap.get(nomineeId);
            return nominee && nominee.clanId === clan.id ? nomineeId : null;
          })
          .filter((id): id is string => id !== null);

        // Batch promote all valid nominees
        if (toPromote.length > 0) {
          await drizzleDB
            .update(userData)
            .set({ rank: "ELDER" })
            .where(inArray(userData.userId, toPromote));
        }
      }
    }

    // Reset activityPoints and clear nomination/cutoff fields in one query
    await drizzleDB.update(clan).set({
      activityPoints: 0,
      elderNomineeId: null,
      elderCutoffMonth: null,
      elderCutoffYear: null,
      elderCutoffRank: null,
    });

    return Response.json(`OK - Elder rotation completed`);
  } catch (cause) {
    await updateGameSetting(
      drizzleDB,
      "monthly-elder-rotation",
      0,
      timerCheck.prevTime,
    );
    return handleEndpointError(cause);
  }
}
