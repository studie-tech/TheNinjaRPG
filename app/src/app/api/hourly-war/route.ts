import {
  ELDER_MIN_VOTING_COUNT,
  WAR_DAILY_HEALTH_DRAIN,
  WAR_DAILY_TOKEN_DECAY_PERCENT_BASE,
  WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_5,
  WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_8,
  WAR_MAX_DURATION_DAYS,
  WAR_TOKEN_REDUCTION_INTERVAL_HOURS,
} from "@/drizzle/constants";
import { resolveElderVote, tallyElderVotes } from "@/libs/elder";
import {
  lockWithDailyTimer,
  lockWithHourlyTimer,
  runClaimedCron,
} from "@/libs/gamesettings";
import {
  fetchExpiredElderVotes,
  listVillageForProcessExpiredElderVotes,
  selectUserDataForProcessExpiredElderVotes,
} from "@/queries/elder";
import { updateVillageStructureForClearExpiredStructureBonuses } from "@/queries/village";
import {
  approvePendingWarDeclaration,
  expireWarPoints,
  listActiveWarsWithRules,
  updateWarForDailyDecay,
  updateWarVillageTokens,
} from "@/queries/war";
import {
  type FetchActiveWarsReturnType,
  fetchActiveWars,
} from "@/server/api/routers/war";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";
import { syncStrongholdMembership } from "@/server/utils/faction";
import { settleKageRemoval } from "@/server/utils/kageGovernance";
import { settleObjectiveWarSchedule, syncWarCamps } from "@/server/utils/objectiveWar";
import {
  applyRaidHealthDecay,
  handleWarEnd,
  rejectWarDeclaration,
  resumePendingWarSettlements,
  startClaimedWarDeclaration,
  warDeclarationRejectedMessage,
} from "@/server/utils/war";

const ENDPOINT_NAME = "hourly-war";
const DAILY_DECAY_TIMER = "daily-war-decay";

export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  // Check hourly timer
  const timerCheck = await lockWithHourlyTimer(drizzleDB, ENDPOINT_NAME);

  return runClaimedCron(timerCheck, "/api/hourly-war", async () => {
    const now = new Date();
    await syncStrongholdMembership(drizzleDB);
    // Replay due camp results and daily drains before settlement chooses a winner.
    const dueObjectiveWars = await listActiveWarsWithRules(drizzleDB);
    await Promise.all(
      dueObjectiveWars.map((w) => settleObjectiveWarSchedule(drizzleDB, w, now)),
    );
    // Raid deadlines and daily HP drain are checked hourly, independently of village token decay.
    const raids = (await fetchActiveWars(drizzleDB)).filter(
      (w) => w.type === "WAR_RAID",
    );
    await Promise.all(raids.map((raid) => applyRaidHealthDecay(drizzleDB, raid, now)));

    const objectiveWars = (await fetchActiveWars(drizzleDB)).filter((w) => w.rules);
    await syncWarCamps(drizzleDB, objectiveWars, now);
    await expireWarPoints(drizzleDB);

    await resumePendingWarSettlements(drizzleDB);

    // =============================================
    // DAILY TASK: Token decay and war health drain
    // =============================================
    const dailyDecayTimer = await lockWithDailyTimer(drizzleDB, DAILY_DECAY_TIMER);
    if (dailyDecayTimer.isNewDay) {
      try {
        await applyDailyWarDecay(now);
      } catch (cause) {
        await dailyDecayTimer.release();
        throw cause;
      }
    }

    // =============================================
    // HOURLY TASK: Process expired elder votes
    // =============================================
    await processExpiredElderVotes();

    // Clear expired temporary structure bonuses
    await clearExpiredStructureBonuses(now);

    return new Response("War hourly update completed", { status: 200 });
  });
}

