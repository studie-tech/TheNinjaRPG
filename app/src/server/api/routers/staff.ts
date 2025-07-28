import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { baseServerResponse, errorResponse } from "@/server/api/trpc";
import { fetchBadge } from "@/routers/badge";
import { fetchAttributes } from "@/routers/profile";
import { eq, ne, and, desc, sql } from "drizzle-orm";
import {
  actionLog,
  aiProfile,
  automatedModeration,
  bankTransfers,
  bloodlineRolls,
  captcha,
  conceptImage,
  conversation,
  conversationComment,
  damageSimulation,
  forumPost,
  forumThread,
  historicalAvatar,
  historicalIp,
  jutsuLoadout,
  kageDefendedChallenges,
  linkPromotion,
  mpvpBattleUser,
  notification,
  paypalSubscription,
  paypalTransaction,
  poll,
  pollOption,
  questHistory,
  reportLog,
  ryoTrade,
  sector,
  supportReview,
  trainingLog,
  user2conversation,
  userAttribute,
  userBadge,
  userBlackList,
  userData,
  userItem,
  userJutsu,
  userLikes,
  userNindo,
  userPollVote,
  userReport,
  userReportComment,
  userRequest,
  userReview,
  userRewards,
  userUpload,
  userVote,
  village,
  userActivityEvent,
  warKill,
} from "@/drizzle/schema";
import { fetchUpdatedUser, fetchUser } from "@/routers/profile";
import { getServerPusher, updateUserOnMap } from "@/libs/pusher";
import { fetchVillages } from "@/routers/village";
import { z } from "zod";
import { nanoid } from "nanoid";
import {
  canUnstuckVillage,
  canModifyUserBadges,
  canSeeIps,
  canSeeActivityEvents,
  canUnequipAllUsers,
  canRestoreActivityStreak,
  canUseMonitoringTests,
  canDeleteReferral,
} from "@/utils/permissions";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import { canCloneUser, canClearSectors } from "@/utils/permissions";
import { TRPCError } from "@trpc/server";
import type { inferRouterOutputs } from "@trpc/server";
import type { UserStatus } from "@/drizzle/constants";
import type { DrizzleClient } from "@/server/db";
import { fetchSector } from "./village";

