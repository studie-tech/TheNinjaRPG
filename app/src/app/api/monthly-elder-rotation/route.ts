import {
  ELDER_NOMINATION_CUTOFF_DAY,
  ELDER_NOMINATION_DEADLINE_DAY,
} from "@/drizzle/constants";
import { rankElderCandidates, resolveElderRotation } from "@/libs/elder";
import { lockWithMonthlyTimer, runClaimedCron } from "@/libs/gamesettings";
import {
  insertActionLogForHandleRotation,
  listClanForHandleCutoff,
  listClanForHandleRotation,
  listUserDataForHandleRotation,
  listUserDataForHandleRotationElders,
  listVillageForHandleCutoff,
  updateClanForHandleCutoff,
  updateClanForHandleCutoff2,
  updateClanForHandleRotation,
  updateUserDataForHandleRotation,
  updateUserDataForHandleRotation2,
} from "@/queries/elder";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";

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

  return runClaimedCron(timerCheck, "/api/monthly-elder-rotation", async () => {
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
    const clansToMark: { id: string; rank: number }[] = [];
    for (const [, clans] of clansByVillage) {
      rankElderCandidates(clans).forEach((c, i) => {
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
  });
}

/**
 * Rotation handler - runs on ELDER_NOMINATION_DEADLINE_DAY (28th) to promote elders and reset points
 * By this time nominations have closed, so nominees are final and ready for promotion.
 */
async function handleRotation() {
  const timerCheck = await lockWithMonthlyTimer(drizzleDB, "monthly-elder-rotation");

  return runClaimedCron(timerCheck, "/api/monthly-elder-rotation", async () => {
    // Fetch all data in parallel
    const [villages, allClans] = await Promise.all([
      listVillageForHandleCutoff(drizzleDB),
      listClanForHandleRotation(drizzleDB),
    ]);

    type VillageType = (typeof villages)[number];
    type ClanType = (typeof allClans)[number];
    const villageIds = villages.map((v: VillageType) => v.id);

    // Build eligible clans per village (cutoff snapshot or fallback)
    const eligibleByVillage = new Map<string, typeof allClans>();
    for (const villageId of villageIds) {
      const villageClans = allClans.filter((c: ClanType) => c.villageId === villageId);
      const cutoffClans = villageClans
        .filter((c: ClanType) => c.elderCutoffRank !== null)
        .sort(
          (a: ClanType, b: ClanType) =>
            (a.elderCutoffRank ?? 0) - (b.elderCutoffRank ?? 0),
        );
      if (cutoffClans.length > 0) {
        eligibleByVillage.set(villageId, cutoffClans);
      } else {
        // Fallback to live calculation
        eligibleByVillage.set(villageId, rankElderCandidates(villageClans));
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

    // The log rows must commit with the rank changes and the nominee reset they
    // explain: the reset erases the only other record of who was nominated, and no
    // single statement spans UserData, Clan and ActionLog.
    await retryOnDeadlock(() =>
      drizzleDB.transaction(async (tx) => {
        const elders = await listUserDataForHandleRotationElders(tx, villageIds);

        // Demote all elders first (must complete before nominee fetch so re-nominated elders pass JONIN check)
        await updateUserDataForHandleRotation(tx, villageIds);

        // Fetch all potential nominees
        const nominees =
          allNomineeIds.size > 0
            ? await listUserDataForHandleRotation(tx, allNomineeIds)
            : [];

        // Determine all users to promote and the log of what happened to everyone
        const { toPromote, logs } = resolveElderRotation(
          elders,
          [...eligibleByVillage.values()].flat(),
          nominees,
        );

        // Batch promote all valid nominees, reset clan fields and log the outcome
        await Promise.all([
          toPromote.length > 0
            ? updateUserDataForHandleRotation2(tx, toPromote)
            : Promise.resolve(),
          updateClanForHandleRotation(tx, villageIds),
          logs.length > 0
            ? insertActionLogForHandleRotation(tx, logs)
            : Promise.resolve(),
        ]);
      }),
    );

    return Response.json(`OK - Elder rotation completed`);
  });
}