/** Daily task: token decay on ordinary wars, with health drain following from it. */
async function applyDailyWarDecay(now: Date) {
  // fetchActiveWars is expensive (loads village structures); only fetch when needed
  const activeWars = await fetchActiveWars(drizzleDB);
  // Ordinary village wars drain treasury tokens; raid HP decay runs separately.
  const decayWars = activeWars.filter((w) => w.type === "VILLAGE_WAR" && !w.rules);

  for (const activeWar of decayWars) {
    if (!activeWar.attackerVillage || !activeWar.defenderVillage) {
      console.error("War found with missing village data:", activeWar.id);
      continue;
    }

    const { startedAt, lastTokenReductionAt } = activeWar;

    // Calculate time since last reduction
    const hoursSinceLastReduction = lastTokenReductionAt
      ? (now.getTime() - lastTokenReductionAt.getTime()) / (1000 * 60 * 60)
      : WAR_TOKEN_REDUCTION_INTERVAL_HOURS;

    // Only process if enough time has passed
    if (hoursSinceLastReduction < WAR_TOKEN_REDUCTION_INTERVAL_HOURS) {
      continue;
    }

    // Calculate number of reductions to apply
    const reductionsToApply = Math.floor(
      hoursSinceLastReduction / WAR_TOKEN_REDUCTION_INTERVAL_HOURS,
    );

    // Calculate war duration in days
    const warDuration = Math.floor(
      (now.getTime() - startedAt.getTime()) / (1000 * 60 * 60 * 24),
    );

    // Check if war has exceeded max duration (14 days) - auto-resolve
    if (warDuration >= WAR_MAX_DURATION_DAYS) {
      await handleWarEnd(activeWar, drizzleDB, { resolveByHealth: true });
      continue;
    }

    // Calculate decay percentage based on war duration
    // Day 1-4: 3%, Day 5-7: 6%, Day 8+: 10%
    let decayPercent = WAR_DAILY_TOKEN_DECAY_PERCENT_BASE;
    if (warDuration >= 8) {
      decayPercent = WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_8;
    } else if (warDuration >= 5) {
      decayPercent = WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_5;
    }

    // Calculate token reduction as percentage of current tokens
    // Apply multiple reductions if needed (but percentage is recalculated each time)
    const attackerTokensBefore = activeWar.attackerVillage.tokens;
    const defenderTokensBefore = activeWar.defenderVillage.tokens;
    for (let i = 0; i < reductionsToApply; i++) {
      const attackerReduction = Math.floor(
        activeWar.attackerVillage.tokens * (decayPercent / 100),
      );
      const defenderReduction = Math.floor(
        activeWar.defenderVillage.tokens * (decayPercent / 100),
      );

      activeWar.attackerVillage.tokens -= attackerReduction;
      activeWar.defenderVillage.tokens -= defenderReduction;
    }

    // Ensure tokens don't go negative
    activeWar.attackerVillage.tokens = Math.max(0, activeWar.attackerVillage.tokens);
    activeWar.defenderVillage.tokens = Math.max(0, activeWar.defenderVillage.tokens);

    // Calculate war health drain (applied to both sides each reduction interval)
    const totalHealthDrain = WAR_DAILY_HEALTH_DRAIN * reductionsToApply;

    // Handle war end - check tokens OR war health reaching 0
    // We need to check current war health minus the drain we're about to apply
    const attackerHealthAfterDrain = activeWar.attackerWarHealth - totalHealthDrain;
    const defenderHealthAfterDrain = activeWar.defenderWarHealth - totalHealthDrain;
    const isEnding =
      activeWar.attackerVillage.tokens <= 0 ||
      activeWar.defenderVillage.tokens <= 0 ||
      attackerHealthAfterDrain <= 0 ||
      defenderHealthAfterDrain <= 0;

    // Apply the health drain before ending war so handleWarEnd sees accurate values
    const result = await updateWarForDailyDecay(
      drizzleDB,
      totalHealthDrain,
      activeWar,
      isEnding ? undefined : now,
    );

    // Only proceed if the war update actually modified a row (guarded update)
    if (result.rowsAffected === 0) continue;

    // Apply the decay as decrements so token changes since the fetch are kept
    await Promise.all([
      updateWarVillageTokens(
        drizzleDB,
        attackerTokensBefore - activeWar.attackerVillage.tokens,
        activeWar.attackerVillage.id,
      ),
      updateWarVillageTokens(
        drizzleDB,
        defenderTokensBefore - activeWar.defenderVillage.tokens,
        activeWar.defenderVillage.id,
      ),
    ]);

    if (isEnding) {
      // Build updated war object with drained health values to avoid an extra DB roundtrip
      const warWithDrain: FetchActiveWarsReturnType = {
        ...activeWar,
        attackerWarHealth: Math.max(attackerHealthAfterDrain, 0),
        defenderWarHealth: Math.max(defenderHealthAfterDrain, 0),
      };
      await handleWarEnd(warWithDrain, drizzleDB);
    }
  }
}

