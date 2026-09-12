import { and, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { cookies } from "next/headers";
import {
  ELDER_MIN_VOTING_COUNT,
  WAR_DAILY_HEALTH_DRAIN,
  WAR_DAILY_TOKEN_DECAY_PERCENT_BASE,
  WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_5,
  WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_8,
  WAR_DECLARATION_COST,
  WAR_MAX_DURATION_DAYS,
  WAR_RAID_SHRINE_HP,
  WAR_TOKEN_REDUCTION_INTERVAL_HOURS,
} from "@/drizzle/constants";
import {
  notification,
  userData,
  village,
  villageElderVote,
  villageStructure,
  war,
} from "@/drizzle/schema";
import { fetchExpiredElderVotes, resolveElderVote } from "@/libs/elder";
import {
  getGameSetting,
  handleEndpointError,
  lockWithHourlyTimer,
  updateGameSetting,
} from "@/libs/gamesettings";
import { handleWarEnd, isVillageInvolvedInAnyWar } from "@/libs/war";
import { fetchKageReplacement } from "@/server/api/routers/kage";
import type { FetchActiveWarsReturnType } from "@/server/api/routers/war";
import { fetchActiveWars } from "@/server/api/routers/war";
import { drizzleDB } from "@/server/db";

const ENDPOINT_NAME = "hourly-war";
const DAILY_DECAY_TIMER = "daily-war-decay";

export async function GET() {
  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  // Check hourly timer
  const timerCheck = await lockWithHourlyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewHour && timerCheck.response) return timerCheck.response;

  try {
    const now = new Date();

    // Check if daily decay should run (separate from hourly tasks)
    const dailyDecayTimer = await getGameSetting(drizzleDB, DAILY_DECAY_TIMER);
    const nowUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const prevUTC = Date.UTC(
      dailyDecayTimer.time.getUTCFullYear(),
      dailyDecayTimer.time.getUTCMonth(),
      dailyDecayTimer.time.getUTCDate(),
    );
    const shouldRunDailyDecay = nowUTC !== prevUTC;

    // =============================================
    // DAILY TASK: Token decay and war health drain
    // =============================================
    if (shouldRunDailyDecay) {
      // fetchActiveWars is expensive (loads village structures); only fetch when needed
      const activeWars = await fetchActiveWars(drizzleDB);
      // Filter to VILLAGE_WAR and WAR_RAID for decay (include Outlaws/Factions)
      const decayWars = activeWars.filter((w) =>
        ["VILLAGE_WAR", "WAR_RAID"].includes(w.type),
      );

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
          await handleWarEnd(activeWar);
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
        activeWar.attackerVillage.tokens = Math.max(
          0,
          activeWar.attackerVillage.tokens,
        );
        activeWar.defenderVillage.tokens = Math.max(
          0,
          activeWar.defenderVillage.tokens,
        );

        // Calculate war health drain (applied to both sides each reduction interval)
        const totalHealthDrain = WAR_DAILY_HEALTH_DRAIN * reductionsToApply;

        // Handle war end - check tokens OR war health reaching 0
        // We need to check current war health minus the drain we're about to apply
        const attackerHealthAfterDrain = activeWar.attackerWarHealth - totalHealthDrain;
        const defenderHealthAfterDrain = activeWar.defenderWarHealth - totalHealthDrain;

        if (
          activeWar.attackerVillage.tokens <= 0 ||
          activeWar.defenderVillage.tokens <= 0 ||
          attackerHealthAfterDrain <= 0 ||
          defenderHealthAfterDrain <= 0
        ) {
          // Apply the health drain before ending war so handleWarEnd sees accurate values
          const result = await drizzleDB
            .update(war)
            .set({
              attackerWarHealth: sql`GREATEST(attackerWarHealth - ${totalHealthDrain}, 0)`,
              defenderWarHealth: sql`GREATEST(defenderWarHealth - ${totalHealthDrain}, 0)`,
            })
            .where(and(eq(war.id, activeWar.id), isNull(war.endedAt)));

          // Only proceed if the war update actually modified a row (guarded update)
          if (result.rowsAffected > 0) {
            // Update token counts
            await Promise.all([
              drizzleDB
                .update(village)
                .set({ tokens: activeWar.attackerVillage.tokens })
                .where(eq(village.id, activeWar.attackerVillage.id)),
              drizzleDB
                .update(village)
                .set({ tokens: activeWar.defenderVillage.tokens })
                .where(eq(village.id, activeWar.defenderVillage.id)),
            ]);

            // Build updated war object with drained health values to avoid an extra DB roundtrip
            const warWithDrain: FetchActiveWarsReturnType = {
              ...activeWar,
              attackerWarHealth: Math.max(
                activeWar.attackerWarHealth - totalHealthDrain,
                0,
              ),
              defenderWarHealth: Math.max(
                activeWar.defenderWarHealth - totalHealthDrain,
                0,
              ),
            };
            await handleWarEnd(warWithDrain);
          }
          continue;
        }

        // Update token counts, war health drain, and last reduction time
        const result = await drizzleDB
          .update(war)
          .set({
            lastTokenReductionAt: now,
            attackerWarHealth: sql`GREATEST(attackerWarHealth - ${totalHealthDrain}, 0)`,
            defenderWarHealth: sql`GREATEST(defenderWarHealth - ${totalHealthDrain}, 0)`,
          })
          .where(and(eq(war.id, activeWar.id), isNull(war.endedAt)));

        if (result.rowsAffected > 0) {
          await Promise.all([
            drizzleDB
              .update(village)
              .set({ tokens: activeWar.attackerVillage.tokens })
              .where(eq(village.id, activeWar.attackerVillage.id)),
            drizzleDB
              .update(village)
              .set({ tokens: activeWar.defenderVillage.tokens })
              .where(eq(village.id, activeWar.defenderVillage.id)),
          ]);
        }
      }

      // Update daily decay timer
      await updateGameSetting(drizzleDB, DAILY_DECAY_TIMER, 0, now);
    }

    // =============================================
    // HOURLY TASK: Process expired elder votes
    // =============================================
    await processExpiredElderVotes();

    // Clear expired temporary structure bonuses
    await clearExpiredStructureBonuses(now);

    return new Response("War hourly update completed", { status: 200 });
  } catch (cause) {
    // Rollback
    await updateGameSetting(drizzleDB, ENDPOINT_NAME, 0, timerCheck.prevTime);
    return await handleEndpointError(cause);
  }
}

