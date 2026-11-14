import * as Sentry from "@sentry/nextjs";
import {
  adClick,
  huntingProgress,
  huntingReceipt,
  huntingSession,
} from "@/drizzle/schema";
import { deleteUserReportEmbeddings } from "@/libs/moderation/reportSearch";
import { deleteRowsForUser } from "@/queries/accountDeletion";
import { deleteAiTransformationsFor } from "@/queries/ai";
import { deleteBattleQueueMembersForUser } from "@/queries/clan";
import { deleteUserAttributes, deleteUserNindo } from "@/queries/profile";
import { deleteRankedQueueForUser } from "@/queries/pvprank";
import { deleteUserSkills } from "@/queries/skillTree";
import { deleteAiSpriteAnimationBindings } from "@/queries/spriteAnimation";
import {
  deleteActionLogForDeleteUserInternal,
  deleteAiProfileForDeleteUserInternal,
  deleteAutomatedModerationForDeleteUserInternal,
  deleteBankTransfersForDeleteUserInternal,
  deleteBankTransfersForDeleteUserInternal2,
  deleteBloodlineRollsForDeleteUserInternal,
  deleteCaptchaForDeleteUserInternal,
  deleteConceptImageForDeleteUserInternal,
  deleteConversationCommentForDeleteUserInternal,
  deleteConversationForDeleteUserInternal,
  deleteDamageSimulationForDeleteUserInternal,
  deleteFarmCollectionLogForDeleteUserInternal,
  deleteFarmExtractionForDeleteUserInternal,
  deleteFarmPlotForDeleteUserInternal,
  deleteForumPostForDeleteUserInternal,
  deleteForumThreadForDeleteUserInternal,
  deleteHistoricalAvatarForDeleteUserInternal,
  deleteHistoricalIpForDeleteUserInternal,
  deleteJutsuLoadoutForDeleteUserInternal,
  deleteKageDefendedChallengesForDeleteUserInternal,
  deleteKageDefendedChallengesForDeleteUserInternal2,
  deleteLinkPromotionForDeleteUserInternal,
  deleteLinkPromotionForDeleteUserInternal2,
  deleteModerationScanForDeleteUserInternal,
  deleteNotificationForDeleteUserInternal,
  deleteOverworldAiPlacementForDeleteUserInternal,
  deleteOverworldAiPlacementQuestForDeleteUserInternal,
  deletePollForDeleteUserInternal,
  deletePollOptionForDeleteUserInternal,
  deletePollOptionForDeleteUserInternal2,
  deleteRaidParticipationForDeleteUserInternal,
  deleteRecruitReferralForDeleteUserInternal,
  deleteReportLogForDeleteUserInternal,
  deleteReportLogForDeleteUserInternal2,
  deleteStaffApplicationForDeleteUserInternal,
  deleteSupportReviewForDeleteUserInternal,
  deleteTitleForDeleteUserInternal,
  deleteTrainingLogForDeleteUserInternal,
  deleteUser2conversationForDeleteUserInternal,
  deleteUserActivityEventForDeleteUserInternal,
  deleteUserBadgeForDeleteUserInternal,
  deleteUserBlackListForDeleteUserInternal,
  deleteUserBlackListForDeleteUserInternal2,
  deleteUserCookingJobs,
  deleteUserDataForDeleteUserInternal,
  deleteUserDeviceForDeleteUserInternal,
  deleteUserHomeForDeleteUserInternal,
  deleteUserItems,
  deleteUserJutsus,
  deleteUserLikesForDeleteUserInternal,
  deleteUserLiveActivityForDeleteUserInternal,
  deleteUserPetForDeleteUserInternal,
  deleteUserPollVoteForDeleteUserInternal,
  deleteUserPushPreferenceForDeleteUserInternal,
  deleteUserQuestAttemptForDeleteUserInternal,
  deleteUserQuestHistory,
  deleteUserQueues,
  deleteUserRaidBuffForDeleteUserInternal,
  deleteUserRankedRewards,
  deleteUserReportCommentForDeleteUserInternal,
  deleteUserReportForDeleteUserInternal,
  deleteUserReportForDeleteUserInternal2,
  deleteUserRequestForDeleteUserInternal,
  deleteUserRequestForDeleteUserInternal2,
  deleteUserReviewForDeleteUserInternal,
  deleteUserReviewForDeleteUserInternal2,
  deleteUserRewardsForDeleteUserInternal,
  deleteUserRewardsForDeleteUserInternal2,
  deleteUserTitleForDeleteUserInternal,
  deleteUserUploadForDeleteUserInternal,
  deleteUserVoteForDeleteUserInternal,
  deleteWarKillForDeleteUserInternal,
  deleteWarKillForDeleteUserInternal2,
  findHuntingSessionForDeleteUser,
  selectOverworldAiPlacementForDeleteUserInternal,
  updateAuctionOfferForDeleteUserInternal,
  updateUserDataForDeleteUserInternal,
  updateWebStoreOrderForDeleteUserInternal,
} from "@/queries/staff";
import { errorResponse } from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { removeDiscordLink } from "@/server/utils/discord/linking";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { retireStoreUserId } from "@/server/utils/purchases/storeIdentity";
import { notifyRankedQueueChanged } from "@/server/utils/rankedQueue";
import { recordSanctionTombstone } from "@/server/utils/sanctionTombstone";

