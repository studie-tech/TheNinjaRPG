import { Client as PlanetScaleClient } from "@planetscale/database";
import * as Sentry from "@sentry/nextjs";
import { after } from "next/server";
import { z } from "zod";
import {
  getForceAwakeUserUpdate,
  getUnequipAllGearUserUpdate,
  getUnequipAllJutsusUserUpdate,
  getUpdateUserIdUserUpdate,
} from "@/deltas/staff";
import type { UserStatus } from "@/drizzle/constants";
import {
  adClick,
  farmCollectionLog,
  farmExtraction,
  farmPlot,
  huntingProgress,
  huntingReceipt,
  huntingSession,
  raidParticipation,
  rankedPvpQueue,
  rankedUserRewards,
  userQuestAttempt,
  userSkill,
} from "@/drizzle/schema";
import { getServerPusher, updateUserOnMap } from "@/libs/pusher";
import { isBattleClaimId } from "@/libs/raids";
import { incrementAnbuMemberCount } from "@/queries/anbu";
import { fetchBadge } from "@/queries/badge";
import { deleteBattleQueueMembersForUser } from "@/queries/clan";
import { deleteBattleById } from "@/queries/combat";
import { renameCosmetics } from "@/queries/cosmetic";
import { findHuntingSessionForUser } from "@/queries/hunting";
import { renameParentalContact } from "@/queries/parentalControls";
import {
  deleteUserAttributes,
  fetchAttributes,
  fetchUser,
  findUserById,
  listUserItemsByUserId,
  listUserJutsuByUserId,
} from "@/queries/profile";
import { findStoreUserIdAlias, insertStoreUserIdAlias } from "@/queries/purchases";
import { deleteRankedQueueForUser } from "@/queries/pvprank";
import { clearQueueBattleId, deleteEmptyQueueById } from "@/queries/raids";
import { fetchMasterySources } from "@/queries/skillTree";
import {
  applyDevelopmentBackup,
  clearDevelopmentBackupTarget,
  deleteUserBadgeForRemoveUserBadge,
  deleteUserCookingJobs,
  deleteUserItems,
  deleteUserJutsus,
  deleteUserQuestHistory,
  deleteUserQueues,
  deleteUserRankedRewards,
  executeRecoverySqlForForceAwake,
  executeSelectSqlForCreateBackup,
  findContentBackupForPushBackupToDev,
  findMpvpBattleQueueForForceAwake,
  findMpvpBattleUserForForceAwake,
  findUserBadgeForRemoveUserBadge,
  insertActionLogForDeleteReferral,
  insertActionLogForForceAwake,
  insertActionLogForInsertUserBadge,
  insertActionLogForMassUnequip,
  insertActionLogForRemoveUserBadge,
  insertContentBackupForCreateBackup,
  insertContentBackupForCreateBackup2,
  insertQuestHistoryForCloneUserForDebug,
  insertRankedUserRewardsForCloneUserForDebug,
  insertUserAttributeForCloneUserForDebug,
  insertUserBadgeForInsertUserBadge,
  insertUserItemForCloneUserForDebug,
  insertUserJutsuForCloneUserForDebug,
  listContentBackupForGetBackups,
  listHistoricalIpForGetUserHistoricalIps,
  listQuestHistoryForCloneUserForDebug,
  listRankedUserRewardsForCloneUserForDebug,
  listUserActivityEventForGetUserActivityEvents,
  updateActionLogForUpdateUserId,
  updateAiProfileForUpdateUserId,
  updateAnbuSquadForCloneUserForDebug,
  updateAuctionOfferForUpdateUserId,
  updateAuctionOfferForUpdateUserId2,
  updateAutomatedModerationForUpdateUserId,
  updateBankTransfersForUpdateUserId,
  updateBankTransfersForUpdateUserId2,
  updateBloodlineRollsForUpdateUserId,
  updateCaptchaForUpdateUserId,
  updateConceptImageForUpdateUserId,
  updateConversationCommentForUpdateUserId,
  updateConversationForUpdateUserId,
  updateDamageSimulationForUpdateUserId,
  updateDiscordLinkForUpdateUserId,
  updateDiscordLinkHistoryForUpdateUserId,
  updateForumPostForUpdateUserId,
  updateForumThreadForUpdateUserId,
  updateHistoricalAvatarForUpdateUserId,
  updateHistoricalIpForUpdateUserId,
  updateItemLoadoutForUnequipAllGear,
  updateJutsuLoadoutForUnequipAllJutsus,
  updateJutsuLoadoutForUpdateUserId,
  updateKageDefendedChallengesForUpdateUserId,
  updateKageDefendedChallengesForUpdateUserId2,
  updateLinkPromotionForUpdateUserId,
  updateLinkPromotionForUpdateUserId2,
  updateModerationScanForUpdateUserId,
  updateMpvpBattleUserForUpdateUserId,
  updateNotificationForUpdateUserId,
  updateParentalControlForUpdateUserId,
  updatePaypalSubscriptionForUpdateUserId,
  updatePaypalSubscriptionForUpdateUserId2,
  updatePaypalTransactionForUpdateUserId,
  updatePaypalTransactionForUpdateUserId2,
  updatePollForUpdateUserId,
  updatePollOptionForUpdateUserId,
  updatePollOptionForUpdateUserId2,
  updateQuestHistoryForUpdateUserId,
  updateRecruitRankMilestoneForUpdateUserId,
  updateRecruitRankMilestoneForUpdateUserId2,
  updateRecruitReferralForUpdateUserId,
  updateRecruitReferralForUpdateUserId2,
  updateReportLogForUpdateUserId,
  updateReportLogForUpdateUserId2,
  updateRyoTradeForUpdateUserId,
  updateRyoTradeForUpdateUserId2,
  updateRyoTradeForUpdateUserId3,
  updateStaffApplicationForUpdateUserId,
  updateStorePurchaseForUpdateUserId,
  updateStorePurchaseForUpdateUserId2,
  updateStoreUserIdAliasForUpdateUserId,
  updateStripeCheckoutForUpdateUserId,
  updateStripeCheckoutForUpdateUserId2,
  updateStripePaymentForUpdateUserId,
  updateStripePaymentForUpdateUserId2,
  updateSupportReviewForUpdateUserId,
  updateTableForUpdateUserId,
  updateTitleForUpdateUserId,
  updateTrainingLogForUpdateUserId,
  updateUser2conversationForUpdateUserId,
  updateUserActivityEventForUpdateUserId,
  updateUserAttributeForUpdateUserId,
  updateUserBadgeForUpdateUserId,
  updateUserBlackListForUpdateUserId,
  updateUserBlackListForUpdateUserId2,
  updateUserCookingJobForUpdateUserId,
  updateUserDataForCloneUserForDebug,
  updateUserDataForDeleteReferral,
  updateUserDataForDeleteReferral2,
  updateUserDataForUpdateUserId,
  updateUserDataRecruiterForUpdateUserId,
  updateUserDataSenseiForUpdateUserId,
  updateUserDeviceForUpdateUserId,
  updateUserHomeForUpdateUserId,
  updateUserItemForUnequipAllGear,
  updateUserItemForUpdateUserId,
  updateUserJutsuForUnequipAllJutsus,
  updateUserJutsuForUpdateUserId,
  updateUserLikesForUpdateUserId,
  updateUserLiveActivityForUpdateUserId,
  updateUserNindoForUpdateUserId,
  updateUserPetForUpdateUserId,
  updateUserPollVoteForUpdateUserId,
  updateUserPushPreferenceForUpdateUserId,
  updateUserQueueForUpdateUserId,
  updateUserRaidBuffForUpdateUserId,
  updateUserReportCommentForUpdateUserId,
  updateUserReportForUpdateUserId,
  updateUserReportForUpdateUserId2,
  updateUserRequestForUpdateUserId,
  updateUserRequestForUpdateUserId2,
  updateUserReviewForUpdateUserId,
  updateUserReviewForUpdateUserId2,
  updateUserRewardsForUpdateUserId,
  updateUserRewardsForUpdateUserId2,
  updateUserTitleForUpdateUserId,
  updateUserUploadForUpdateUserId,
  updateUserVoteForUpdateUserId,
  updateVillageForUpdateUserId,
  updateWarKillForUpdateUserId,
  updateWarKillForUpdateUserId2,
  updateWebStoreOrderForUpdateUserId,
  updateWebStoreOrderForUpdateUserId2,
  validateDevelopmentBackup,
} from "@/queries/staff";
import {
  deleteSectorByNumber,
  fetchSector,
  fetchVillages,
  insertSectorReleaseLog,
} from "@/queries/village";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  serverError,
} from "@/server/api/trpc";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import {
  isDeletedStoreUserId,
  migrateStoreEntitlementRevocations,
  migrateStoreEntitlementStates,
  migrateStorePurchaseTransfers,
} from "@/server/utils/purchases/storeIdentity";
import { notifyRankedQueueChanged } from "@/server/utils/rankedQueue";
import {
  canClearSectors,
  canCloneUser,
  canControlBackups,
  canDeleteReferral,
  canModifyUserBadges,
  canSeeActivityEvents,
  canSeeIps,
  canUnequipAllUsers,
  canUnstuckVillage,
  canUseMonitoringTests,
  isSiteOwnerAccount,
  isStaffRole,
} from "@/utils/permissions";
import { idSchema } from "@/validators/misc";
import { userDeltaResponseSchema } from "@/validators/userCache";

