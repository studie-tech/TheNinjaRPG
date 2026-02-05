import { Client as PlanetScaleClient } from "@planetscale/database";
import * as Sentry from "@sentry/nextjs";
import type { inferRouterOutputs } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { after } from "next/server";
import { z } from "zod";
import type { UserStatus } from "@/drizzle/constants";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import {
  actionLog,
  aiProfile,
  automatedModeration,
  bankTransfers,
  bloodlineRolls,
  captcha,
  conceptImage,
  contentBackup,
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
  mpvpBattleQueue,
  mpvpBattleUser,
  notification,
  paypalSubscription,
  paypalTransaction,
  poll,
  pollOption,
  questHistory,
  raidParticipation,
  rankedPvpQueue,
  rankedUserRewards,
  reportLog,
  ryoTrade,
  sector,
  staffApplication,
  supportReview,
  trainingLog,
  user2conversation,
  userActivityEvent,
  userAttribute,
  userBadge,
  userBlackList,
  userData,
  userItem,
  userJutsu,
  userLikes,
  userNindo,
  userPollVote,
  userRaidBuff,
  userReport,
  userReportComment,
  userRequest,
  userReview,
  userRewards,
  userSkill,
  userUpload,
  userVote,
  village,
  warKill,
} from "@/drizzle/schema";
import { getServerPusher, updateUserOnMap } from "@/libs/pusher";
import { fetchBadge } from "@/routers/badge";
import { fetchAttributes, fetchUpdatedUser, fetchUser } from "@/routers/profile";
import { fetchVillages } from "@/routers/village";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
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
} from "@/utils/permissions";
import { fetchSector } from "./village";

