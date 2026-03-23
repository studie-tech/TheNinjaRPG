import { and, eq, gte, inArray, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";
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
  quest,
  questHistory,
  userData,
  village,
  villageElderVote,
  villageStructure,
  war,
} from "@/drizzle/schema";
import {
  getGameSetting,
  handleEndpointError,
  lockWithHourlyTimer,
  updateGameSetting,
} from "@/libs/gamesettings";
import { handleWarEnd } from "@/libs/war";
import { fetchKageReplacement } from "@/server/api/routers/kage";
import type { FetchActiveWarsReturnType } from "@/server/api/routers/war";
import {
  fetchActiveWars,
  fetchExpiredElderVotes,
  resolveElderVote,
} from "@/server/api/routers/war";
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

      // Refetch active wars after decay since handleWarEnd might have been called
      activeWars = await fetchActiveWars(drizzleDB);
    }

    // =============================================
    // HOURLY TASK: Process expired elder votes
    // =============================================
    await processExpiredElderVotes();

    // =============================================
    // HOURLY TASK: Assign war quests to users in active wars
    // =============================================
    if (activeWars.length > 0) {
      await assignWarQuests(activeWars);
    }

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
 * Assign war quests to users in active wars who don't have one already
 */
async function assignWarQuests(
  activeWars: Awaited<ReturnType<typeof fetchActiveWars>>,
) {
  // Get all village IDs involved in active wars
  const villageIds = [
    ...new Set(
      activeWars.flatMap((w) => [
        w.attackerVillageId,
        w.defenderVillageId,
        ...w.warAllies.map((a) => a.villageId),
      ]),
    ),
  ];

  if (villageIds.length === 0) return;

  // Fetch war quests and users without active war quests in parallel
  const [warQuests, usersWithoutWarQuest] = await Promise.all([
    drizzleDB.query.quest.findMany({
      where: and(
        eq(quest.questType, "war"),
        isNotNull(quest.content),
        eq(quest.hidden, false),
      ),
    }),
    // Get users in war villages who don't have an active war quest
    drizzleDB
      .select({
        userId: userData.userId,
        rank: userData.rank,
        level: userData.level,
        villageId: userData.villageId,
      })
      .from(userData)
      .leftJoin(
        questHistory,
        and(
          eq(questHistory.userId, userData.userId),
          eq(questHistory.questType, "war"),
          eq(questHistory.completed, 0),
          isNull(questHistory.endAt),
        ),
      )
      .where(
        and(
          inArray(userData.villageId, villageIds),
          eq(userData.isAi, false),
          isNull(questHistory.id), // No active war quest
        ),
      ),
  ]);

  if (warQuests.length === 0 || usersWithoutWarQuest.length === 0) return;

  // For each user, find an applicable war quest and assign it
  const questAssignments: {
    id: string;
    userId: string;
    questId: string;
    questType: "war";
  }[] = [];

  for (const user of usersWithoutWarQuest) {
    const questRanks = availableQuestLetterRanks(user.rank);

    // Find an applicable quest for this user
    const applicableQuest = [...warQuests]
      .sort(() => Math.random() - 0.5)
      .find(
        (q) =>
          questRanks.includes(q.questRank) &&
          (!q.requiredVillage || q.requiredVillage === user.villageId) &&
          q.requiredLevel <= user.level &&
          q.maxLevel >= user.level,
      );

    if (applicableQuest) {
      questAssignments.push({
        id: nanoid(),
        userId: user.userId,
        questId: applicableQuest.id,
        questType: "war",
      });
    }
  }

  // Bulk insert all quest assignments
  if (questAssignments.length > 0) {
    await drizzleDB
      .insert(questHistory)
      .values(questAssignments)
      .onDuplicateKeyUpdate({
        set: { completed: 0, endAt: null, startedAt: new Date() },
      });
  }
}

