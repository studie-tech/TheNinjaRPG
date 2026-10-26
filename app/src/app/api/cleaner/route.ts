import { TRPCError } from "@trpc/server";
import { and, eq, isNotNull, isNull, lt, lte, notExists, sql } from "drizzle-orm";
import { MODERATION_SCAN_RETENTION_DAYS } from "@/drizzle/constants";
import {
  anbuSquad,
  automatedModeration,
  battle,
  battleAction,
  battleHistory,
  captcha,
  clan,
  conversation,
  conversationComment,
  dailyBankInterest,
  dataBattleAction,
  historicalAvatar,
  historicalIp,
  huntingSession,
  moderationScan,
  mpvpBattleQueue,
  mpvpBattleUser,
  questHistory,
  rankedPvpQueue,
  trainingLog,
  userActivityEvent,
  userData,
  userDataJob,
  userLiveActivity,
  userRequest,
  village,
  warAlly,
  warKill,
} from "@/drizzle/schema";
import { combatEnergyRecoverySql } from "@/libs/combat/database";
import { cleanupContentProposals } from "@/libs/contentReview/cleanup";
import {
  handleEndpointError,
  lockWithDailyTimer,
  lockWithHourlyTimer,
} from "@/libs/gamesettings";
import { cleanupExpiredExclusiveRaids } from "@/routers/raids";
import { completeExpiredGlobalTravel } from "@/routers/travel";
import { drizzleDB } from "@/server/db";
import { processAccountDeletions } from "@/server/utils/accountDeletion/process";
import { cleanupOrphanRows, deleteCleanupCandidates } from "@/server/utils/cleaner";
import { authenticateCronRequest } from "@/server/utils/cron";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { resumeBracketImmunitySql } from "@/server/utils/objectiveWar";
import { reconcileFederalStatuses } from "@/server/utils/purchases/grant";
import { removeExpiredSanctionTombstones } from "@/server/utils/sanctionTombstone";
import { enqueueUserDataJob, processUserDataJobs } from "@/server/utils/userDataJobs";
import { getBankInterestDateRange, secondsFromNow } from "@/utils/time";

const HOURLY_TIMER_NAME = "cleaner-hourly";

export const maxDuration = 300;