/**
 * Clear expired temporary structure level bonuses from war victories/defeats
 * Handles both positive bonuses (winner) and negative bonuses (loser penalties)
 */
async function clearExpiredStructureBonuses(now: Date) {
  await drizzleDB
    .update(villageStructure)
    .set({
      temporaryLevelBonus: 0,
      temporaryLevelBonusExpiresAt: null,
    })
    .where(
      and(
        isNotNull(villageStructure.temporaryLevelBonusExpiresAt),
        lt(villageStructure.temporaryLevelBonusExpiresAt, now),
      ),
    );
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
    drizzleDB
      .select({ userId: userData.userId, villageId: userData.villageId })
      .from(userData)
      .where(and(eq(userData.rank, "ELDER"), eq(userData.isAi, false))),
    drizzleDB.query.village.findMany({
      columns: { id: true, name: true, kageId: true, tokens: true },
    }),
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
  const promises: Promise<void>[] = [];
  for (const vote of expiredVotes) {
    if (vote.type === "WAR_DECLARATION") {
      const villageElderIds = eldersByVillage.get(vote.villageId) ?? [];
      const elderCount = villageElderIds.filter(
        (userId) => userId !== vote.initiatedByUserId,
      ).length;
      const yesCount = vote.entries.filter((e) => e.vote === "YES").length;
      const noCount = vote.entries.filter((e) => e.vote === "NO").length;
      const outcome = resolveElderVote(yesCount, noCount, elderCount, true, true);
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
      const villageElderIds = eldersByVillage.get(vote.villageId) ?? [];
      const elderCount = villageElderIds.filter(
        (userId) => userId !== vote.targetId,
      ).length;
      const yesCount = vote.entries.filter((e) => e.vote === "YES").length;
      const noCount = vote.entries.filter((e) => e.vote === "NO").length;
      const outcome = resolveElderVote(yesCount, noCount, elderCount, true);
      promises.push(handleExpiredKageRemoval(vote, outcome));
    }
  }
  await Promise.all(promises);
}