export const staffRouter = createTRPCRouter({
  // Content Backups
  getBackups: protectedProcedure.query(async ({ ctx }) => {
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    if (!canControlBackups(user.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Not allowed for you" });
    }
    return ctx.drizzle.query.contentBackup.findMany({
      orderBy: (table, { desc }) => [desc(table.createdAt)],
      limit: 200,
    });
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
      const tableMap: Record<typeof input.type, string> = {
        bloodline: "Bloodline",
        jutsu: "Jutsu",
        item: "Item",
        ai: "UserData",
      };

      const tableName = tableMap[input.type];

      // Build SELECT query
      const selectSql =
        input.type === "ai"
          ? sql`SELECT * FROM ${sql.raw(tableName)} WHERE isAi = true`
          : sql`SELECT * FROM ${sql.raw(tableName)}`;

      const result = (await ctx.drizzle.execute(selectSql)) as unknown as {
        rows: Record<string, unknown>[];
      };

      const rows: Record<string, unknown>[] = result?.rows ?? [];
      if (rows.length === 0) {
        await ctx.drizzle.insert(contentBackup).values({
          id: nanoid(),
          type: input.type,
          sqlText: `/* Empty backup for ${tableName} at ${new Date().toISOString()} */`,
        });
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

      await ctx.drizzle.insert(contentBackup).values({
        id: nanoid(),
        type: input.type,
        sqlText: insertSql,
      });

      return { success: true, message: "Backup created" };
    }),

  pushBackupToDev: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, backup] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.contentBackup.findFirst({
          where: eq(contentBackup.id, input.id),
        }),
      ]);
      // Derived
      const devUrl = process.env.DEV_DATABASE_URL;

      // Guard
      if (!canControlBackups(user.role)) {
        return errorResponse("Not allowed for you");
      }
      if (!backup) return errorResponse("Backup not found");
      if (!devUrl) return errorResponse("DEV database URL not configured");
      if (!backup.sqlText || backup.sqlText.startsWith("/* Empty backup")) {
        return errorResponse("Backup is empty");
      }

      // Setup client
      const dev_client = new PlanetScaleClient({ url: devUrl });

      // Derived
      const tableMap: Record<typeof backup.type, string> = {
        bloodline: "Bloodline",
        jutsu: "Jutsu",
        item: "Item",
        ai: "UserData",
      };
      const tableName = tableMap[backup.type];

      // Clear dev table content
      if (backup.type === "ai") {
        await dev_client.execute(`DELETE FROM \`${tableName}\` WHERE isAi = 1`);
      } else {
        await dev_client.execute(`DELETE FROM \`${tableName}\``);
      }

      if (backup.sqlText && !backup.sqlText.startsWith("/* Empty backup")) {
        await dev_client.execute(backup.sqlText);
      }

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
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Test error",
      });
    }),
  unequipAllJutsus: protectedProcedure
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!canUnequipAllUsers(user)) {
        return errorResponse("You do not have permission to unequip all jutsus");
      }
      // Update all equipped jutsus to set equipped = 0 for all users and clear loadouts
      await Promise.all([
        ctx.drizzle
          .update(userJutsu)
          .set({ equipped: false })
          .where(ne(userJutsu.equipped, false)),
        ctx.drizzle.update(jutsuLoadout).set({ jutsuIds: [] }),
      ]);
      return {
        success: true,
        message: `All jutsu has been unequipped for all users.`,
      };
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
      const [user, targetUser, queueEntry] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.userId),
        ctx.drizzle.query.mpvpBattleUser.findFirst({
          where: eq(mpvpBattleUser.userId, input.userId),
        }),
      ]);
      // Guard
      if (!user) return errorResponse("User not found");
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!canUnstuckVillage(user.role)) return errorResponse("Not allowed for you");
      // Mutate - update status and clean up all queue entries
      await Promise.all([
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "user",
          relatedId: input.userId,
          relatedMsg: `Force updated status to awake from status: ${targetUser.status}`,
          changes: [
            `Previous BattleId: ${targetUser.battleId}`,
            `Reason: ${input.reason}`,
            `Cleared queue entries: mpvpBattleUser=${queueEntry ? "yes" : "no"}`,
          ],
        }),
        ctx.drizzle
          .update(userData)
          .set({ status: "AWAKE", travelFinishAt: null, battleId: null })
          .where(eq(userData.userId, targetUser.userId)),
        // Clean up raid/clan/shrine battle queue
        ctx.drizzle
          .delete(mpvpBattleUser)
          .where(eq(mpvpBattleUser.userId, input.userId)),
        // Clean up ranked PVP queue
        ctx.drizzle
          .delete(rankedPvpQueue)
          .where(eq(rankedPvpQueue.userId, input.userId)),
      ]);
      // Clean up empty teams or stuck claiming states if user was in a team
      if (queueEntry) {
        const remainingMembers = await ctx.drizzle.query.mpvpBattleUser.findMany({
          where: eq(mpvpBattleUser.clanBattleId, queueEntry.clanBattleId),
        });
        if (remainingMembers.length === 0) {
          // Delete the queue entry - team is now empty
          await ctx.drizzle
            .delete(mpvpBattleQueue)
            .where(eq(mpvpBattleQueue.id, queueEntry.clanBattleId));
        } else {
          // If there are remaining members but battleId is a claiming ID, reset it
          const team = await ctx.drizzle.query.mpvpBattleQueue.findFirst({
            where: eq(mpvpBattleQueue.id, queueEntry.clanBattleId),
          });
          if (team?.battleId?.startsWith("claiming-")) {
            await ctx.drizzle
              .update(mpvpBattleQueue)
              .set({ battleId: null })
              .where(eq(mpvpBattleQueue.id, queueEntry.clanBattleId));
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
      const [targetJutsus, targetItems, targetQuestHistory, targetRankedUserRewards] =
        await Promise.all([
          ctx.drizzle.query.userJutsu.findMany({
            where: eq(userJutsu.userId, input.userId),
          }),
          ctx.drizzle.query.userItem.findMany({
            where: eq(userItem.userId, input.userId),
          }),
          ctx.drizzle.query.questHistory.findMany({
            where: eq(questHistory.userId, input.userId),
          }),
          ctx.drizzle.query.rankedUserRewards.findMany({
            where: eq(rankedUserRewards.userId, input.userId),
          }),
        ]);
      await Promise.all([
        ctx.drizzle.delete(userJutsu).where(eq(userJutsu.userId, user.userId)),
        ctx.drizzle.delete(userItem).where(eq(userItem.userId, user.userId)),
        ctx.drizzle.delete(questHistory).where(eq(questHistory.userId, user.userId)),
        ctx.drizzle.delete(userAttribute).where(eq(userAttribute.userId, user.userId)),
        ctx.drizzle
          .delete(rankedUserRewards)
          .where(eq(rankedUserRewards.userId, user.userId)),
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
            earnedExperience: target.earnedExperience,
            rank: target.rank,
            level: target.level,
            status: target.status,
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
            location: target.location,
            tutorialStep: target.tutorialStep,
            tutorialOn: target.tutorialOn,
            battleId: target.battleId,
            clanId: target.clanId,
            anbuId: target.anbuId,
          })
          .where(eq(userData.userId, ctx.userId)),
      ]);
      // Insert data
      await Promise.all([
        ...(targetJutsus.length > 0
          ? [
              ctx.drizzle.insert(userJutsu).values(
                targetJutsus.map((userjutsu) => ({
                  ...userjutsu,
                  userId: ctx.userId,
                  id: nanoid(),
                })),
              ),
            ]
          : []),
        ...(targetItems.length > 0
          ? [
              ctx.drizzle.insert(userItem).values(
                targetItems.map((useritem) => ({
                  ...useritem,
                  userId: ctx.userId,
                  id: nanoid(),
                })),
              ),
            ]
          : []),
        ...(targetQuestHistory.length > 0
          ? [
              ctx.drizzle.insert(questHistory).values(
                targetQuestHistory.map((questhistory) => ({
                  ...questhistory,
                  userId: ctx.userId,
                  id: nanoid(),
                })),
              ),
            ]
          : []),
        ...(targetRankedUserRewards.length > 0
          ? [
              ctx.drizzle.insert(rankedUserRewards).values(
                targetRankedUserRewards.map((rankedUserReward) => ({
                  ...rankedUserReward,
                  userId: ctx.userId,
                  id: nanoid(),
                })),
              ),
            ]
          : []),
        ...(targetAttributes.length > 0
          ? [
              ctx.drizzle.insert(userAttribute).values(
                targetAttributes.map((attribute) => ({
                  ...attribute,
                  userId: ctx.userId,
                  id: nanoid(),
                })),
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
    .input(z.object({ sector: z.int() }))
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
  // Sequential batches to prevent MySQL deadlock (errno 1213)
  // Operations within each batch run in parallel, but batches execute sequentially
  // This follows the pattern established in war.ts for avoiding deadlocks

  // Batch 1: Update foreign key references (must run first)
  await client
    .update(userData)
    .set({ senseiId: null })
    .where(eq(userData.senseiId, userId));

  // Batch 2: Communication & social relationships
  await Promise.all([
    client.delete(conversation).where(eq(conversation.createdById, userId)),
    client.delete(user2conversation).where(eq(user2conversation.userId, userId)),
    client.delete(conversationComment).where(eq(conversationComment.userId, userId)),
    client.delete(notification).where(eq(notification.userId, userId)),
    client.delete(userBlackList).where(eq(userBlackList.creatorUserId, userId)),
    client.delete(userBlackList).where(eq(userBlackList.targetUserId, userId)),
  ]);

  // Batch 3: Forum & content
  await Promise.all([
    client.delete(forumPost).where(eq(forumPost.userId, userId)),
    client.delete(forumThread).where(eq(forumThread.userId, userId)),
    client.delete(poll).where(eq(poll.createdByUserId, userId)),
    client.delete(userPollVote).where(eq(userPollVote.userId, userId)),
    client.delete(pollOption).where(eq(pollOption.targetUserId, userId)),
    client.delete(pollOption).where(eq(pollOption.createdByUserId, userId)),
  ]);

  // Batch 4: Game progress & items
  await Promise.all([
    client.delete(userItem).where(eq(userItem.userId, userId)),
    client.delete(userJutsu).where(eq(userJutsu.userId, userId)),
    client.delete(userSkill).where(eq(userSkill.userId, userId)),
    client.delete(userAttribute).where(eq(userAttribute.userId, userId)),
    client.delete(jutsuLoadout).where(eq(jutsuLoadout.userId, userId)),
    client.delete(questHistory).where(eq(questHistory.userId, userId)),
    client.delete(bloodlineRolls).where(eq(bloodlineRolls.userId, userId)),
  ]);

  // Batch 5: History & logs
  await Promise.all([
    client.delete(historicalAvatar).where(eq(historicalAvatar.userId, userId)),
    client.delete(historicalIp).where(eq(historicalIp.userId, userId)),
    client.delete(userActivityEvent).where(eq(userActivityEvent.userId, userId)),
    client.delete(actionLog).where(eq(actionLog.userId, userId)),
    client.delete(trainingLog).where(eq(trainingLog.userId, userId)),
  ]);

  // Batch 6: Reports & moderation
  await Promise.all([
    client.delete(reportLog).where(eq(reportLog.targetUserId, userId)),
    client.delete(reportLog).where(eq(reportLog.staffUserId, userId)),
    client.delete(userReport).where(eq(userReport.reporterUserId, userId)),
    client.delete(userReport).where(eq(userReport.reportedUserId, userId)),
    client.delete(userReportComment).where(eq(userReportComment.userId, userId)),
    client.delete(automatedModeration).where(eq(automatedModeration.userId, userId)),
  ]);

  // Batch 7: Staff & applications
  await Promise.all([
    client.delete(staffApplication).where(eq(staffApplication.applicantUserId, userId)),
    client.delete(supportReview).where(eq(supportReview.userId, userId)),
  ]);

  // Batch 8: Financial & rewards
  await Promise.all([
    client.delete(bankTransfers).where(eq(bankTransfers.senderId, userId)),
    client.delete(bankTransfers).where(eq(bankTransfers.receiverId, userId)),
    client.delete(userRewards).where(eq(userRewards.awardedById, userId)),
    client.delete(userRewards).where(eq(userRewards.receiverId, userId)),
    client.delete(userVote).where(eq(userVote.userId, userId)),
  ]);

  // Batch 9: Reviews & social
  await Promise.all([
    client.delete(userReview).where(eq(userReview.authorUserId, userId)),
    client.delete(userReview).where(eq(userReview.targetUserId, userId)),
    client.delete(userNindo).where(eq(userNindo.userId, userId)),
    client.delete(userLikes).where(eq(userLikes.userId, userId)),
    client.delete(userRequest).where(eq(userRequest.senderId, userId)),
    client.delete(userRequest).where(eq(userRequest.receiverId, userId)),
  ]);

  // Batch 10: Battle & war
  await Promise.all([
    client.delete(mpvpBattleUser).where(eq(mpvpBattleUser.userId, userId)),
    client.delete(kageDefendedChallenges).where(eq(kageDefendedChallenges.userId, userId)),
    client.delete(kageDefendedChallenges).where(eq(kageDefendedChallenges.kageId, userId)),
    client.delete(warKill).where(eq(warKill.killerId, userId)),
    client.delete(warKill).where(eq(warKill.victimId, userId)),
    client.delete(raidParticipation).where(eq(raidParticipation.userId, userId)),
    client.delete(userRaidBuff).where(eq(userRaidBuff.userId, userId)),
  ]);

  // Batch 11: Misc
  await Promise.all([
    client.delete(damageSimulation).where(eq(damageSimulation.userId, userId)),
    client.delete(conceptImage).where(eq(conceptImage.userId, userId)),
    client.delete(userBadge).where(eq(userBadge.userId, userId)),
    client.delete(linkPromotion).where(eq(linkPromotion.userId, userId)),
    client.delete(linkPromotion).where(eq(linkPromotion.reviewedBy, userId)),
    client.delete(userUpload).where(eq(userUpload.userId, userId)),
  ]);

  // Final batch: Delete main userData record (must be last)
  await client.delete(userData).where(eq(userData.userId, userId));
};