/**
 * Process elder votes whose deadline has passed.
 * - WAR_DECLARATION: if vote still PENDING after 24h, auto-approve and start the war
 *   (as per: "if elders do not vote, the war starts anyway")
 * - KAGE_REMOVAL: if majority YES when deadline passes, execute removal
 */
async function processExpiredElderVotes() {
  const expiredVotes = await fetchExpiredElderVotes(drizzleDB);
  if (expiredVotes.length === 0) return;

  for (const vote of expiredVotes) {
    if (vote.type === "WAR_DECLARATION") {
      // Count eligible elders (not the initiator who is the kage)
      const elderCount = await drizzleDB
        .select({ count: sql<number>`count(*)` })
        .from(userData)
        .where(
          and(
            eq(userData.villageId, vote.villageId),
            eq(userData.rank, "ELDER"),
            eq(userData.isAi, false),
            ne(userData.userId, vote.initiatedByUserId),
          ),
        )
        .then(([r]) => r?.count ?? 0);

      const yesCount = vote.entries.filter((e) => e.vote === "YES").length;
      const noCount = vote.entries.filter((e) => e.vote === "NO").length;
      const outcome = resolveElderVote(yesCount, noCount, elderCount);

      // If decisively rejected, mark as rejected and notify elders
      if (outcome === "REJECTED") {
        const targetVillage = await drizzleDB.query.village.findFirst({
          columns: { name: true },
          where: eq(village.id, vote.targetId),
        });
        await Promise.all([
          drizzleDB
            .update(villageElderVote)
            .set({ status: "REJECTED" })
            .where(eq(villageElderVote.id, vote.id)),
          drizzleDB.insert(notification).values({
            userId: vote.initiatedByUserId,
            content: `War declaration against ${targetVillage?.name ?? "another village"} was rejected by the elders.`,
          }),
          drizzleDB
            .update(userData)
            .set({ unreadNotifications: sql`unreadNotifications + 1` })
            .where(eq(userData.villageId, vote.villageId)),
        ]);
        continue;
      }

      // Block auto-approval if village no longer has minimum elder count
      if (elderCount < ELDER_MIN_VOTING_COUNT) {
        const targetVillage = await drizzleDB.query.village.findFirst({
          columns: { name: true },
          where: eq(village.id, vote.targetId),
        });
        await Promise.all([
          drizzleDB
            .update(villageElderVote)
            .set({ status: "REJECTED" })
            .where(eq(villageElderVote.id, vote.id)),
          drizzleDB.insert(notification).values({
            userId: vote.initiatedByUserId,
            content: `War declaration against ${targetVillage?.name ?? "another village"} was cancelled — not enough elders in position.`,
          }),
          drizzleDB
            .update(userData)
            .set({ unreadNotifications: sql`unreadNotifications + 1` })
            .where(eq(userData.villageId, vote.villageId)),
        ]);
        continue;
      }

      // APPROVED or PENDING (no blocking majority) → auto-start war
      const [attackerVillage, defenderVillage] = await Promise.all([
        drizzleDB.query.village.findFirst({ where: eq(village.id, vote.villageId) }),
        drizzleDB.query.village.findFirst({
          columns: { name: true },
          where: eq(village.id, vote.targetId),
        }),
      ]);
      if (!attackerVillage || attackerVillage.tokens < WAR_DECLARATION_COST) {
        await drizzleDB
          .update(villageElderVote)
          .set({ status: "REJECTED" })
          .where(eq(villageElderVote.id, vote.id));
        continue;
      }

      // Deduct tokens first with DB guard — if this fails, war is never inserted
      const tokenResult = await drizzleDB
        .update(village)
        .set({ tokens: sql`${village.tokens} - ${WAR_DECLARATION_COST}` })
        .where(
          and(
            eq(village.id, vote.villageId),
            gte(village.tokens, WAR_DECLARATION_COST),
          ),
        );
      if (tokenResult.rowsAffected === 0) {
        await drizzleDB
          .update(villageElderVote)
          .set({ status: "REJECTED" })
          .where(eq(villageElderVote.id, vote.id));
        continue;
      }
      const warId = nanoid();
      const warContent = `${attackerVillage.name} has declared war on ${defenderVillage?.name ?? "another village"}!`;
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
          .update(villageElderVote)
          .set({ status: "APPROVED" })
          .where(eq(villageElderVote.id, vote.id)),
        drizzleDB
          .insert(notification)
          .values({ userId: vote.initiatedByUserId, content: warContent }),
        drizzleDB
          .update(userData)
          .set({ unreadNotifications: sql`unreadNotifications + 1` })
          .where(inArray(userData.villageId, [vote.villageId, vote.targetId])),
      ]);
    } else if (vote.type === "KAGE_REMOVAL") {
      // Count eligible elders (not the kage being removed)
      const elderCount = await drizzleDB
        .select({ count: sql<number>`count(*)` })
        .from(userData)
        .where(
          and(
            eq(userData.villageId, vote.villageId),
            eq(userData.rank, "ELDER"),
            eq(userData.isAi, false),
            ne(userData.userId, vote.targetId),
          ),
        )
        .then(([r]) => r?.count ?? 0);

      const yesCount = vote.entries.filter((e) => e.vote === "YES").length;
      const noCount = vote.entries.filter((e) => e.vote === "NO").length;
      const outcome = resolveElderVote(yesCount, noCount, elderCount);

      if (outcome === "APPROVED") {
        const replacement = await fetchKageReplacement(
          drizzleDB,
          vote.villageId,
          vote.targetId,
        );
        if (!replacement) {
          await Promise.all([
            drizzleDB
              .update(villageElderVote)
              .set({ status: "REJECTED" })
              .where(eq(villageElderVote.id, vote.id)),
            drizzleDB
              .update(userData)
              .set({ unreadNotifications: sql`unreadNotifications + 1` })
              .where(
                and(
                  eq(userData.villageId, vote.villageId),
                  eq(userData.rank, "ELDER"),
                  eq(userData.isAi, false),
                ),
              ),
          ]);
          continue;
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
          drizzleDB
            .update(village)
            .set({ kageId: replacement.userId, leaderUpdatedAt: new Date() })
            .where(eq(village.id, vote.villageId)),
          drizzleDB
            .update(villageElderVote)
            .set({ status: "APPROVED" })
            .where(eq(villageElderVote.id, vote.id)),
          // Notify the removed kage
          drizzleDB.insert(notification).values({
            userId: vote.targetId,
            content: `You have been removed as Kage by the Elder Council. ${replacement.username} is the new Kage.`,
          }),
          // Notify the new kage
          drizzleDB.insert(notification).values({
            userId: replacement.userId,
            content: `You have been appointed as the new Kage following the removal of ${removedKage?.username ?? "the previous Kage"}.`,
          }),
          // Increment unread notifications for both
          drizzleDB
            .update(userData)
            .set({ unreadNotifications: sql`unreadNotifications + 1` })
            .where(inArray(userData.userId, [vote.targetId, replacement.userId])),
          // Notify all elders
          drizzleDB
            .update(userData)
            .set({ unreadNotifications: sql`unreadNotifications + 1` })
            .where(
              and(
                eq(userData.villageId, vote.villageId),
                eq(userData.rank, "ELDER"),
                eq(userData.isAi, false),
              ),
            ),
        ]);
      } else {
        await Promise.all([
          drizzleDB
            .update(villageElderVote)
            .set({ status: "REJECTED" })
            .where(eq(villageElderVote.id, vote.id)),
          // Notify all elders that the vote failed
          drizzleDB
            .update(userData)
            .set({ unreadNotifications: sql`unreadNotifications + 1` })
            .where(
              and(
                eq(userData.villageId, vote.villageId),
                eq(userData.rank, "ELDER"),
                eq(userData.isAi, false),
              ),
            ),
        ]);
      }
    }
  }
}
