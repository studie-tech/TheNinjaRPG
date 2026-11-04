import {
  ELDER_NOMINATION_CUTOFF_DAY,
  ELDER_NOMINATION_DEADLINE_DAY,
  KAGE_MAX_ELDERS,
} from "@/drizzle/constants";
import { handleEndpointError, lockWithMonthlyTimer } from "@/libs/gamesettings";
import {
  listClanForHandleCutoff,
  listClanForHandleRotation,
  listClanForHandleRotation2,
  listUserDataForHandleRotation,
  listVillageForHandleCutoff,
  updateClanForHandleCutoff,
  updateClanForHandleCutoff2,
  updateClanForHandleRotation,
  updateUserDataForHandleRotation,
  updateUserDataForHandleRotation2,
} from "@/queries/elder";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";

export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

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
      {
        error: "Elder rotation cron should only run on cutoff or deadline days",
      },
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
      listVillageForHandleCutoff(drizzleDB),
      listClanForHandleCutoff(drizzleDB),
    ]);

    type VillageCutoffType = (typeof villages)[number];
    const villageIds = villages.map((v: VillageCutoffType) => v.id);

    // Clear all cutoff fields in one query
    await updateClanForHandleCutoff(drizzleDB, villageIds);

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
    type ClanType = (typeof allClans)[number];
    const clansToMark: { id: string; rank: number }[] = [];
    for (const [, clans] of clansByVillage) {
      const sorted = clans
        .filter((c: ClanType) => c.activityPoints > 0)
        .sort(
          (a: ClanType, b: ClanType) =>
            b.activityPoints - a.activityPoints || b.points - a.points,
        )
        .slice(0, KAGE_MAX_ELDERS);
      sorted.forEach((c: ClanType, i: number) => {
        clansToMark.push({ id: c.id, rank: i + 1 });
      });
    }

    // Batch update all eligible clans in parallel
    if (clansToMark.length > 0) {
      await Promise.all(
        clansToMark.map((c: { id: string; rank: number }) =>
          updateClanForHandleCutoff2(drizzleDB, currentMonth, currentYear, c),
        ),
      );
    }

    return Response.json(
      `OK - Elder cutoff snapshot completed for ${villages.length} villages`,
    );
  } catch (cause) {
    await timerCheck.release();
    return await handleEndpointError(cause);
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
      listVillageForHandleCutoff(drizzleDB),
      listClanForHandleRotation(drizzleDB),
      listClanForHandleRotation2(drizzleDB),
    ]);

    type VillageType = (typeof villages)[number];
    type ClanWithCutoffType = (typeof clansWithCutoff)[number];
    type AllClanType = (typeof allClans)[number];
    const villageIds = villages.map((v: VillageType) => v.id);

    // Build eligible clans per village (cutoff snapshot or fallback)
    const eligibleByVillage = new Map<string, typeof clansWithCutoff>();
    for (const villageId of villageIds) {
      const cutoffClans = clansWithCutoff
        .filter((c: ClanWithCutoffType) => c.villageId === villageId)
        .sort(
          (a: ClanWithCutoffType, b: ClanWithCutoffType) =>
            (a.elderCutoffRank ?? 0) - (b.elderCutoffRank ?? 0),
        );
      if (cutoffClans.length > 0) {
        eligibleByVillage.set(villageId, cutoffClans);
      } else {
        // Fallback to live calculation
        const fallback = allClans
          .filter((c: AllClanType) => c.villageId === villageId && c.activityPoints > 0)
          .sort(
            (a: AllClanType, b: AllClanType) =>
              b.activityPoints - a.activityPoints || b.points - a.points,
          )
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
    await updateUserDataForHandleRotation(drizzleDB, villageIds);

    // Fetch all potential nominees
    const validNominees =
      allNomineeIds.size > 0
        ? await listUserDataForHandleRotation(drizzleDB, allNomineeIds, villageIds)
        : [];

    // Build map for O(1) lookups
    type NomineeType = (typeof validNominees)[number];
    const validNomineeMap = new Map(
      validNominees.map((n: NomineeType) => [n.userId, n]),
    );

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
        ? updateUserDataForHandleRotation2(drizzleDB, toPromote)
        : Promise.resolve(),
      updateClanForHandleRotation(drizzleDB, villageIds),
    ]);

    return Response.json(`OK - Elder rotation completed`);
  } catch (cause) {
    await timerCheck.release();
    return await handleEndpointError(cause);
  }
}