/**
 * Clear expired temporary structure level bonuses from war victories/defeats
 * Handles both positive bonuses (winner) and negative bonuses (loser penalties)
 */
async function clearExpiredStructureBonuses(now: Date) {
  await updateVillageStructureForClearExpiredStructureBonuses(drizzleDB, now);
}

/**
 * Process elder votes whose deadline has passed.
 * - WAR_DECLARATION: if vote still PENDING after 24h, auto-approve and start the war
 *   (as per: "if elders do not vote, the war starts anyway")
 * - KAGE_REMOVAL: if majority YES when deadline passes, execute removal
 */
async function processExpiredElderVotes() {
  // Pre-fetch all required data before the loop to avoid DB roundtrips inside it
  const [expiredVotes, allElders, allVillages, activeWars] = await Promise.all([
    fetchExpiredElderVotes(drizzleDB),
    selectUserDataForProcessExpiredElderVotes(drizzleDB),
    listVillageForProcessExpiredElderVotes(drizzleDB),
    fetchActiveWars(drizzleDB),
  ]);
  if (expiredVotes.length === 0) return;

  const eldersByVillage = new Map<string, string[]>();
  for (const elder of allElders) {
    if (!elder.villageId) continue;
    const list = eldersByVillage.get(elder.villageId) ?? [];
    list.push(elder.userId);
    eldersByVillage.set(elder.villageId, list);
  }
  const villagesById = new Map(allVillages.map((v) => [v.id, v]));

  // Build a promise per vote and run all in parallel
  const promises: Promise<unknown>[] = [];
  for (const vote of expiredVotes) {
    if (vote.type === "WAR_DECLARATION") {
      const villageElderIds = eldersByVillage.get(vote.villageId) ?? [];
      const elderCount = villageElderIds.filter(
        (userId) => userId !== vote.initiatedByUserId,
      ).length;
      const { yes, no } = tallyElderVotes(vote.entries);
      const outcome = resolveElderVote(yes, no, elderCount, true, true);
      promises.push(
        handleExpiredWarDeclaration(
          vote,
          outcome,
          elderCount,
          villagesById,
          activeWars,
        ),
      );
    } else if (vote.type === "KAGE_REMOVAL") {
      // Same electorate, tenure guards and atomic outcome as live votes.
      promises.push(settleKageRemoval(drizzleDB, vote.id, true));
    }
  }
  await Promise.all(promises);
}

/**
 * Handle a single expired WAR_DECLARATION vote.
 * Villages and active wars are pre-fetched to avoid extra DB roundtrips.
 */
async function handleExpiredWarDeclaration(
  vote: ExpiredElderVote,
  outcome: ReturnType<typeof resolveElderVote>,
  elderCount: number,
  villagesById: Map<string, VillageSnapshot>,
  activeWars: FetchActiveWarsReturnType[],
) {
  const defenderVillage = villagesById.get(vote.targetId);
  const attackerVillage = villagesById.get(vote.villageId);
  const defenderName = defenderVillage?.name ?? "another village";

  if (outcome === "REJECTED") {
    await rejectWarDeclaration(
      drizzleDB,
      vote,
      warDeclarationRejectedMessage(defenderVillage?.name),
      "PENDING",
    );
    return;
  }

  if (elderCount < ELDER_MIN_VOTING_COUNT) {
    await rejectWarDeclaration(
      drizzleDB,
      vote,
      `War declaration against ${defenderName} was cancelled — not enough elders in position.`,
      "PENDING",
    );
    return;
  }

  // APPROVED → atomically claim the motion, then start war
  const warClaimResult = await approvePendingWarDeclaration(drizzleDB, vote.id);
  if (warClaimResult.rowsAffected === 0) return;

  await startClaimedWarDeclaration(drizzleDB, vote, {
    attackerVillage,
    defenderVillage,
    activeWars,
  });
}

type ExpiredElderVote = Awaited<ReturnType<typeof fetchExpiredElderVotes>>[number];
type VillageSnapshot = {
  id: string;
  name: string;
  kageId: string | null;
  tokens: number;
};
