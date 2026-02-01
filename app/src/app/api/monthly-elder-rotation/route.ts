import { eq, and, isNotNull, inArray, isNull } from "drizzle-orm";
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

    // Fetch villages and all clans in parallel
    const [villages, allClans] = await Promise.all([
      drizzleDB.query.village.findMany({
        where: eq(village.type, "VILLAGE"),
        columns: { id: true, name: true },
      }),
      drizzleDB.query.clan.findMany({
        where: isNotNull(clan.villageId),
        columns: { id: true, villageId: true, activityPoints: true, points: true },
      }),
    ]);

    const villageIds = villages.map((v) => v.id);

    // Clear all cutoff fields in one query
    await drizzleDB
      .update(clan)
      .set({ elderCutoffMonth: null, elderCutoffYear: null, elderCutoffRank: null })
      .where(inArray(clan.villageId, villageIds));

    // Group clans by village and compute top 3 per village
    const clansByVillage = new Map<string, typeof allClans>();
    for (const c of allClans) {
      if (c.villageId && villageIds.includes(c.villageId)) {
        const list = clansByVillage.get(c.villageId) ?? [];
        list.push(c);
        clansByVillage.set(c.villageId, list);
      }
    }

    // Determine clans to mark with cutoff rank
    const clansToMark: { id: string; rank: number }[] = [];
    for (const [, clans] of clansByVillage) {
      const sorted = clans
        .filter((c) => c.activityPoints > 0)
        .sort((a, b) => b.activityPoints - a.activityPoints || b.points - a.points)
        .slice(0, KAGE_MAX_ELDERS);
      sorted.forEach((c, i) => clansToMark.push({ id: c.id, rank: i + 1 }));
    }

    // Batch update all eligible clans in parallel
    if (clansToMark.length > 0) {
      await Promise.all(
        clansToMark.map((c) =>
          drizzleDB
            .update(clan)
            .set({
              elderCutoffMonth: currentMonth,
              elderCutoffYear: currentYear,
              elderCutoffRank: c.rank,
            })
            .where(eq(clan.id, c.id)),
        ),
      );
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
    // Fetch all data in parallel
    const [villages, clansWithCutoff, allClans] = await Promise.all([
      drizzleDB.query.village.findMany({
        where: eq(village.type, "VILLAGE"),
        columns: { id: true, name: true },
      }),
      drizzleDB.query.clan.findMany({
        where: isNotNull(clan.elderCutoffRank),
        columns: {
          id: true,
          villageId: true,
          leaderId: true,
          elderNomineeId: true,
          elderCutoffRank: true,
          activityPoints: true,
          points: true,
        },
      }),
      drizzleDB.query.clan.findMany({
        where: isNotNull(clan.villageId),
        columns: {
          id: true,
          villageId: true,
          leaderId: true,
          elderNomineeId: true,
          elderCutoffRank: true,
          activityPoints: true,
          points: true,
        },
      }),
    ]);

    const villageIds = villages.map((v) => v.id);

    // Build eligible clans per village (cutoff snapshot or fallback)
    const eligibleByVillage = new Map<string, typeof clansWithCutoff>();
    for (const villageId of villageIds) {
      const cutoffClans = clansWithCutoff
        .filter((c) => c.villageId === villageId)
        .sort((a, b) => (a.elderCutoffRank ?? 0) - (b.elderCutoffRank ?? 0));
      if (cutoffClans.length > 0) {
        eligibleByVillage.set(villageId, cutoffClans);
      } else {
        // Fallback to live calculation
        const fallback = allClans
          .filter((c) => c.villageId === villageId && c.activityPoints > 0)
          .sort((a, b) => b.activityPoints - a.activityPoints || b.points - a.points)
          .slice(0, KAGE_MAX_ELDERS);
        eligibleByVillage.set(villageId, fallback);
      }
    }

    // Collect all nominee IDs across all villages
    const allNomineeIds = new Set<string>();
    for (const [, clans] of eligibleByVillage) {
      for (const c of clans) {
        const nomineeId = c.elderNomineeId || c.leaderId;
        if (nomineeId) allNomineeIds.add(nomineeId);
      }
    }

    // Demote all elders first (must complete before nominee fetch so re-nominated elders pass JONIN check)
    await drizzleDB
      .update(userData)
      .set({ rank: "JONIN" })
      .where(and(inArray(userData.villageId, villageIds), eq(userData.rank, "ELDER")));

    // Fetch all potential nominees
    const validNominees =
      allNomineeIds.size > 0
        ? await drizzleDB.query.userData.findMany({
            where: and(
              inArray(userData.userId, [...allNomineeIds]),
              inArray(userData.villageId, villageIds),
              eq(userData.isBanned, false),
              eq(userData.rank, "JONIN"),
              isNull(userData.anbuId),
            ),
            columns: { userId: true, clanId: true, villageId: true },
          })
        : [];

    // Build map for O(1) lookups
    const validNomineeMap = new Map(validNominees.map((n) => [n.userId, n]));

    // Determine all users to promote
    const toPromote: string[] = [];
    for (const [villageId, clans] of eligibleByVillage) {
      for (const c of clans) {
        const nomineeId = c.elderNomineeId || c.leaderId;
        if (!nomineeId) continue;
        const nominee = validNomineeMap.get(nomineeId);
        if (nominee && nominee.clanId === c.id && nominee.villageId === villageId) {
          toPromote.push(nomineeId);
        }
      }
    }

    // Batch promote all valid nominees and reset clan fields in parallel
    await Promise.all([
      toPromote.length > 0
        ? drizzleDB
            .update(userData)
            .set({ rank: "ELDER" })
            .where(inArray(userData.userId, toPromote))
        : Promise.resolve(),
      drizzleDB
        .update(clan)
        .set({
          activityPoints: 0,
          elderNomineeId: null,
          elderCutoffMonth: null,
          elderCutoffYear: null,
          elderCutoffRank: null,
        })
        .where(inArray(clan.villageId, villageIds)),
    ]);

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
