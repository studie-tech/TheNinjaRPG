import { TRPCError } from "@trpc/server";
import { and, eq, lt, lte, notExists, sql } from "drizzle-orm";
import { mpvpBattleUser, userData } from "@/drizzle/schema";
import { cleanupContentProposals } from "@/libs/contentReview/cleanup";
import {
  handleEndpointError,
  lockWithDailyTimer,
  lockWithHourlyTimer,
} from "@/libs/gamesettings";
import {
  deleteAutomatedModerationForGET,
  deleteBattleActionForGET,
  deleteBattleForGET,
  deleteCaptchaForGET,
  deleteConversationForGET,
  deleteDailyBankInterestForGET,
  deleteDailyBankInterestForGET2,
  deleteDataBattleActionForGET,
  deleteHistoricalAvatarForGET,
  deleteHistoricalIpForGET,
  deleteModerationScanForGET,
  deleteMpvpBattleQueueForGET,
  deleteRankedPvpQueueForGET,
  deleteTrainingLogForGET,
  deleteUserActivityEventForGET,
  deleteUserLiveActivityForGET,
  deleteWarKillForGET,
  executeRowsForGET,
  executeRowsForGET2,
  executeRowsForGET3,
  executeRowsForGET4,
  executeRowsForGET5,
  executeRowsForGET6,
  executeRowsForGET7,
  executeRowsForGET8,
  executeRowsForGET9,
  executeRowsForGET10,
  selectMpvpBattleQueueForGET,
  updateHuntingSessionForGET,
  updateUserDataForGET,
  updateUserDataForGET2,
  updateUserDataForGET3,
} from "@/queries/cleaner";
import { cleanupExpiredExclusiveRaids } from "@/routers/raids";
import { completeExpiredGlobalTravel } from "@/routers/travel";
import { drizzleDB } from "@/server/db";
import { processAccountDeletions } from "@/server/utils/accountDeletion/process";
import { cleanupOrphanRows, deleteCleanupCandidates } from "@/server/utils/cleaner";
import { authenticateCronRequest } from "@/server/utils/cron";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { reconcileFederalStatuses } from "@/server/utils/purchases/grant";
import { removeExpiredSanctionTombstones } from "@/server/utils/sanctionTombstone";
import { getBankInterestDateRange } from "@/utils/time";

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
    await deleteBattleForGET(drizzleDB, rangeCleanupBatchSize);

    // Step 1b: Release hunting reservations whose battle is gone. Settlement clears the
    // reservation with the battle, but an abandoned hunt only expires through Step 1;
    // a dangling battleId would trap the hunter.
    await retryOnDeadlock(() => updateHuntingSessionForGET(drizzleDB));

    // Step 2: Release missing fights while preserving an open isolated Pyramid run.
    await updateUserDataForGET(drizzleDB);

    // Step 2.5: Complete travel for users whose travel time has expired
    await completeExpiredGlobalTravel(drizzleDB);

    // Time constants
    const oneHour = 1000 * 60 * 60;
    const oneDay = oneHour * 24;

    // A device can end an orphaned activity after a cold launch without JavaScript knowing
    // its id. Keep a retry window for failed APNs endings, then drain those dead addresses.
    await deleteUserLiveActivityForGET(drizzleDB, oneDay);

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
    await deleteBattleActionForGET(drizzleDB, backlogCleanupBatchSize);

    // Step 3b: Only inspect the bounded 12-72 hour window for shorter non-PVP
    // retention and orphans. The derived table is deliberately the first side of
    // the outer STRAIGHT_JOIN so the delete remains 1,000 primary-key point lookups.
    await executeRowsForGET(drizzleDB, pvpTypes, cleanupBatchSize);

    // Step 5: Delete history after its actions have drained. Drive from createdAt
    // so LIMIT bounds the scan instead of sorting every row in each retention class.
    await executeRowsForGET2(drizzleDB, pvpTypes, cleanupBatchSize);

    // Step 6: Delete conversations older than 14 days
    await deleteConversationForGET(drizzleDB, oneDay);

    // Step 8a: Delete conversation comments older than 14 days
    await executeRowsForGET3(drizzleDB);

    // Step 8b: Delete other public conversation comments older than 2 days
    await executeRowsForGET4(drizzleDB);

    // Step 11: Clearing historical avatars that failed more than 3 hours ago
    await deleteHistoricalAvatarForGET(drizzleDB);

    // Step 12: Update users who have a clanId by no clan
    await updateUserDataForGET2(drizzleDB);

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
    await deleteTrainingLogForGET(drizzleDB, rangeCleanupBatchSize);

    // Step 23: Clear mpvp battle queue entries
    await deleteMpvpBattleQueueForGET(drizzleDB, rangeCleanupBatchSize);

    // Step 24: Clear mpvp battle user entries
    await deleteCleanupCandidates(
      drizzleDB,
      mpvpBattleUser,
      { id: mpvpBattleUser.id },
      notExists(selectMpvpBattleQueueForGET(drizzleDB)),
    );

    // Step 25: Set status to AWAKE for users who are QUEUED if they are not in any active battle systems
    // Only claimed ranked rows own status; provisional joins must not keep an orphan queued.
    // This covers mpvp battles, ranked PvP and live dungeon reservations.
    await updateUserDataForGET3(drizzleDB);

    // Step 26: Update the population of each village
    await executeRowsForGET5(drizzleDB);

    // Repair the ANBU capacity counter if a compensated multi-step membership
    // change was interrupted between statements.
    await executeRowsForGET6(drizzleDB);

    // Step 27: Clear old captcha checks
    await deleteCaptchaForGET(drizzleDB, rangeCleanupBatchSize);

    // Expiry releases pending ally reservations in the same write; accepted history stays.
    await retryOnDeadlock(() => executeRowsForGET7(drizzleDB));

    // Step 29: Wrong village wrt. clan
    await executeRowsForGET8(drizzleDB);

    // Step 30: Run orphan sweeps, tavern cleanup and activity decay once per day.
    const tavernDecayTimer = await lockWithDailyTimer(drizzleDB, "cleaner-daily");
    if (tavernDecayTimer.isNewDay) {
      try {
        await cleanupOrphanRows(drizzleDB);
        await executeRowsForGET9(drizzleDB);
        await executeRowsForGET10(drizzleDB);
      } catch (cause) {
        await tavernDecayTimer.release();
        throw cause;
      }
    }

    // Step 31: Clear automatedModeration older than  3 months
    await deleteAutomatedModerationForGET(drizzleDB, rangeCleanupBatchSize);

    await deleteModerationScanForGET(drizzleDB, rangeCleanupBatchSize);

    // Step 32: Federal status is derived state. Reconcile its exact maximum active tier
    // across PayPal and both stores, including downgrades when a higher receipt expires.
    await reconcileFederalStatuses(drizzleDB);

    // Step 34: Clear bank interest outside the claimable UTC date window
    const { oldestDate } = getBankInterestDateRange();
    await deleteDailyBankInterestForGET(drizzleDB, oldestDate, rangeCleanupBatchSize);

    // Step 35: Clear daily bank interest older than 2 days which are already claimed
    await deleteDailyBankInterestForGET2(drizzleDB, rangeCleanupBatchSize);

    // Delete historical ips older than 90 days
    await deleteHistoricalIpForGET(drizzleDB, rangeCleanupBatchSize);

    // Clean activity events older than 10 days
    await deleteUserActivityEventForGET(drizzleDB, rangeCleanupBatchSize);

    // Clear rankedPvpQueue entries older than 1 day
    await deleteRankedPvpQueueForGET(drizzleDB, rangeCleanupBatchSize);

    // Clear war kills older than 10 days
    await deleteWarKillForGET(drizzleDB, rangeCleanupBatchSize);

    // Clear dataBattleAction entries older than 30 days
    await deleteDataBattleActionForGET(drizzleDB, rangeCleanupBatchSize);

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