/**
 * Delete a user and associated data, retrying MySQL deadlocks with bounded backoff.
 * Reject accepted hunting AI references before this helper begins destructive cleanup.
 * @param client - The database client.
 * @param userId - The ID of the user to delete.
 * @returns An expected rejection before cleanup, or undefined after successful deletion.
 */
export const deleteUser = async (client: DrizzleClient, userId: string) => {
  // Only the selected contract is a dependency, even in a full-habitat legacy snapshot.
  const activeHunt = await findHuntingSessionForDeleteUser(client, userId);
  if (activeHunt)
    return errorResponse(
      "This AI is used by an active hunting session. Wait for it to finish.",
    );
  const maxRetries = 6;
  await retryOnDeadlock(() => deleteUserInternal(client, userId), maxRetries, {
    baseDelayMs: 100,
    jitterMs: 100,
    onRetry: (attempt, delayMs) => {
      // Add Sentry breadcrumb for monitoring retry patterns
      Sentry.addBreadcrumb({
        category: "retry",
        message: `Retrying deleteUser due to deadlock (attempt ${attempt}/${maxRetries}, delay: ${Math.round(delayMs)}ms)`,
        level: "info",
        data: { attempt, maxRetries, delayMs: Math.round(delayMs), userId },
      });
    },
  });
};

/**
 * Internal implementation of user deletion.
 * Sequential batches to prevent MySQL deadlock (errno 1213).
 * Operations within each batch run in parallel, but batches execute sequentially.
 * @param client - The database client.
 * @param userId - The ID of the user to delete.
 */