/** Run cron-authenticated hourly cleanup, claiming daily maintenance separately. */
export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  const cleanerTimer = await lockWithHourlyTimer(drizzleDB, HOURLY_TIMER_NAME);
  if (!cleanerTimer.isNewHour) return cleanerTimer.response;

  try {
    // Range deletes use indexed ordering and a bounded batch so one large
    // backlog cannot consume the entire route execution window.
    const rangeCleanupBatchSize = 10_000;

    // Step 1: Delete from battle table where updatedAt is older than 1 day
    await drizzleDB
      .delete(battle)
      .where(lt(battle.updatedAt, sql`CURRENT_TIMESTAMP(3) - INTERVAL 1 DAY`))
      .orderBy(battle.updatedAt)
      .limit(rangeCleanupBatchSize);

    // Step 1b: Release hunting reservations whose battle is gone. Settlement clears the
    // reservation with the battle, but an abandoned hunt only expires through Step 1;
    // a dangling battleId would trap the hunter.
    await retryOnDeadlock(() =>
      drizzleDB
        .update(huntingSession)
        .set({ battleId: null, version: sql`${huntingSession.version} + 1` })
        .where(
          and(
            isNotNull(huntingSession.battleId),
            notExists(
              drizzleDB
                .select({ id: battle.id })
                .from(battle)
                .where(eq(battle.id, huntingSession.battleId)),
            ),
          ),
        ),
    );

    // Step 2: Release missing fights while preserving an open isolated Pyramid run.
    await drizzleDB
      .update(userData)
      .set({
        // Missing battle metadata falls back to base Energy recovery.
        curEnergy: sql`CASE WHEN ${userData.status} = 'BATTLE' THEN ${combatEnergyRecoverySql()} ELSE ${userData.curEnergy} END`,
        regenAt: sql`CASE WHEN ${userData.status} = 'BATTLE' THEN NOW(3) ELSE ${userData.regenAt} END`,
        updatedAt: sql`GREATEST(NOW(3), TIMESTAMPADD(MICROSECOND, 1000, ${userData.updatedAt}))`,
        bracketImmunityLiftedUntil: resumeBracketImmunitySql(),
        bracketImmunityPausedAt: null,
        battleId: null,
        status: sql`CASE WHEN EXISTS (SELECT 1 FROM ${questHistory} WHERE ${questHistory.userId} = ${userData.userId} AND ${questHistory.isolated} = TRUE AND ${questHistory.completed} = 0 AND ${questHistory.endAt} IS NULL) THEN 'BATTLE' ELSE 'AWAKE' END`,
        travelFinishAt: null,
      })
      .where(
        and(
          isNotNull(userData.battleId),
          notExists(
            drizzleDB
              .select({ id: battle.id })
              .from(battle)
              .where(eq(battle.id, userData.battleId)),
          ),
        ),
      );

    // Step 2.5: Complete travel for users whose travel time has expired
    await completeExpiredGlobalTravel(drizzleDB);

    // Time constants
    const oneHour = 1000 * 60 * 60;
    const oneDay = oneHour * 24;

    // A device can end an orphaned activity after a cold launch without JavaScript knowing
    // its id. Keep a retry window for failed APNs endings, then drain those dead addresses.
    await drizzleDB
      .delete(userLiveActivity)
      .where(lt(userLiveActivity.endsAt, new Date(Date.now() - oneDay)));

    // Battle retention periods:
    // - PVP (72 hours): Explicit PVP types that we want longer retention for
    // - Everything else (12 hours): All other battle types default to short retention
    // The join-free range delete can safely drain a larger batch. Keep relational
    // cleanup smaller because each candidate requires indexed lookup work.
    const backlogCleanupBatchSize = 10_000;
    const cleanupBatchSize = 1000;
    const pvpTypes = [
      "SPARRING",
      "CLAN_BATTLE",
      "TOURNAMENT",
      "RANKED_SPARRING",
      "KAGE_PVP",
      "COMBAT",
      "RANKED_PVP",
    ] as const;

    // Step 3a: All action types expire after at most 72 hours. Keep the backlog
    // path join-free so the updatedAt index can stop after one small range batch.
    await drizzleDB
      .delete(battleAction)
      .where(lt(battleAction.updatedAt, sql`DATE_SUB(NOW(), INTERVAL 72 HOUR)`))
      .orderBy(battleAction.updatedAt)
      .limit(backlogCleanupBatchSize);

    // Step 3b: Only inspect the bounded 12-72 hour window for shorter non-PVP
    // retention and orphans. The derived table is deliberately the first side of
    // the outer STRAIGHT_JOIN so the delete remains 1,000 primary-key point lookups.
    await drizzleDB.execute(
      sql`DELETE target
          FROM (
            SELECT id FROM (
              SELECT STRAIGHT_JOIN source.id
              FROM ${battleAction} source
              FORCE INDEX (BattleAction_updatedAt_battleId_idx)
              LEFT JOIN ${battleHistory} h ON source.battleId = h.battleId
              LEFT JOIN ${battle} b ON source.battleId = b.id
              WHERE source.updatedAt >= DATE_SUB(NOW(), INTERVAL 72 HOUR)
              AND source.updatedAt < DATE_SUB(NOW(), INTERVAL 12 HOUR)
              AND (
                (
                  h.battleId IS NULL
                  AND b.id IS NULL
                )
                OR (
                  h.battleId IS NOT NULL
                  AND (
                    h.battleType NOT IN (${sql.join(
                      pvpTypes.map((t) => sql`${t}`),
                      sql`, `,
                    )})
                    OR h.battleType IS NULL
                  )
                )
              )
              ORDER BY source.updatedAt
              LIMIT ${cleanupBatchSize}
            ) limited
          ) expired
          STRAIGHT_JOIN ${battleAction} target FORCE INDEX (PRIMARY)
            ON target.id = expired.id`,
    );

    // Step 5: Delete history after its actions have drained. Drive from createdAt
    // so LIMIT bounds the scan instead of sorting every row in each retention class.
    await drizzleDB.execute(
      sql`DELETE target
          FROM (
            SELECT id FROM (
              SELECT source.id
              FROM ${battleHistory} source
              FORCE INDEX (BattleHistory_createdAt_idx)
              WHERE source.createdAt < DATE_SUB(NOW(), INTERVAL 12 HOUR)
              AND (
                (
                  source.battleType IN (${sql.join(
                    pvpTypes.map((t) => sql`${t}`),
                    sql`, `,
                  )})
                  AND source.createdAt < DATE_SUB(NOW(), INTERVAL 72 HOUR)
                )
                OR source.battleType NOT IN (${sql.join(
                  pvpTypes.map((t) => sql`${t}`),
                  sql`, `,
                )})
                OR source.battleType IS NULL
              )
              AND NOT EXISTS (
                SELECT 1 FROM ${battleAction} a
                FORCE INDEX (BattleAction_round_key)
                WHERE a.battleId = source.battleId
              )
              ORDER BY source.createdAt
              LIMIT ${cleanupBatchSize}
            ) limited
          ) expired
          STRAIGHT_JOIN ${battleHistory} target FORCE INDEX (PRIMARY)
            ON target.id = expired.id`,
    );

    // Step 6: Delete conversations older than 14 days
    await drizzleDB
      .delete(conversation)
      .where(
        and(
          lte(conversation.updatedAt, new Date(Date.now() - oneDay * 14)),
          eq(conversation.isPublic, false),
          eq(conversation.isStaffAvailable, false),
        ),
      );

    // Step 8a: Delete conversation comments older than 14 days
    await drizzleDB.execute(
      sql`
        DELETE a FROM ${conversationComment} a
        INNER JOIN ${conversation} b ON a.conversationId = b.id
        WHERE a.createdAt < CURRENT_TIMESTAMP(3) - INTERVAL 14 DAY
          AND b.isStaffAvailable = false
          AND (b.isPublic = false OR b.title IS NULL OR b.title != 'Global')
      `,
    );

    // Step 8b: Delete other public conversation comments older than 2 days
    await drizzleDB.execute(
      sql`
        DELETE a FROM ${conversationComment} a 
        INNER JOIN ${conversation} b ON a.conversationId = b.id
        WHERE b.isPublic AND b.title != 'Global' AND a.createdAt < CURRENT_TIMESTAMP(3) - INTERVAL 2 DAY AND b.isStaffAvailable = false`,
    );

    // Step 11: Clearing historical avatars that failed more than 3 hours ago
    await drizzleDB
      .delete(historicalAvatar)
      .where(
        and(
          lt(historicalAvatar.createdAt, secondsFromNow(-3600 * 3)),
          isNull(historicalAvatar.avatar),
        ),
      );

    // Step 12: Update users who have a clanId by no clan
    await drizzleDB
      .update(userData)
      .set({ clanId: null })
      .where(
        and(
          isNotNull(userData.clanId),
          notExists(
            drizzleDB
              .select({ id: clan.id })
              .from(clan)
              .where(eq(clan.id, userData.clanId)),
          ),
        ),
      );

    // Step 14: Purge inactive low-progress characters in guarded primary-key batches
    await deleteCleanupCandidates(
      drizzleDB,
      userData,
      { userId: userData.userId },
      and(
        lt(userData.experience, 100),
        eq(userData.isAi, false),
        lt(userData.updatedAt, sql`CURRENT_TIMESTAMP(3) - INTERVAL 30 DAY`),
        lte(userData.reputationPointsTotal, 5),
      ),
    );
    await deleteCleanupCandidates(
      drizzleDB,
      userData,
      { userId: userData.userId },
      and(
        lt(userData.experience, 10_000),
        eq(userData.isAi, false),
        lt(userData.updatedAt, sql`CURRENT_TIMESTAMP(3) - INTERVAL 60 DAY`),
        lte(userData.reputationPointsTotal, 5),
      ),
    );

    // Step 22: Clear training log entries
    await drizzleDB
      .delete(trainingLog)
      .where(
        lt(trainingLog.trainingFinishedAt, sql`CURRENT_TIMESTAMP(3) - INTERVAL 7 DAY`),
      )
      .orderBy(trainingLog.trainingFinishedAt)
      .limit(rangeCleanupBatchSize);

    // Step 23: Clear mpvp battle queue entries
    await drizzleDB
      .delete(mpvpBattleQueue)
      .where(lt(mpvpBattleQueue.createdAt, sql`CURRENT_TIMESTAMP(3) - INTERVAL 7 DAY`))
      .orderBy(mpvpBattleQueue.createdAt)
      .limit(rangeCleanupBatchSize);

    // Step 24: Clear mpvp battle user entries
    await deleteCleanupCandidates(
      drizzleDB,
      mpvpBattleUser,
      { id: mpvpBattleUser.id },
      notExists(
        drizzleDB
          .select({ id: mpvpBattleQueue.id })
          .from(mpvpBattleQueue)
          .where(eq(mpvpBattleQueue.id, mpvpBattleUser.clanBattleId))
          .limit(1),
      ),
    );

    // Step 25: Set status to AWAKE for users who are QUEUED if they are not in any active battle systems
    // Only claimed ranked rows own status; provisional joins must not keep an orphan queued.
    // This covers mpvp battles and ranked PvP.
    await drizzleDB
      .update(userData)
      .set({ status: "AWAKE" })
      .where(
        and(
          eq(userData.status, "QUEUED"),
          notExists(
            drizzleDB
              .select({ id: mpvpBattleUser.id })
              .from(mpvpBattleUser)
              .where(eq(mpvpBattleUser.userId, userData.userId)),
          ),
          notExists(
            drizzleDB
              .select({ id: rankedPvpQueue.id })
              .from(rankedPvpQueue)
              .where(
                and(
                  eq(rankedPvpQueue.userId, userData.userId),
                  eq(rankedPvpQueue.hasClaimed, true),
                ),
              ),
          ),
        ),
      );

    // Step 26: Update the population of each village
    await drizzleDB.execute(
      sql`UPDATE ${village} a SET a.populationCount = (SELECT COUNT(*) FROM ${userData} b WHERE b.villageId = a.id)`,
    );

    // Repair the ANBU capacity counter if a compensated multi-step membership
    // change was interrupted between statements.
    await drizzleDB.execute(
      sql`UPDATE ${anbuSquad} a SET a.memberCount = (SELECT COUNT(*) FROM ${userData} b WHERE b.anbuId = a.id)`,
    );

    // Step 27: Clear old captcha checks
    await drizzleDB
      .delete(captcha)
      .where(lt(captcha.createdAt, sql`CURRENT_TIMESTAMP(3) - INTERVAL 30 DAY`))
      .orderBy(captcha.createdAt)
      .limit(rangeCleanupBatchSize);

    // Expiry releases pending ally reservations in the same write; accepted history stays.
    await retryOnDeadlock(() =>
      drizzleDB.execute(sql`
        DELETE r, wa FROM ${userRequest} r
        LEFT JOIN ${warAlly} wa ON wa.id = r.id AND wa.acceptedAt IS NULL
        WHERE r.createdAt < ${secondsFromNow(-3600 * 24)}
          AND NOT (r.type = 'HOME' AND r.status = 'ACCEPTED')
      `),
    );

    // Step 29: Wrong village wrt. clan
    await drizzleDB.execute(
      sql`UPDATE ${userData} u INNER JOIN ${clan} c ON u.clanId = c.id SET u.villageId = c.villageId WHERE c.hasHideout = true AND u.villageId != c.villageId`,
    );

    // Step 30: Run orphan sweeps, tavern cleanup and activity decay once per day.
    const tavernDecayTimer = await lockWithDailyTimer(drizzleDB, "cleaner-daily");
    if (tavernDecayTimer.isNewDay) {
      try {
        await cleanupOrphanRows(drizzleDB);
        await drizzleDB.execute(
          sql`
            DELETE a FROM ${conversationComment} a
            INNER JOIN ${conversation} b ON a.conversationId = b.id
            WHERE b.isPublic AND b.title = 'Global'
              AND a.createdAt < CURRENT_TIMESTAMP(3) - INTERVAL 2 HOUR
          `,
        );
        await enqueueUserDataJob(drizzleDB, {
          id: `tavern-decay:${new Date().toISOString().slice(0, 10)}`,
          kind: "TAVERN_DECAY",
        });
        await processUserDataJobs(drizzleDB);
      } catch (cause) {
        await tavernDecayTimer.release();
        throw cause;
      }
    }

    await drizzleDB
      .delete(userDataJob)
      .where(lt(userDataJob.completedAt, secondsFromNow(-7 * 24 * 3600)))
      .limit(rangeCleanupBatchSize);

    // Step 31: Clear automatedModeration older than  3 months
    await drizzleDB
      .delete(automatedModeration)
      .where(
        lt(automatedModeration.createdAt, sql`CURRENT_TIMESTAMP(3) - INTERVAL 3 MONTH`),
      )
      .orderBy(automatedModeration.createdAt)
      .limit(rangeCleanupBatchSize);

    await drizzleDB
      .delete(moderationScan)
      .where(
        lt(
          moderationScan.createdAt,
          sql`CURRENT_TIMESTAMP(3) - INTERVAL ${MODERATION_SCAN_RETENTION_DAYS} DAY`,
        ),
      )
      .orderBy(moderationScan.createdAt)
      .limit(rangeCleanupBatchSize);

    // Step 32: Federal status is derived state. Reconcile its exact maximum active tier
    // across PayPal and both stores, including downgrades when a higher receipt expires.
    await reconcileFederalStatuses(drizzleDB);

    // Step 34: Clear bank interest outside the claimable UTC date window
    const { oldestDate } = getBankInterestDateRange();
    await drizzleDB
      .delete(dailyBankInterest)
      .where(lt(dailyBankInterest.date, oldestDate))
      .orderBy(dailyBankInterest.date)
      .limit(rangeCleanupBatchSize);

    // Step 35: Clear daily bank interest older than 2 days which are already claimed
    await drizzleDB
      .delete(dailyBankInterest)
      .where(
        and(
          eq(dailyBankInterest.claimed, true),
          lt(dailyBankInterest.updatedAt, sql`CURRENT_TIMESTAMP(3) - INTERVAL 2 DAY`),
        ),
      )
      .orderBy(dailyBankInterest.updatedAt)
      .limit(rangeCleanupBatchSize);

    // Delete historical ips older than 90 days
    await drizzleDB
      .delete(historicalIp)
      .where(lt(historicalIp.usedAt, sql`CURRENT_TIMESTAMP(3) - INTERVAL 90 DAY`))
      .orderBy(historicalIp.usedAt)
      .limit(rangeCleanupBatchSize);

    // Clean activity events older than 10 days
    await drizzleDB
      .delete(userActivityEvent)
      .where(
        lt(userActivityEvent.createdAt, sql`CURRENT_TIMESTAMP(3) - INTERVAL 10 DAY`),
      )
      .orderBy(userActivityEvent.createdAt)
      .limit(rangeCleanupBatchSize);

    // Clear rankedPvpQueue entries older than 1 day
    await drizzleDB
      .delete(rankedPvpQueue)
      .where(lt(rankedPvpQueue.createdAt, sql`CURRENT_TIMESTAMP(3) - INTERVAL 1 DAY`))
      .orderBy(rankedPvpQueue.createdAt)
      .limit(rangeCleanupBatchSize);

    // Clear war kills older than 10 days
    await drizzleDB
      .delete(warKill)
      .where(lt(warKill.killedAt, sql`CURRENT_TIMESTAMP(3) - INTERVAL 30 DAY`))
      .orderBy(warKill.killedAt)
      .limit(rangeCleanupBatchSize);

    // Clear dataBattleAction entries older than 30 days
    await drizzleDB
      .delete(dataBattleAction)
      .where(
        lt(dataBattleAction.updatedAt, sql`CURRENT_TIMESTAMP(3) - INTERVAL 30 DAY`),
      )
      .orderBy(dataBattleAction.updatedAt)
      .limit(rangeCleanupBatchSize);

    // Handle expired exclusive raids - return sectors to neutral if raid timed out without boss defeat
    await cleanupExpiredExclusiveRaids(drizzleDB);

    // Remove decided content-review suggestions past retention and unpicked media files. It
    // retries on the next run by itself, so a storage outage there must not hold up the
    // account deletions below.
    await cleanupContentProposals(drizzleDB).catch((cause: unknown) => {
      console.error("Content review cleanup failed", cause);
    });

    // A sanction tombstone exists only to enforce its sanction; drop it once that ends.
    await removeExpiredSanctionTombstones(drizzleDB);

    // Finish due permanent-account deletions alongside the other hourly cleanup.
    const deletions = await processAccountDeletions();
    if (deletions.failed > 0) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Account deletion cleanup needs a retry",
      });
    }

    return Response.json(`OK`);
  } catch (cause) {
    try {
      // The cleaner is invoked every ten minutes. Restore the hourly marker
      // after a failed run so the next invocation can retry the unfinished work.
      await cleanerTimer.release();
    } catch (rollbackCause) {
      console.error("Failed to restore cleaner hourly timer", rollbackCause);
    }
    return handleEndpointError(cause, { endpoint: "/api/cleaner" });
  }
}