type ExpiredElderVote = Awaited<ReturnType<typeof fetchExpiredElderVotes>>[number];
type VillageSnapshot = {
  id: string;
  name: string;
  kageId: string | null;
  tokens: number;
};

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

  const rejectWithNotification = async (content: string) => {
    await Promise.all([
      drizzleDB
        .update(villageElderVote)
        .set({ status: "REJECTED" })
        .where(eq(villageElderVote.id, vote.id)),
      drizzleDB
        .insert(notification)
        .values({ userId: vote.initiatedByUserId, content }),
      drizzleDB
        .update(userData)
        .set({ unreadNotifications: sql`unreadNotifications + 1` })
        .where(eq(userData.userId, vote.initiatedByUserId)),
    ]);
  };

  if (outcome === "REJECTED") {
    await rejectWithNotification(
      `War declaration against ${defenderName} was rejected by the elders.`,
    );
    return;
  }

  if (elderCount < ELDER_MIN_VOTING_COUNT) {
    await rejectWithNotification(
      `War declaration against ${defenderName} was cancelled — not enough elders in position.`,
    );
    return;
  }

  // APPROVED → atomically claim the motion, then start war
  const warClaimResult = await drizzleDB
    .update(villageElderVote)
    .set({ status: "APPROVED" })
    .where(
      and(eq(villageElderVote.id, vote.id), eq(villageElderVote.status, "PENDING")),
    );
  if (warClaimResult.rowsAffected === 0) return;

  if (!attackerVillage || attackerVillage.tokens < WAR_DECLARATION_COST) {
    await rejectWithNotification(
      `War declaration against ${defenderName} was cancelled — village no longer has enough tokens.`,
    );
    return;
  }

  // Use pre-fetched active wars for involvement check
  if (
    isVillageInvolvedInAnyWar(activeWars, vote.villageId, undefined, [
      "VILLAGE_WAR",
      "WAR_RAID",
    ]) ||
    isVillageInvolvedInAnyWar(activeWars, vote.targetId, undefined, [
      "VILLAGE_WAR",
      "WAR_RAID",
    ])
  ) {
    await rejectWithNotification(
      `War declaration against ${defenderName} was cancelled — a village is already involved in an active war.`,
    );
    return;
  }

  // Deduct tokens with DB guard — if this fails, war is never inserted
  const tokenResult = await drizzleDB
    .update(village)
    .set({ tokens: sql`${village.tokens} - ${WAR_DECLARATION_COST}` })
    .where(
      and(eq(village.id, vote.villageId), gte(village.tokens, WAR_DECLARATION_COST)),
    );
  if (tokenResult.rowsAffected === 0) {
    await rejectWithNotification(
      `War declaration against ${defenderName} was cancelled — the village no longer has enough tokens.`,
    );
    return;
  }

  const warId = nanoid();
  const warContent = `${attackerVillage.name} has declared war on ${defenderName}!`;
  const notifyKageIds = [vote.initiatedByUserId];
  if (defenderVillage?.kageId) notifyKageIds.push(defenderVillage.kageId);
  await Promise.all([
    drizzleDB.insert(war).values({
      id: warId,
      attackerVillageId: vote.villageId,
      defenderVillageId: vote.targetId,
      status: "ACTIVE",
      type: vote.warType ?? "VILLAGE_WAR",
      targetStructureRoute: vote.targetStructureRoute ?? "/townhall",
      attackerShrineHp: WAR_RAID_SHRINE_HP,
      attackerShrineMaxHp: WAR_RAID_SHRINE_HP,
      attackerShrineStatus: "ACTIVE",
      defenderShrineHp: WAR_RAID_SHRINE_HP,
      defenderShrineMaxHp: WAR_RAID_SHRINE_HP,
      defenderShrineStatus: "ACTIVE",
    }),
    drizzleDB
      .insert(notification)
      .values(notifyKageIds.map((userId) => ({ userId, content: warContent }))),
    drizzleDB
      .update(userData)
      .set({ unreadNotifications: sql`unreadNotifications + 1` })
      .where(inArray(userData.userId, notifyKageIds)),
  ]);
}