/** Database table behind each content backup type. */
const BACKUP_TABLES = {
  bloodline: "Bloodline",
  jutsu: "Jutsu",
  item: "Item",
  ai: "UserData",
} as const;

export const staffRouter = createTRPCRouter({
  // Content Backups
  getBackups: protectedProcedure.query(async ({ ctx }) => {
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    if (!canControlBackups(user.role)) {
      throw serverError("FORBIDDEN", "Not allowed for you");
    }
    return listContentBackupForGetBackups(ctx.drizzle);
  }),
  createBackup: protectedProcedure
    .input(z.object({ type: z.enum(["bloodline", "jutsu", "item", "ai"]) }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);

      // Guard
      if (!canControlBackups(user.role)) {
        return errorResponse("Not allowed for you");
      }

      // Create backup SQL
      const tableName = BACKUP_TABLES[input.type];

      const result = (await executeSelectSqlForCreateBackup(
        ctx.drizzle,
        input,
        tableName,
      )) as unknown as {
        rows: Record<string, unknown>[];
      };

      const rows: Record<string, unknown>[] = result?.rows ?? [];
      if (rows.length === 0) {
        await insertContentBackupForCreateBackup(ctx.drizzle, input, tableName);
        return { success: true, message: "Backup created (empty dataset)" };
      }

      const columns = Object.keys(rows[0] ?? {});
      const esc = (v: string) =>
        v.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n");
      const toSqlVal = (val: unknown): string => {
        if (val === null || val === undefined) return "NULL";
        if (typeof val === "number" || typeof val === "bigint") return String(val);
        if (typeof val === "boolean") return val ? "1" : "0";
        if (val instanceof Date)
          return `'${esc(val.toISOString().slice(0, 19).replace("T", " "))}'`;
        if (typeof val === "string") return `'${esc(val)}'`;
        return `'${esc(JSON.stringify(val))}'`;
      };

      const valuesSql = rows
        .map((r) => `(${columns.map((c) => toSqlVal(r[c])).join(", ")})`)
        .join(",\n");

      const insertSql = `INSERT INTO \`${tableName}\` (${columns.map((c) => `\`${c}\``).join(", ")}) VALUES\n${valuesSql};`;

      await insertContentBackupForCreateBackup2(ctx.drizzle, input, insertSql);

      return { success: true, message: "Backup created" };
    }),

  pushBackupToDev: protectedProcedure
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, backup] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findContentBackupForPushBackupToDev(ctx.drizzle, input),
      ]);
      // Derived
      const devUrl = process.env.DEV_DATABASE_URL;

      // Guard
      if (!canControlBackups(user.role)) {
        return errorResponse("Not allowed for you");
      }
      if (!backup) return errorResponse("Backup not found");
      if (!devUrl) return errorResponse("No development database URL configured");
      if (!backup.sqlText || backup.sqlText.startsWith("/* Empty backup")) {
        return errorResponse("Backup is empty");
      }

      const client = new PlanetScaleClient({ url: devUrl });

      // Derived
      const tableName = BACKUP_TABLES[backup.type];

      // Validate the backup against the destination schema before deleting content.
      try {
        await validateDevelopmentBackup(client, backup.sqlText);
      } catch {
        return errorResponse(
          "Backup could not be validated against the development schema. No content was changed",
        );
      }
      await clearDevelopmentBackupTarget(client, tableName, backup.type === "ai");
      await applyDevelopmentBackup(client, backup.sqlText);

      return { success: true, message: "Backup pushed to dev" };
    }),
  throwError: protectedProcedure
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!canUseMonitoringTests(user.role)) {
        return errorResponse("Not allowed for you");
      }
      // Mutate
      throw new Error("Test error");
    }),
  throwTrpcError: protectedProcedure
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard so only staff can throw errors
      if (!canUseMonitoringTests(user.role)) {
        return errorResponse("Not allowed for you");
      }
      // Flushs error after the request is done
      after(async () => {
        await Sentry.flush(2000);
      });
      // Mutate
      throw serverError("INTERNAL_SERVER_ERROR", "Test error");
    }),
  unequipAllJutsus: protectedProcedure
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!canUnequipAllUsers(user)) {
        return errorResponse("You do not have permission to unequip all jutsus");
      }
      // Non-AI only — AI opponents keep equipped jutsu for combat.
      // Prefer NOT IN (isAi = true): AI accounts are few, so the subquery stays small;
      // IN (isAi = false) would materialize essentially every human userId.
      // Orphan userJutsu/loadout rows (userId missing from UserData) are included —
      // harmless for unequip-all.
      const [equipped, loadouts] = await Promise.all([
        updateUserJutsuForUnequipAllJutsus(ctx.drizzle),
        updateJutsuLoadoutForUnequipAllJutsus(ctx.drizzle),
      ]);
      await insertActionLogForMassUnequip(ctx.drizzle, user, {
        kind: "jutsu",
        equippedRows: equipped.rowsAffected,
        loadoutRows: loadouts.rowsAffected,
      });
      return {
        ...getUnequipAllJutsusUserUpdate({
          userIsAi: user.isAi,
          userJutsuLoadout: user.jutsuLoadout,
        }),
        success: true,
        message: `All jutsu has been unequipped for all non-AI users.`,
      };
    }),
  unequipAllGear: protectedProcedure
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx }) => {
      // Query
      const [user, sources] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchMasterySources(ctx.drizzle, ctx.userId),
      ]);
      // Guard
      if (!canUnequipAllUsers(user)) {
        return errorResponse("You do not have permission to unequip all gear");
      }
      // Non-AI only — AI opponents keep their equipped gear for combat.
      // Clear every item loadout (not only the active pointer), matching unequipAllJutsus.
      // Same NOT IN (isAi = true) pattern as unequipAllJutsus (small AI set vs all humans).
      const [equipped, loadouts] = await Promise.all([
        updateUserItemForUnequipAllGear(ctx.drizzle),
        updateItemLoadoutForUnequipAllGear(ctx.drizzle),
      ]);
      await insertActionLogForMassUnequip(ctx.drizzle, user, {
        kind: "gear",
        equippedRows: equipped.rowsAffected,
        loadoutRows: loadouts.rowsAffected,
      });
      return {
        ...getUnequipAllGearUserUpdate({ user, sources }),
        success: true,
        message: `All gear has been unequipped for all non-AI users.`,
      };
    }),
  forceAwake: protectedProcedure
    .output(userDeltaResponseSchema)
    .input(
      z.object({
        userId: z.string(),
        reason: z
          .string()
          .min(10, "Reason must be at least 10 characters")
          .transform((val) => val.trim()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Query - fetch users and queue entry in parallel
      const [user, targetUser, queueEntry, hunt] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.userId),
        findMpvpBattleUserForForceAwake(ctx.drizzle, input),
        findHuntingSessionForUser(ctx.drizzle, input),
      ]);
      // Guard
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!canUnstuckVillage(user.role)) return errorResponse("Not allowed for you");
      const endedAt = new Date();
      // Drizzle has no joined UPDATE builder. Cancel the captured run and release its
      // status together, only while neither the character nor its hunt has changed.
      // LEFT JOIN also recovers players without any Pyramid history or hunting session.
      const recovered = await retryOnDeadlock(() =>
        executeRecoverySqlForForceAwake(ctx.drizzle, targetUser, hunt, endedAt),
      );
      if (recovered.rowsAffected === 0)
        return errorResponse("The character's battle changed. Refresh and try again.");
      // Mutate - update status and clean up all queue entries
      await Promise.all([
        insertActionLogForForceAwake(ctx.drizzle, ctx, input, targetUser, queueEntry),
        // Delete only the fight captured before recovery; a newly admitted fight must survive.
        // Cleanup failure leaves a support-removable orphan. Old tabs may advance it, but
        // its cancelled session/version guard rejects terminal settlement before any payout.
        ...(hunt?.battleId ? [deleteBattleById(ctx.drizzle, hunt.battleId)] : []),
        // Clean up raid/clan/shrine battle queue
        deleteBattleQueueMembersForUser(ctx.drizzle, input.userId),
        // Clean up ranked PVP queue
        deleteRankedQueueForUser(ctx.drizzle, input.userId).then(async (result) => {
          await notifyRankedQueueChanged(result.rowsAffected);
        }),
      ]);
      // Clean up empty teams or stuck claiming states if user was in a team
      if (queueEntry) {
        const removed = await deleteEmptyQueueById(
          ctx.drizzle,
          queueEntry.clanBattleId,
        );
        if (removed.rowsAffected === 0) {
          // Members remain: reset a claiming battleId so they can start again
          const team = await findMpvpBattleQueueForForceAwake(ctx.drizzle, queueEntry);
          if (isBattleClaimId(team?.battleId)) {
            await clearQueueBattleId(ctx.drizzle, queueEntry.clanBattleId);
          }
        }
      }
      // Push status update to sector using target user's data (not staff member's)
      const output = {
        longitude: targetUser.longitude,
        latitude: targetUser.latitude,
        sector: targetUser.sector,
        avatar: targetUser.avatar,
        avatarLight: targetUser.avatarLight,
        level: targetUser.level,
        experience: targetUser.experience,
        rank: targetUser.rank,
        villageId: targetUser.villageId,
        battleId: null as string | null, // We're forcing awake, so battleId should be null
        username: targetUser.username,
        status: "AWAKE" as UserStatus,
        location: "",
        userId: input.userId,
      };
      const pusher = getServerPusher();
      void updateUserOnMap(pusher, targetUser.sector, output);
      // Done
      return {
        success: true,
        message: "You have changed user's state to awake",
        ...getForceAwakeUserUpdate({
          inputUserId: input.userId,
          ctxUserId: ctx.userId,
        }),
      };
    }),
  insertUserBadge: protectedProcedure
    .input(z.object({ userId: z.string(), badgeId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, badge] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchBadge(ctx.drizzle, input.badgeId),
      ]);
      // Guard
      if (!badge) return errorResponse("Badge not found");
      if (!canModifyUserBadges(user.role)) return errorResponse("Not allowed for you");
      // Mutate
      await Promise.all([
        insertUserBadgeForInsertUserBadge(ctx.drizzle, input),
        insertActionLogForInsertUserBadge(ctx.drizzle, ctx, badge, input, user),
      ]);
      return { success: true, message: "Badge added" };
    }),
  removeUserBadge: protectedProcedure
    .input(z.object({ userId: z.string(), badgeId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, badge, userbadge] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchBadge(ctx.drizzle, input.badgeId),
        findUserBadgeForRemoveUserBadge(ctx.drizzle, input),
      ]);
      // Guard
      if (!badge) return errorResponse("Badge not found");
      if (!userbadge) return errorResponse("Badge not found");
      if (!canModifyUserBadges(user.role)) return errorResponse("Not allowed for you");
      // Mutate
      await Promise.all([
        deleteUserBadgeForRemoveUserBadge(ctx.drizzle, input),
        insertActionLogForRemoveUserBadge(ctx.drizzle, ctx, badge, input, user),
      ]);

      return { success: true, message: "Badge removed" };
    }),
  // Copy a user's settings onto the calling staff member for debugging
  cloneUserForDebug: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, target, targetAttributes] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.userId),
        fetchAttributes(ctx.drizzle, input.userId),
      ]);
      if (!canCloneUser(user.role)) {
        return { success: false, message: "You are not allowed to clone users" };
      }
      if (canCloneUser(target.role)) {
        return { success: false, message: "Cannot copy people able to clone" };
      }
      const [targetJutsus, targetItems, targetQuestHistory, targetRankedUserRewards] =
        await Promise.all([
          listUserJutsuByUserId(ctx.drizzle, input.userId),
          listUserItemsByUserId(ctx.drizzle, input.userId),
          listQuestHistoryForCloneUserForDebug(ctx.drizzle, input),
          listRankedUserRewardsForCloneUserForDebug(ctx.drizzle, input),
        ]);
      await Promise.all([
        deleteUserJutsus(ctx.drizzle, user.userId),
        deleteUserItems(ctx.drizzle, user.userId),
        deleteUserQueues(ctx.drizzle, user.userId),
        deleteUserCookingJobs(ctx.drizzle, user.userId),
        deleteUserQuestHistory(ctx.drizzle, user.userId),
        deleteUserAttributes(ctx.drizzle, user.userId),
        deleteUserRankedRewards(ctx.drizzle, user.userId),
        ...(user.anbuId !== target.anbuId && user.anbuId
          ? [updateAnbuSquadForCloneUserForDebug(ctx.drizzle, { anbuId: user.anbuId })]
          : []),
        ...(user.anbuId !== target.anbuId && target.anbuId
          ? [incrementAnbuMemberCount(ctx.drizzle, target.anbuId)]
          : []),
        updateUserDataForCloneUserForDebug(ctx.drizzle, target, ctx),
      ]);
      // Insert data
      await Promise.all([
        ...(targetJutsus.length > 0
          ? [insertUserJutsuForCloneUserForDebug(ctx.drizzle, targetJutsus, ctx)]
          : []),
        ...(targetItems.length > 0
          ? [insertUserItemForCloneUserForDebug(ctx.drizzle, targetItems, ctx)]
          : []),
        ...(targetQuestHistory.length > 0
          ? [
              insertQuestHistoryForCloneUserForDebug(
                ctx.drizzle,
                targetQuestHistory,
                ctx,
              ),
            ]
          : []),
        ...(targetRankedUserRewards.length > 0
          ? [
              insertRankedUserRewardsForCloneUserForDebug(
                ctx.drizzle,
                targetRankedUserRewards,
                ctx,
              ),
            ]
          : []),
        ...(targetAttributes.length > 0
          ? [
              insertUserAttributeForCloneUserForDebug(
                ctx.drizzle,
                targetAttributes,
                ctx,
              ),
            ]
          : []),
      ]);
      return { success: true, message: "User copied" };
    }),
  getUserHistoricalIps: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!canSeeIps(user.role)) {
        throw serverError(
          "FORBIDDEN",
          "You don't have permission to view IP addresses",
        );
      }
      // Fetch historical IPs
      const historicalIps = await listHistoricalIpForGetUserHistoricalIps(
        ctx.drizzle,
        input,
      );
      return historicalIps;
    }),
  releaseSector: protectedProcedure
    .input(z.object({ sector: z.int() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetches
      const [sectorData, user, villages] = await Promise.all([
        fetchSector(ctx.drizzle, input.sector),
        findUserById(ctx.drizzle, ctx.userId),
        fetchVillages(ctx.drizzle),
      ]);

      // Guards
      if (!user) return errorResponse("Could not find user");
      if (!sectorData?.village) return errorResponse("Sector not found");
      if (!canClearSectors(user.role)) return errorResponse("Not allowed for you");
      if (villages?.find((v) => v.sector === input.sector)) {
        return errorResponse("Cannot clear sector with village/town/hideout in it");
      }

      // Mutate
      await Promise.all([
        deleteSectorByNumber(ctx.drizzle, input.sector),
        insertSectorReleaseLog(
          ctx.drizzle,
          ctx.userId,
          input.sector,
          sectorData.village.name,
          sectorData.villageId,
        ),
      ]);

      // Return
      return { success: true, message: "You have released the sector" };
    }),
  getUserActivityEvents: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!canSeeActivityEvents(user.role)) {
        throw serverError(
          "FORBIDDEN",
          "You don't have permission to view activity events",
        );
      }
      // Fetch activity events
      const activityEvents = await listUserActivityEventForGetUserActivityEvents(
        ctx.drizzle,
        input,
      );
      return activityEvents;
    }),
  // Update all occurrences of a user ID in the database to another userId.
  // VERY dangerous - used to e.g. link up unlinked accounts with new userIds from clerk
  updateUserId: protectedProcedure
    .input(z.object({ userId: z.string(), newUserId: z.string() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, fromUser, toUser, sourceAlias, destinationAlias] = await Promise.all(
        [
          fetchUser(ctx.drizzle, ctx.userId),
          findUserById(ctx.drizzle, input.userId),
          findUserById(ctx.drizzle, input.newUserId),
          findStoreUserIdAlias(ctx.drizzle, input.userId),
          findStoreUserIdAlias(ctx.drizzle, input.newUserId),
        ],
      );
      // Guard
      if (!isSiteOwnerAccount(user)) {
        return { success: false, message: "You are not Terriator" };
      }
      if (isDeletedStoreUserId(input.userId) || isDeletedStoreUserId(input.newUserId)) {
        return { success: false, message: "UserId is reserved" };
      }
      if (destinationAlias) {
        return {
          success: false,
          message: "UserId was previously used and is reserved",
        };
      }
      if (sourceAlias && isDeletedStoreUserId(sourceAlias.newUserId)) {
        return {
          success: false,
          message: "UserId is being deleted and cannot be renamed",
        };
      }
      // A rename that failed part-way left its alias behind, and may already have moved the
      // account row. Running it again with the same ids finishes it.
      const resuming = sourceAlias?.newUserId === input.newUserId;
      const movedAlready = resuming && !fromUser;
      if (sourceAlias && !resuming) {
        return { success: false, message: "UserId was already renamed to another id" };
      }
      if (!fromUser && !resuming) {
        return errorResponse("User not found");
      }
      if (toUser && !movedAlready) {
        return { success: false, message: "UserId already exists" };
      }
      if (fromUser && isStaffRole(fromUser.role)) {
        return { success: false, message: "Cannot change staff member's userId " };
      }
      // Battles carry immutable participant identities and settlement ownership.
      if (fromUser?.status === "BATTLE" || fromUser?.battleId)
        return errorResponse(
          "Finish the active battle before changing this character's userId.",
        );
      // Mutate. The alias goes first, as durable intent: from here a store event naming the
      // old id resolves to the new one, and a rename that fails part-way is finished by
      // running it again. Whoever writes that row first owns the identity, and it is read
      // back rather than assumed: a deletion that got in between the check above and this
      // write keeps its tombstone, and the rename stops here before moving anything.
      // A receipt that lands under the old id in between is re-homed by the ledger's
      // own owner reconciliation, so nothing here holds a lock.
      await insertStoreUserIdAlias(ctx.drizzle, input.userId, input.newUserId);
      const claim = await findStoreUserIdAlias(ctx.drizzle, input.userId);
      if (claim && isDeletedStoreUserId(claim.newUserId)) {
        return {
          success: false,
          message: "UserId is being deleted and cannot be renamed",
        };
      }
      if (claim?.newUserId !== input.newUserId) {
        return { success: false, message: "UserId was already renamed to another id" };
      }
      if (!movedAlready) {
        // Move the character first: admission either claimed its battle already, or
        // can no longer claim the retired ID. Related ownership moves start only after
        // this succeeds; the alias lets a retry finish any later partial failure.
        const renamed = await retryOnDeadlock(() =>
          updateUserDataForUpdateUserId(ctx.drizzle, input),
        );
        if (renamed.rowsAffected !== 1)
          return errorResponse(
            "The character's battle changed. Finish any active battle and retry the userId change.",
          );
      }
      const moves = await Promise.allSettled([
        renameCosmetics(ctx.drizzle, input.userId, input.newUserId),
        renameParentalContact(ctx.drizzle, input.userId, input.newUserId),
        updateUserTitleForUpdateUserId(ctx.drizzle, input),
        updateTitleForUpdateUserId(ctx.drizzle, input),
        updateAuctionOfferForUpdateUserId(ctx.drizzle, input),
        updateAuctionOfferForUpdateUserId2(ctx.drizzle, input),
        updateAiProfileForUpdateUserId(ctx.drizzle, input),
        updateDiscordLinkForUpdateUserId(ctx.drizzle, input),
        updateDiscordLinkHistoryForUpdateUserId(ctx.drizzle, input),
        updateUserBlackListForUpdateUserId(ctx.drizzle, input),
        updateUserBlackListForUpdateUserId2(ctx.drizzle, input),
        updateBloodlineRollsForUpdateUserId(ctx.drizzle, input),
        updateCaptchaForUpdateUserId(ctx.drizzle, input),
        updateMpvpBattleUserForUpdateUserId(ctx.drizzle, input),
        updateConversationForUpdateUserId(ctx.drizzle, input),
        updateUser2conversationForUpdateUserId(ctx.drizzle, input),
        updateConversationCommentForUpdateUserId(ctx.drizzle, input),
        updateDamageSimulationForUpdateUserId(ctx.drizzle, input),
        updateForumPostForUpdateUserId(ctx.drizzle, input),
        updateForumThreadForUpdateUserId(ctx.drizzle, input),
        updateHistoricalAvatarForUpdateUserId(ctx.drizzle, input),
        updateHistoricalIpForUpdateUserId(ctx.drizzle, input),
        updateUserActivityEventForUpdateUserId(ctx.drizzle, input),
        updateJutsuLoadoutForUpdateUserId(ctx.drizzle, input),
        updateNotificationForUpdateUserId(ctx.drizzle, input),
        updateStripeCheckoutForUpdateUserId(ctx.drizzle, input),
        updateStripeCheckoutForUpdateUserId2(ctx.drizzle, input),
        updateStripePaymentForUpdateUserId(ctx.drizzle, input),
        updateStripePaymentForUpdateUserId2(ctx.drizzle, input),
        updatePaypalSubscriptionForUpdateUserId(ctx.drizzle, input),
        updatePaypalSubscriptionForUpdateUserId2(ctx.drizzle, input),
        updateWebStoreOrderForUpdateUserId(ctx.drizzle, input),
        updateWebStoreOrderForUpdateUserId2(ctx.drizzle, input),
        updatePaypalTransactionForUpdateUserId(ctx.drizzle, input),
        updatePaypalTransactionForUpdateUserId2(ctx.drizzle, input),
        updateRyoTradeForUpdateUserId(ctx.drizzle, input),
        updateRyoTradeForUpdateUserId2(ctx.drizzle, input),
        updateRyoTradeForUpdateUserId3(ctx.drizzle, input),
        updateReportLogForUpdateUserId(ctx.drizzle, input),
        updateReportLogForUpdateUserId2(ctx.drizzle, input),
        updateActionLogForUpdateUserId(ctx.drizzle, input),
        updateTrainingLogForUpdateUserId(ctx.drizzle, input),
        updateUserAttributeForUpdateUserId(ctx.drizzle, input),
        updateUserReviewForUpdateUserId(ctx.drizzle, input),
        updateUserRewardsForUpdateUserId(ctx.drizzle, input),
        updateUserRewardsForUpdateUserId2(ctx.drizzle, input),
        updateUserReviewForUpdateUserId2(ctx.drizzle, input),
        updateUserNindoForUpdateUserId(ctx.drizzle, input),
        updateUserItemForUpdateUserId(ctx.drizzle, input),
        updateUserHomeForUpdateUserId(ctx.drizzle, input),
        ...[huntingSession, huntingProgress, huntingReceipt, adClick].map((table) =>
          updateTableForUpdateUserId(ctx.drizzle, table, input),
        ),
        updateUserJutsuForUpdateUserId(ctx.drizzle, input),
        updateUserReportForUpdateUserId(ctx.drizzle, input),
        updateUserReportForUpdateUserId2(ctx.drizzle, input),
        updateUserReportCommentForUpdateUserId(ctx.drizzle, input),
        updateBankTransfersForUpdateUserId(ctx.drizzle, input),
        updateBankTransfersForUpdateUserId2(ctx.drizzle, input),
        updateModerationScanForUpdateUserId(ctx.drizzle, input),
        updateAutomatedModerationForUpdateUserId(ctx.drizzle, input),
        updateSupportReviewForUpdateUserId(ctx.drizzle, input),
        updateKageDefendedChallengesForUpdateUserId(ctx.drizzle, input),
        updateKageDefendedChallengesForUpdateUserId2(ctx.drizzle, input),
        updateQuestHistoryForUpdateUserId(ctx.drizzle, input),
        updateUserLikesForUpdateUserId(ctx.drizzle, input),
        updateConceptImageForUpdateUserId(ctx.drizzle, input),
        updateUserBadgeForUpdateUserId(ctx.drizzle, input),
        updateUserRequestForUpdateUserId(ctx.drizzle, input),
        updateUserRequestForUpdateUserId2(ctx.drizzle, input),
        updateLinkPromotionForUpdateUserId(ctx.drizzle, input),
        updateLinkPromotionForUpdateUserId2(ctx.drizzle, input),
        updateUserVoteForUpdateUserId(ctx.drizzle, input),
        updatePollForUpdateUserId(ctx.drizzle, input),
        updatePollOptionForUpdateUserId(ctx.drizzle, input),
        updatePollOptionForUpdateUserId2(ctx.drizzle, input),
        updateVillageForUpdateUserId(ctx.drizzle, input),
        updateUserPollVoteForUpdateUserId(ctx.drizzle, input),
        updateUserUploadForUpdateUserId(ctx.drizzle, input),
        updateUserPetForUpdateUserId(ctx.drizzle, input),
        updateParentalControlForUpdateUserId(ctx.drizzle, input),
        updateUserDeviceForUpdateUserId(ctx.drizzle, input),
        updateUserPushPreferenceForUpdateUserId(ctx.drizzle, input),
        updateUserLiveActivityForUpdateUserId(ctx.drizzle, input),
        updateStoreUserIdAliasForUpdateUserId(ctx.drizzle, input),
        migrateStoreEntitlementStates(ctx.drizzle, input.userId, input.newUserId),
        migrateStoreEntitlementRevocations(ctx.drizzle, input.userId, input.newUserId),
        migrateStorePurchaseTransfers(ctx.drizzle, input.userId, input.newUserId),
        updateStorePurchaseForUpdateUserId(ctx.drizzle, input),
        updateStorePurchaseForUpdateUserId2(ctx.drizzle, input),
        updateUserQueueForUpdateUserId(ctx.drizzle, input),
        updateUserCookingJobForUpdateUserId(ctx.drizzle, input),
        updateUserRaidBuffForUpdateUserId(ctx.drizzle, input),
        ...[
          userSkill,
          farmPlot,
          farmExtraction,
          farmCollectionLog,
          userQuestAttempt,
          rankedUserRewards,
          rankedPvpQueue,
          raidParticipation,
        ].map((table) => updateTableForUpdateUserId(ctx.drizzle, table, input)),
        updateStaffApplicationForUpdateUserId(ctx.drizzle, input),
        updateWarKillForUpdateUserId(ctx.drizzle, input),
        updateWarKillForUpdateUserId2(ctx.drizzle, input),
        updateRecruitReferralForUpdateUserId(ctx.drizzle, input),
        updateRecruitReferralForUpdateUserId2(ctx.drizzle, input),
        updateRecruitRankMilestoneForUpdateUserId(ctx.drizzle, input),
        updateRecruitRankMilestoneForUpdateUserId2(ctx.drizzle, input),
        updateUserDataSenseiForUpdateUserId(ctx.drizzle, input),
        updateUserDataRecruiterForUpdateUserId(ctx.drizzle, input),
      ]);
      // Answer only once every move has settled, so the retry a failure invites never
      // races moves still in flight.
      const failed = moves.find((move) => move.status === "rejected");
      if (failed) throw failed.reason;

      return {
        success: true,
        message: "UserId updated",
        ...getUpdateUserIdUserUpdate({ userVillageId: user.villageId }),
      };
    }),
  // Delete referral from user
  deleteReferral: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, target] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.userId),
      ]);
      // Guard
      if (!canDeleteReferral(user.role)) {
        return errorResponse("You don't have permission to delete referrals");
      }
      if (!target.recruiterId) {
        return errorResponse("User has no recruiter to delete");
      }
      // Mutate
      await Promise.all([
        updateUserDataForDeleteReferral(ctx.drizzle, input),
        updateUserDataForDeleteReferral2(ctx.drizzle, {
          recruiterId: target.recruiterId,
        }),
        insertActionLogForDeleteReferral(ctx.drizzle, ctx, target, input),
      ]);
      return { success: true, message: `Referral removed from ${target.username}` };
    }),
});