const deleteUserInternal = async (client: DrizzleClient, userId: string) => {
  // Claim deletion before any cleanup. The durable alias remains through every later
  // batch and the final UserData delete, so a concurrent staff rename cannot move the
  // identity midway through cleanup and overwrite its tombstone.
  await retireStoreUserId(client, userId, async (lockedClient) => {
    // The marker makes moderation require this source before cleanup can remove reports.
    await recordSanctionTombstone(lockedClient, userId);
    // Push writes check for the tombstone before they write; this removes what landed first.
    await deleteUserDeviceForDeleteUserInternal(lockedClient, userId);
    await deleteUserLiveActivityForDeleteUserInternal(lockedClient, userId);
    await deleteUserPushPreferenceForDeleteUserInternal(lockedClient, userId);
  });

  // After the tombstone captured it: release and archive the Discord link. A Discord ban
  // mirroring an indefinite sanction stays in place.
  await removeDiscordLink(client, {
    userId,
    reason: "ACCOUNT_DELETED",
    actorUserId: userId,
  });

  // Keep paid snapshots for support and retire recipients before inventory cleanup.
  // Delivery claims the same rows, so any in-flight grant finishes before cleanup.
  await updateWebStoreOrderForDeleteUserInternal(client, userId);

  // Close permanent offers before removing their escrow inventory. The status CAS
  // serializes deletion with acceptance, so cleanup cannot erase a supplier's payment.
  await updateAuctionOfferForDeleteUserInternal(client, userId);

  // Batch 1: AI templates may own placement rows. Their lookup is independent of the
  // prerequisite sensei-reference cleanup, so run both together before destructive deletes.
  const [aiPlacements] = await Promise.all([
    selectOverworldAiPlacementForDeleteUserInternal(client, userId),
    updateUserDataForDeleteUserInternal(client, userId),
  ]);
  const aiPlacementIds = aiPlacements.map((placement) => placement.id);

  // Batch 2: Communication & social relationships
  await Promise.all([
    deleteConversationForDeleteUserInternal(client, userId),
    deleteUser2conversationForDeleteUserInternal(client, userId),
    deleteConversationCommentForDeleteUserInternal(client, userId),
    deleteNotificationForDeleteUserInternal(client, userId),
    // Account-level parental settings survive deleting and recreating a character.
    deleteUserBlackListForDeleteUserInternal(client, userId),
    deleteUserBlackListForDeleteUserInternal2(client, userId),
  ]);

  // Batch 3: Forum & content
  await Promise.all([
    deleteForumPostForDeleteUserInternal(client, userId),
    deleteForumThreadForDeleteUserInternal(client, userId),
    deletePollForDeleteUserInternal(client, userId),
    deleteUserPollVoteForDeleteUserInternal(client, userId),
    deletePollOptionForDeleteUserInternal(client, userId),
    deletePollOptionForDeleteUserInternal2(client, userId),
  ]);

  // Batch 4: Game progress & items
  await Promise.all([
    // A linked ad click goes with the character, so a recreated one is not reported again.
    ...[huntingSession, huntingProgress, huntingReceipt, adClick].map((table) =>
      deleteRowsForUser(client, table, userId),
    ),
    deleteAiSpriteAnimationBindings(client, userId),
    deleteAiTransformationsFor(client, userId),
    deleteUserItems(client, userId),
    deleteFarmPlotForDeleteUserInternal(client, userId),
    deleteFarmExtractionForDeleteUserInternal(client, userId),
    deleteFarmCollectionLogForDeleteUserInternal(client, userId),
    deleteUserJutsus(client, userId),
    deleteUserQueues(client, userId),
    deleteUserCookingJobs(client, userId),
    deleteUserSkills(client, userId),
    deleteUserAttributes(client, userId),
    deleteJutsuLoadoutForDeleteUserInternal(client, userId),
    deleteUserQuestHistory(client, userId),
    deleteUserQuestAttemptForDeleteUserInternal(client, userId),
    deleteBloodlineRollsForDeleteUserInternal(client, userId),
  ]);

  // Batch 5: History, logs, AI & security
  await Promise.all([
    deleteHistoricalAvatarForDeleteUserInternal(client, userId),
    deleteHistoricalIpForDeleteUserInternal(client, userId),
    // The referral goes with the character; its RecruitRankMilestone ledger stays so a
    // recreated character cannot earn the same milestones again.
    deleteRecruitReferralForDeleteUserInternal(client, userId),
    deleteUserActivityEventForDeleteUserInternal(client, userId),
    deleteActionLogForDeleteUserInternal(client, userId),
    deleteTrainingLogForDeleteUserInternal(client, userId),
    deleteAiProfileForDeleteUserInternal(client, userId),
    ...(aiPlacementIds.length > 0
      ? [
          deleteOverworldAiPlacementQuestForDeleteUserInternal(client, aiPlacementIds),
          deleteOverworldAiPlacementForDeleteUserInternal(client, aiPlacementIds),
        ]
      : []),
    deleteCaptchaForDeleteUserInternal(client, userId),
  ]);

  // Batch 6: Reports & moderation
  await deleteUserReportEmbeddings(client, userId);
  await Promise.all([
    deleteReportLogForDeleteUserInternal(client, userId),
    deleteReportLogForDeleteUserInternal2(client, userId),
    deleteUserReportForDeleteUserInternal(client, userId),
    deleteUserReportForDeleteUserInternal2(client, userId),
    deleteUserReportCommentForDeleteUserInternal(client, userId),
    deleteAutomatedModerationForDeleteUserInternal(client, userId),
    deleteModerationScanForDeleteUserInternal(client, userId),
  ]);

  // Batch 7: Staff & applications
  await Promise.all([
    deleteStaffApplicationForDeleteUserInternal(client, userId),
    deleteSupportReviewForDeleteUserInternal(client, userId),
  ]);

  // Batch 8: Financial & rewards
  await Promise.all([
    deleteBankTransfersForDeleteUserInternal(client, userId),
    deleteBankTransfersForDeleteUserInternal2(client, userId),
    deleteUserRewardsForDeleteUserInternal(client, userId),
    deleteUserRewardsForDeleteUserInternal2(client, userId),
    deleteUserVoteForDeleteUserInternal(client, userId),
  ]);

  // Batch 9: Reviews & social
  await Promise.all([
    deleteUserReviewForDeleteUserInternal(client, userId),
    deleteUserReviewForDeleteUserInternal2(client, userId),
    deleteUserNindo(client, userId),
    deleteUserHomeForDeleteUserInternal(client, userId),
    deleteUserLikesForDeleteUserInternal(client, userId),
    deleteUserRequestForDeleteUserInternal(client, userId),
    deleteUserRequestForDeleteUserInternal2(client, userId),
  ]);

  // Batch 10: Battle, war & ranked PVP
  await Promise.all([
    deleteBattleQueueMembersForUser(client, userId),
    deleteRankedQueueForUser(client, userId).then(async (result) => {
      await notifyRankedQueueChanged(result.rowsAffected);
    }),
    deleteUserRankedRewards(client, userId),
    deleteKageDefendedChallengesForDeleteUserInternal(client, userId),
    deleteKageDefendedChallengesForDeleteUserInternal2(client, userId),
    deleteWarKillForDeleteUserInternal(client, userId),
    deleteWarKillForDeleteUserInternal2(client, userId),
    deleteRaidParticipationForDeleteUserInternal(client, userId),
    deleteUserRaidBuffForDeleteUserInternal(client, userId),
  ]);

  // Batch 11: Misc
  await Promise.all([
    deleteDamageSimulationForDeleteUserInternal(client, userId),
    deleteConceptImageForDeleteUserInternal(client, userId),
    deleteUserBadgeForDeleteUserInternal(client, userId),
    deleteUserTitleForDeleteUserInternal(client, userId),
    deleteTitleForDeleteUserInternal(client, userId),
    deleteLinkPromotionForDeleteUserInternal(client, userId),
    deleteLinkPromotionForDeleteUserInternal2(client, userId),
    deleteUserUploadForDeleteUserInternal(client, userId),
    deleteUserPetForDeleteUserInternal(client, userId),
  ]);

  // Final batch: Delete main userData record (must be last)
  await deleteUserDataForDeleteUserInternal(client, userId);
};