export const staffRouter = createTRPCRouter({
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
      // Guard
      if (!canUseMonitoringTests(user.role)) {
        return errorResponse("Not allowed for you");
      }
      // Mutate
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Test error",
      });
    }),
  unequipAllGear: protectedProcedure
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!canUnequipAllUsers(user)) {
        return errorResponse("You do not have permission to unequip all gear");
      }
      // Update all equipped items to set equipped = 'NONE' for all users
      await ctx.drizzle
        .update(userItem)
        .set({ equipped: "NONE" })
        .where(ne(userItem.equipped, "NONE"));
      return {
        success: true,
        message: `All gear has been unequipped for all users.`,
      };
    }),
  forceAwake: protectedProcedure
    .output(baseServerResponse)
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, targetUser] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.userId),
      ]);
      // Guard
      if (!user) return errorResponse("User not found");
      if (!canUnstuckVillage(user.role)) return errorResponse("Not allowed for you");
      // Mutate
      await Promise.all([
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "user",
          relatedId: input.userId,
          relatedMsg: `Force updated status to awake from status: ${targetUser.status}`,
          changes: [`Previous BattleId: ${targetUser.battleId}`],
        }),
        ctx.drizzle
          .update(userData)
          .set({ status: "AWAKE", travelFinishAt: null, battleId: null })
          .where(eq(userData.userId, targetUser.userId)),
      ]);
      // Push status update to sector
      const output = {
        longitude: user.longitude,
        latitude: user.latitude,
        sector: user.sector,
        avatar: user.avatar,
        avatarLight: user.avatarLight,
        level: user.level,
        villageId: user.villageId,
        battleId: user.battleId,
        username: user.username,
        status: "AWAKE" as UserStatus,
        location: "",
        userId: ctx.userId,
      };
      const pusher = getServerPusher();
      void updateUserOnMap(pusher, user.sector, output);
      // Done
      return {
        success: true,
        message: "You have changed user's state to awake",
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
      if (!user) return errorResponse("User not found");
      if (!badge) return errorResponse("Badge not found");
      if (!canModifyUserBadges(user.role)) return errorResponse("Not allowed for you");
      // Mutate
      await Promise.all([
        ctx.drizzle
          .insert(userBadge)
          .values([{ userId: input.userId, badgeId: input.badgeId }]),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "user",
          changes: [`Insert badge: ${badge.name}`],
          relatedId: input.userId,
          relatedMsg: `Insert badge: ${badge.name}`,
          relatedImage: user.avatarLight,
        }),
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
        ctx.drizzle.query.userBadge.findFirst({
          where: and(
            eq(userBadge.userId, input.userId),
            eq(userBadge.badgeId, input.badgeId),
          ),
        }),
      ]);
      // Guard
      if (!user) return errorResponse("User not found");
      if (!badge) return errorResponse("Badge not found");
      if (!userbadge) return errorResponse("Badge not found");
      if (!canModifyUserBadges(user.role)) return errorResponse("Not allowed for you");
      // Mutate
      await Promise.all([
        ctx.drizzle
          .delete(userBadge)
          .where(
            and(
              eq(userBadge.userId, input.userId),
              eq(userBadge.badgeId, input.badgeId),
            ),
          ),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "user",
          changes: [`Remove badge: ${badge.name}`],
          relatedId: input.userId,
          relatedMsg: `Remove badge: ${badge.name}`,
          relatedImage: user.avatarLight,
        }),
      ]);

      return { success: true, message: "Badge removed" };
    }),
  // Copy user setting to Terriator - exclusive to Terriator user for debugging
  cloneUserForDebug: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, target, targetAttributes] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.userId),
        fetchAttributes(ctx.drizzle, ctx.userId),
        fetchAttributes(ctx.drizzle, input.userId),
      ]);
      if (!user || !target) {
        return { success: false, message: "User not found" };
      }
      if (!canCloneUser(user.role)) {
        return { success: false, message: "You are not allowed to clone users" };
      }
      if (canCloneUser(target.role)) {
        return { success: false, message: "Cannot copy people able to clone" };
      }
      const [targetJutsus, targetItems, targetQuestHistory] = await Promise.all([
        ctx.drizzle.query.userJutsu.findMany({
          where: eq(userJutsu.userId, input.userId),
        }),
        ctx.drizzle.query.userItem.findMany({
          where: eq(userItem.userId, input.userId),
        }),
        ctx.drizzle.query.questHistory.findMany({
          where: eq(questHistory.userId, input.userId),
        }),
      ]);
      await Promise.all([
        ctx.drizzle.delete(userJutsu).where(eq(userJutsu.userId, user.userId)),
        ctx.drizzle.delete(userItem).where(eq(userItem.userId, user.userId)),
        ctx.drizzle.delete(questHistory).where(eq(questHistory.userId, user.userId)),
        ctx.drizzle.delete(userAttribute).where(eq(userAttribute.userId, user.userId)),
        ctx.drizzle
          .update(userData)
          .set({
            curHealth: target.curHealth,
            maxHealth: target.maxHealth,
            curStamina: target.curStamina,
            maxStamina: target.maxStamina,
            curChakra: target.curChakra,
            maxChakra: target.maxChakra,
            money: target.money,
            bank: target.bank,
            experience: target.experience,
            rank: target.rank,
            level: target.level,
            villageId: target.villageId,
            bloodlineId: target.bloodlineId,
            strength: target.strength,
            speed: target.speed,
            intelligence: target.intelligence,
            willpower: target.willpower,
            gender: target.gender,
            ninjutsuOffence: target.ninjutsuOffence,
            ninjutsuDefence: target.ninjutsuDefence,
            genjutsuOffence: target.genjutsuOffence,
            genjutsuDefence: target.genjutsuDefence,
            taijutsuOffence: target.taijutsuOffence,
            taijutsuDefence: target.taijutsuDefence,
            bukijutsuOffence: target.bukijutsuOffence,
            bukijutsuDefence: target.bukijutsuDefence,
            questData: target.questData,
            isOutlaw: target.isOutlaw,
            sector: target.sector,
            latitude: target.latitude,
            longitude: target.longitude,
            clanId: target.clanId,
            anbuId: target.anbuId,
          })
          .where(eq(userData.userId, ctx.userId)),
      ]);
      if (targetJutsus.length > 0) {
        await ctx.drizzle.insert(userJutsu).values(
          targetJutsus.map((userjutsu) => ({
            ...userjutsu,
            userId: ctx.userId,
            id: nanoid(),
          })),
        );
      }
      if (targetItems.length > 0) {
        await ctx.drizzle.insert(userItem).values(
          targetItems.map((useritem) => ({
            ...useritem,
            userId: ctx.userId,
            id: nanoid(),
          })),
        );
      }
      if (targetQuestHistory.length > 0) {
        await ctx.drizzle.insert(questHistory).values(
          targetQuestHistory.map((questhistory) => ({
            ...questhistory,
            userId: ctx.userId,
            id: nanoid(),
          })),
        );
      }
      if (targetAttributes) {
        await ctx.drizzle.insert(userAttribute).values(
          targetAttributes.map((attribute) => ({
            ...attribute,
            userId: ctx.userId,
            id: nanoid(),
          })),
        );
      }
      return { success: true, message: "User copied" };
    }),
  getUserHistoricalIps: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!canSeeIps(user.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have permission to view IP addresses",
        });
      }
      // Fetch historical IPs
      const historicalIps = await ctx.drizzle.query.historicalIp.findMany({
        where: eq(historicalIp.userId, input.userId),
        orderBy: [desc(historicalIp.usedAt)],
        limit: 100, // Limit to last 100 IP records
      });
      return historicalIps;
    }),
  releaseSector: protectedProcedure
    .input(z.object({ sector: z.number().int() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetches
      const [sectorData, { user }, villages] = await Promise.all([
        fetchSector(ctx.drizzle, input.sector),
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
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
        ctx.drizzle.delete(sector).where(eq(sector.sector, input.sector)),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "war",
          changes: [`Released sector ${input.sector} from ${sectorData.village.name}`],
          relatedId: sectorData.villageId,
          relatedMsg: `Released sector ${input.sector}`,
          relatedImage: IMG_AVATAR_DEFAULT,
        }),
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
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have permission to view activity events",
        });
      }
      // Fetch activity events
      const activityEvents = await ctx.drizzle.query.userActivityEvent.findMany({
        where: eq(userActivityEvent.userId, input.userId),
        orderBy: [desc(userActivityEvent.createdAt)],
        limit: 100, // Limit to last 100 activity events
      });
      return activityEvents;
    }),
  // Restore user activity streak based on activity event
  restoreUserActivityStreak: protectedProcedure
    .input(z.object({ userId: z.string(), activityEventId: z.number() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, target, activity] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.userId),
        ctx.drizzle.query.userActivityEvent.findFirst({
          where: eq(userActivityEvent.id, input.activityEventId),
        }),
      ]);
      // Guard
      if (!user) return errorResponse("User not found");
      if (!target) return errorResponse("Target user not found");
      if (!activity) return errorResponse("Activity event not found");
      if (!canRestoreActivityStreak(user.role)) {
        return errorResponse("Not allowed for you");
      }
      // Mutate
      await ctx.drizzle
        .update(userData)
        .set({ activityStreak: activity.streak })
        .where(eq(userData.userId, target.userId));
      return { success: true, message: "Activity streak restored" };
    }),
  // Update all occurances of a user ID in the database to another userId.
  // VERY dangerous - used to e.g. link up unlinked accounts with new userIds from clerk
  updateUserId: protectedProcedure
    .input(z.object({ userId: z.string(), newUserId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, fromUser, toUser] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.userId),
        ctx.drizzle.query.userData.findFirst({
          where: eq(userData.userId, input.newUserId),
        }),
      ]);
      // Guard
      if (toUser) {
        return { success: false, message: "UserId already exists" };
      }
      if (user.username !== "Terriator") {
        return { success: false, message: "You are not Terriator" };
      }
      if (fromUser.role !== "USER") {
        return { success: false, message: "Cannot change staff member's userId " };
      }
      // Mutate
      await Promise.all([
        ctx.drizzle
          .update(userData)
          .set({ userId: input.newUserId })
          .where(eq(userData.userId, input.userId)),
        ctx.drizzle
          .update(aiProfile)
          .set({ userId: input.newUserId })
          .where(eq(aiProfile.userId, input.userId)),
        ctx.drizzle
          .update(userBlackList)
          .set({ creatorUserId: input.newUserId })
          .where(eq(userBlackList.creatorUserId, input.userId)),
        ctx.drizzle
          .update(userBlackList)
          .set({ targetUserId: input.newUserId })
          .where(eq(userBlackList.targetUserId, input.userId)),
        ctx.drizzle
          .update(bloodlineRolls)
          .set({ userId: input.newUserId })
          .where(eq(bloodlineRolls.userId, input.userId)),
        ctx.drizzle
          .update(captcha)
          .set({ userId: input.newUserId })
          .where(eq(captcha.userId, input.userId)),
        ctx.drizzle
          .update(mpvpBattleUser)
          .set({ userId: input.newUserId })
          .where(eq(mpvpBattleUser.userId, input.userId)),
        ctx.drizzle
          .update(conversation)
          .set({ createdById: input.newUserId })
          .where(eq(conversation.createdById, input.userId)),
        ctx.drizzle
          .update(user2conversation)
          .set({ userId: input.newUserId })
          .where(eq(user2conversation.userId, input.userId)),
        ctx.drizzle
          .update(conversationComment)
          .set({ userId: input.newUserId })
          .where(eq(conversationComment.userId, input.userId)),
        ctx.drizzle
          .update(damageSimulation)
          .set({ userId: input.newUserId })
          .where(eq(damageSimulation.userId, input.userId)),
        ctx.drizzle
          .update(forumPost)
          .set({ userId: input.newUserId })
          .where(eq(forumPost.userId, input.userId)),
        ctx.drizzle
          .update(forumThread)
          .set({ userId: input.newUserId })
          .where(eq(forumThread.userId, input.userId)),
        ctx.drizzle
          .update(historicalAvatar)
          .set({ userId: input.newUserId })
          .where(eq(historicalAvatar.userId, input.userId)),
        ctx.drizzle
          .update(historicalIp)
          .set({ userId: input.newUserId })
          .where(eq(historicalIp.userId, input.userId)),
        ctx.drizzle
          .update(userActivityEvent)
          .set({ userId: input.newUserId })
          .where(eq(userActivityEvent.userId, input.userId)),
        ctx.drizzle
          .update(jutsuLoadout)
          .set({ userId: input.newUserId })
          .where(eq(jutsuLoadout.userId, input.userId)),
        ctx.drizzle
          .update(notification)
          .set({ userId: input.newUserId })
          .where(eq(notification.userId, input.userId)),
        ctx.drizzle
          .update(paypalSubscription)
          .set({ createdById: input.newUserId })
          .where(eq(paypalSubscription.createdById, input.userId)),
        ctx.drizzle
          .update(paypalSubscription)
          .set({ affectedUserId: input.newUserId })
          .where(eq(paypalSubscription.affectedUserId, input.userId)),
        ctx.drizzle
          .update(paypalTransaction)
          .set({ affectedUserId: input.newUserId })
          .where(eq(paypalTransaction.affectedUserId, input.userId)),
        ctx.drizzle
          .update(paypalTransaction)
          .set({ createdById: input.newUserId })
          .where(eq(paypalTransaction.createdById, input.userId)),
        ctx.drizzle
          .update(ryoTrade)
          .set({ creatorUserId: input.newUserId })
          .where(eq(ryoTrade.creatorUserId, input.userId)),
        ctx.drizzle
          .update(ryoTrade)
          .set({ purchaserUserId: input.newUserId })
          .where(eq(ryoTrade.purchaserUserId, input.userId)),
        ctx.drizzle
          .update(ryoTrade)
          .set({ allowedPurchaserId: input.newUserId })
          .where(eq(ryoTrade.allowedPurchaserId, input.userId)),
        ctx.drizzle
          .update(reportLog)
          .set({ targetUserId: input.newUserId })
          .where(eq(reportLog.targetUserId, input.userId)),
        ctx.drizzle
          .update(reportLog)
          .set({ staffUserId: input.newUserId })
          .where(eq(reportLog.staffUserId, input.userId)),
        ctx.drizzle
          .update(actionLog)
          .set({ userId: input.newUserId })
          .where(eq(actionLog.userId, input.userId)),
        ctx.drizzle
          .update(trainingLog)
          .set({ userId: input.newUserId })
          .where(eq(trainingLog.userId, input.userId)),
        ctx.drizzle
          .update(userAttribute)
          .set({ userId: input.newUserId })
          .where(eq(userAttribute.userId, input.userId)),
        ctx.drizzle
          .update(userReview)
          .set({ authorUserId: input.newUserId })
          .where(eq(userReview.authorUserId, input.userId)),
        ctx.drizzle
          .update(userRewards)
          .set({ awardedById: input.newUserId })
          .where(eq(userRewards.awardedById, input.userId)),
        ctx.drizzle
          .update(userRewards)
          .set({ receiverId: input.newUserId })
          .where(eq(userRewards.receiverId, input.userId)),
        ctx.drizzle
          .update(userReview)
          .set({ targetUserId: input.newUserId })
          .where(eq(userReview.targetUserId, input.userId)),
        ctx.drizzle
          .update(userNindo)
          .set({ userId: input.newUserId })
          .where(eq(userNindo.userId, input.userId)),
        ctx.drizzle
          .update(userItem)
          .set({ userId: input.newUserId })
          .where(eq(userItem.userId, input.userId)),
        ctx.drizzle
          .update(userJutsu)
          .set({ userId: input.newUserId })
          .where(eq(userJutsu.userId, input.userId)),
        ctx.drizzle
          .update(userReport)
          .set({ reporterUserId: input.newUserId })
          .where(eq(userReport.reporterUserId, input.userId)),
        ctx.drizzle
          .update(userReport)
          .set({ reportedUserId: input.newUserId })
          .where(eq(userReport.reportedUserId, input.userId)),
        ctx.drizzle
          .update(userReportComment)
          .set({ userId: input.newUserId })
          .where(eq(userReportComment.userId, input.userId)),
        ctx.drizzle
          .update(bankTransfers)
          .set({ senderId: input.newUserId })
          .where(eq(bankTransfers.senderId, input.userId)),
        ctx.drizzle
          .update(bankTransfers)
          .set({ receiverId: input.newUserId })
          .where(eq(bankTransfers.receiverId, input.userId)),
        ctx.drizzle
          .update(automatedModeration)
          .set({ userId: input.newUserId })
          .where(eq(automatedModeration.userId, input.userId)),
        ctx.drizzle
          .update(supportReview)
          .set({ userId: input.newUserId })
          .where(eq(supportReview.userId, input.userId)),
        ctx.drizzle
          .update(kageDefendedChallenges)
          .set({ userId: input.newUserId })
          .where(eq(kageDefendedChallenges.userId, input.userId)),
        ctx.drizzle
          .update(kageDefendedChallenges)
          .set({ kageId: input.newUserId })
          .where(eq(kageDefendedChallenges.kageId, input.userId)),
        ctx.drizzle
          .update(questHistory)
          .set({ userId: input.newUserId })
          .where(eq(questHistory.userId, input.userId)),
        ctx.drizzle
          .update(userLikes)
          .set({ userId: input.newUserId })
          .where(eq(userLikes.userId, input.userId)),
        ctx.drizzle
          .update(conceptImage)
          .set({ userId: input.newUserId })
          .where(eq(conceptImage.userId, input.userId)),
        ctx.drizzle
          .update(userBadge)
          .set({ userId: input.newUserId })
          .where(eq(userBadge.userId, input.userId)),
        ctx.drizzle
          .update(userRequest)
          .set({ senderId: input.newUserId })
          .where(eq(userRequest.senderId, input.userId)),
        ctx.drizzle
          .update(userRequest)
          .set({ receiverId: input.newUserId })
          .where(eq(userRequest.receiverId, input.userId)),
        ctx.drizzle
          .update(linkPromotion)
          .set({ userId: input.newUserId })
          .where(eq(linkPromotion.userId, input.userId)),
        ctx.drizzle
          .update(linkPromotion)
          .set({ reviewedBy: input.newUserId })
          .where(eq(linkPromotion.reviewedBy, input.userId)),
        ctx.drizzle
          .update(userVote)
          .set({ userId: input.newUserId })
          .where(eq(userVote.userId, input.userId)),
        ctx.drizzle
          .update(poll)
          .set({ createdByUserId: input.newUserId })
          .where(eq(poll.createdByUserId, input.userId)),
        ctx.drizzle
          .update(pollOption)
          .set({ targetUserId: input.newUserId })
          .where(eq(pollOption.targetUserId, input.userId)),
        ctx.drizzle
          .update(pollOption)
          .set({ createdByUserId: input.newUserId })
          .where(eq(pollOption.createdByUserId, input.userId)),
        ctx.drizzle
          .update(village)
          .set({ kageId: input.newUserId })
          .where(eq(village.kageId, input.userId)),
        ctx.drizzle
          .update(userPollVote)
          .set({ userId: input.newUserId })
          .where(eq(userPollVote.userId, input.userId)),
        ctx.drizzle
          .update(userUpload)
          .set({ userId: input.newUserId })
          .where(eq(userUpload.userId, input.userId)),
      ]);

      return { success: true, message: "UserId updated" };
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
      if (!target) {
        return errorResponse("Target user not found");
      }
      if (!target.recruiterId) {
        return errorResponse("User has no recruiter to delete");
      }
      // Get recruiter info for logging
      const recruiter = await ctx.drizzle.query.userData.findFirst({
        where: eq(userData.userId, target.recruiterId),
        columns: { username: true },
      });
      // Mutate
      await Promise.all([
        ctx.drizzle
          .update(userData)
          .set({ recruiterId: null })
          .where(eq(userData.userId, input.userId)),
        ctx.drizzle
          .update(userData)
          .set({ nRecruited: sql`${userData.nRecruited} - 1` })
          .where(eq(userData.userId, target.recruiterId)),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "user",
          changes: [`Removed referral: ${target.username}`],
          relatedId: input.userId,
          relatedMsg: `Referral has been removed`,
          relatedImage: target.avatarLight,
        }),
      ]);
      return { success: true, message: `Referral removed from ${target.username}` };
    }),
});