/**
 * Handle a single expired KAGE_REMOVAL vote.
 */
async function handleExpiredKageRemoval(
  vote: ExpiredElderVote,
  outcome: ReturnType<typeof resolveElderVote>,
) {
  if (outcome === "APPROVED") {
    // Atomically claim the motion first — only one concurrent request proceeds to side effects
    const kageClaimResult = await drizzleDB
      .update(villageElderVote)
      .set({ status: "APPROVED" })
      .where(
        and(eq(villageElderVote.id, vote.id), eq(villageElderVote.status, "PENDING")),
      );
    if (kageClaimResult.rowsAffected === 0) return;

    const replacement = await fetchKageReplacement(
      drizzleDB,
      vote.villageId,
      vote.targetId,
    );
    if (!replacement) {
      const voterIds = vote.entries.map((e) => e.userId);
      await Promise.all([
        drizzleDB
          .update(villageElderVote)
          .set({ status: "REJECTED" })
          .where(
            and(
              eq(villageElderVote.id, vote.id),
              eq(villageElderVote.status, "APPROVED"),
            ),
          ),
        ...voterIds.map((userId) =>
          drizzleDB.insert(notification).values({
            userId,
            content: `The vote to remove the Kage passed but no eligible replacement elder was found.`,
          }),
        ),
        ...(voterIds.length > 0
          ? [
              drizzleDB
                .update(userData)
                .set({ unreadNotifications: sql`unreadNotifications + 1` })
                .where(inArray(userData.userId, voterIds)),
            ]
          : []),
      ]);
      return;
    }

    // Guarded village update — only succeeds if the target is still the current kage
    const villageUpdateResult = await drizzleDB
      .update(village)
      .set({ kageId: replacement.userId, leaderUpdatedAt: new Date() })
      .where(and(eq(village.id, vote.villageId), eq(village.kageId, vote.targetId)));
    if (villageUpdateResult.rowsAffected === 0) {
      // Kage already changed via another path — revert our APPROVED claim
      await drizzleDB
        .update(villageElderVote)
        .set({ status: "REJECTED" })
        .where(
          and(
            eq(villageElderVote.id, vote.id),
            eq(villageElderVote.status, "APPROVED"),
          ),
        );
      return;
    }

    const removedKage = await drizzleDB.query.userData.findFirst({
      columns: { username: true },
      where: eq(userData.userId, vote.targetId),
    });
    await Promise.all([
      drizzleDB
        .update(userData)
        .set({ villagePrestige: 0 })
        .where(eq(userData.userId, vote.targetId)),
      drizzleDB.insert(notification).values({
        userId: vote.targetId,
        content: `You have been removed as Kage by the Elder Council. ${replacement.username} is the new Kage.`,
      }),
      drizzleDB.insert(notification).values({
        userId: replacement.userId,
        content: `You have been appointed as the new Kage following the removal of ${removedKage?.username ?? "the previous Kage"}.`,
      }),
      ...vote.entries
        .filter((e) => e.userId !== vote.targetId && e.userId !== replacement.userId)
        .map((e) =>
          drizzleDB.insert(notification).values({
            userId: e.userId,
            content: `The vote to remove the Kage has passed. ${replacement.username} is the new Kage.`,
          }),
        ),
      drizzleDB
        .update(userData)
        .set({ unreadNotifications: sql`unreadNotifications + 1` })
        .where(
          inArray(userData.userId, [
            vote.targetId,
            replacement.userId,
            ...vote.entries.map((e) => e.userId),
          ]),
        ),
    ]);
  } else {
    const voterIds = vote.entries.map((e) => e.userId);
    await Promise.all([
      drizzleDB
        .update(villageElderVote)
        .set({ status: "REJECTED" })
        .where(eq(villageElderVote.id, vote.id)),
      ...voterIds.map((userId) =>
        drizzleDB.insert(notification).values({
          userId,
          content: `The vote to remove the Kage did not pass.`,
        }),
      ),
      ...(voterIds.length > 0
        ? [
            drizzleDB
              .update(userData)
              .set({ unreadNotifications: sql`unreadNotifications + 1` })
              .where(inArray(userData.userId, voterIds)),
          ]
        : []),
    ]);
  }
}