export type staffRouter = inferRouterOutputs<typeof staffRouter>;

/**
 * Delete a user from the database.
 * @param client - The database client.
 * @param userId - The ID of the user to delete.
 */
export const deleteUser = async (client: DrizzleClient, userId: string) => {
  await Promise.all([
    client
      .update(userData)
      .set({ senseiId: null })
      .where(eq(userData.senseiId, userId)),
    client.delete(userData).where(eq(userData.userId, userId)),
    client.delete(mpvpBattleUser).where(eq(mpvpBattleUser.userId, userId)),
    client.delete(bloodlineRolls).where(eq(bloodlineRolls.userId, userId)),
    client.delete(conversation).where(eq(conversation.createdById, userId)),
    client.delete(user2conversation).where(eq(user2conversation.userId, userId)),
    client.delete(conversationComment).where(eq(conversationComment.userId, userId)),
    client.delete(damageSimulation).where(eq(damageSimulation.userId, userId)),
    client.delete(forumPost).where(eq(forumPost.userId, userId)),
    client.delete(forumThread).where(eq(forumThread.userId, userId)),
    client.delete(historicalAvatar).where(eq(historicalAvatar.userId, userId)),
    client.delete(historicalIp).where(eq(historicalIp.userId, userId)),
    client.delete(userActivityEvent).where(eq(userActivityEvent.userId, userId)),
    client.delete(jutsuLoadout).where(eq(jutsuLoadout.userId, userId)),
    client.delete(notification).where(eq(notification.userId, userId)),
    client.delete(ryoTrade).where(eq(ryoTrade.creatorUserId, userId)),
    client.delete(ryoTrade).where(eq(ryoTrade.purchaserUserId, userId)),
    client.delete(ryoTrade).where(eq(ryoTrade.allowedPurchaserId, userId)),
    client.delete(reportLog).where(eq(reportLog.targetUserId, userId)),
    client.delete(reportLog).where(eq(reportLog.staffUserId, userId)),
    client.delete(actionLog).where(eq(actionLog.userId, userId)),
    client.delete(trainingLog).where(eq(trainingLog.userId, userId)),
    client.delete(userAttribute).where(eq(userAttribute.userId, userId)),
    client.delete(userReview).where(eq(userReview.authorUserId, userId)),
    client.delete(userRewards).where(eq(userRewards.awardedById, userId)),
    client.delete(userRewards).where(eq(userRewards.receiverId, userId)),
    client.delete(userReview).where(eq(userReview.targetUserId, userId)),
    client.delete(userNindo).where(eq(userNindo.userId, userId)),
    client.delete(userItem).where(eq(userItem.userId, userId)),
    client.delete(userJutsu).where(eq(userJutsu.userId, userId)),
    client.delete(userReport).where(eq(userReport.reporterUserId, userId)),
    client.delete(userReport).where(eq(userReport.reportedUserId, userId)),
    client.delete(userReportComment).where(eq(userReportComment.userId, userId)),
    client.delete(bankTransfers).where(eq(bankTransfers.senderId, userId)),
    client.delete(bankTransfers).where(eq(bankTransfers.receiverId, userId)),
    client.delete(automatedModeration).where(eq(automatedModeration.userId, userId)),
    client.delete(supportReview).where(eq(supportReview.userId, userId)),
    client
      .delete(kageDefendedChallenges)
      .where(eq(kageDefendedChallenges.userId, userId)),
    client
      .delete(kageDefendedChallenges)
      .where(eq(kageDefendedChallenges.kageId, userId)),
    client.delete(questHistory).where(eq(questHistory.userId, userId)),
    client.delete(userLikes).where(eq(userLikes.userId, userId)),
    client.delete(conceptImage).where(eq(conceptImage.userId, userId)),
    client.delete(userBadge).where(eq(userBadge.userId, userId)),
    client.delete(userRequest).where(eq(userRequest.senderId, userId)),
    client.delete(userRequest).where(eq(userRequest.receiverId, userId)),
    client.delete(linkPromotion).where(eq(linkPromotion.userId, userId)),
    client.delete(linkPromotion).where(eq(linkPromotion.reviewedBy, userId)),
    client.delete(userVote).where(eq(userVote.userId, userId)),
    client.delete(poll).where(eq(poll.createdByUserId, userId)),
    client.delete(pollOption).where(eq(pollOption.targetUserId, userId)),
    client.delete(pollOption).where(eq(pollOption.createdByUserId, userId)),
    client.delete(userPollVote).where(eq(userPollVote.userId, userId)),
    client.delete(userUpload).where(eq(userUpload.userId, userId)),
    client.delete(warKill).where(eq(warKill.killerId, userId)),
    client.delete(warKill).where(eq(warKill.victimId, userId)),
  ]);
};
