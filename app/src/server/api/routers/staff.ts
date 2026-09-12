import { Client as PlanetScaleClient } from "@planetscale/database";
import * as Sentry from "@sentry/nextjs";
import type { inferRouterOutputs } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, inArray, isNull, ne, notExists, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { after } from "next/server";
import { z } from "zod";
import type { UserStatus } from "@/drizzle/constants";
import { IMG_AVATAR_DEFAULT, UserStatuses } from "@/drizzle/constants";
import {
  actionLog,
  aiProfile,
  anbuSquad,
  automatedModeration,
  badge,
  bankTransfers,
  bloodlineRolls,
  captcha,
  conceptImage,
  contentBackup,
  conversation,
  conversationComment,
  damageSimulation,
  farmCollectionLog,
  farmExtraction,
  farmPlot,
  forumPost,
  forumThread,
  historicalAvatar,
  historicalIp,
  itemLoadout,
  jutsuLoadout,
  kageDefendedChallenges,
  linkPromotion,
  mpvpBattleQueue,
  mpvpBattleUser,
  notification,
  overworldAiPlacement,
  overworldAiPlacementQuest,
  poll,
  pollOption,
  questHistory,
  raidParticipation,
  rankedPvpQueue,
  rankedUserRewards,
  reportLog,
  sector,
  staffApplication,
  storeUserIdAlias,
  supportReview,
  trainingLog,
  user2conversation,
  userActivityEvent,
  userAttribute,
  userBadge,
  userBlackList,
  userData,
  userDevice,
  userItem,
  userItemImbuement,
  userJutsu,
  userLikes,
  userLiveActivity,
  userNindo,
  userPollVote,
  userPushPreference,
  userQuestAttempt,
  userRaidBuff,
  userReport,
  userReportComment,
  userRequest,
  userReview,
  userRewards,
  userSkill,
  userUpload,
  userVote,
  warKill,
} from "@/drizzle/schema";
import { getServerPusher, updateUserOnMap } from "@/libs/pusher";
import { fetchUpdatedUser, fetchUser } from "@/routers/profile";
import { fetchVillages } from "@/routers/village";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import {
  isMysqlDeadlockError,
  isMysqlDuplicateKeyError,
} from "@/server/utils/mysqlErrors";
import {
  isDeletedStoreUserId,
  retireStoreUserId,
} from "@/server/utils/purchases/grant";
import { migrateUserIdReferences } from "@/server/utils/userIdMigration";
import {
  canClearSectors,
  canCloneUser,
  canControlBackups,
  canDeleteReferral,
  canModifyUserBadges,
  canOnlyEditSelf,
  canSeeActivityEvents,
  canSeeIps,
  canUnequipAllUsers,
  canUnstuckVillage,
  canUseMonitoringTests,
} from "@/utils/permissions";
import { idSchema } from "@/validators/misc";
import { fetchSector } from "./village";

const mutationAffectedRows = (result: unknown): number => {
  if (Array.isArray(result)) return mutationAffectedRows(result[0]);
  if (!result || typeof result !== "object") return 0;
  if ("rowsAffected" in result) return Number(result.rowsAffected);
  if ("affectedRows" in result) return Number(result.affectedRows);
  return 0;
};

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
    .input(idSchema)
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
      const aiUrl = process.env.AI_DATABASE_URL;

      // Guard
      if (!canControlBackups(user.role)) {
        return errorResponse("Not allowed for you");
      }
      if (!backup) return errorResponse("Backup not found");
      if (!devUrl && !aiUrl) return errorResponse("No target database URLs configured");
      if (!backup.sqlText || backup.sqlText.startsWith("/* Empty backup")) {
        return errorResponse("Backup is empty");
      }

      // Setup clients
      const clients = [
        ...(devUrl
          ? [{ name: "dev", client: new PlanetScaleClient({ url: devUrl }) }]
          : []),
        ...(aiUrl
          ? [{ name: "ai", client: new PlanetScaleClient({ url: aiUrl }) }]
          : []),
      ];

      // Derived
      const tableMap: Record<typeof backup.type, string> = {
        bloodline: "Bloodline",
        jutsu: "Jutsu",
        item: "Item",
        ai: "UserData",
      };
      const tableName = tableMap[backup.type];

      // Clear table content and push backup in parallel across all target databases
      const deleteQuery =
        backup.type === "ai"
          ? `DELETE FROM \`${tableName}\` WHERE isAi = 1`
          : `DELETE FROM \`${tableName}\``;

      await Promise.all(clients.map(({ client }) => client.execute(deleteQuery)));

      if (backup.sqlText && !backup.sqlText.startsWith("/* Empty backup")) {
        await Promise.all(clients.map(({ client }) => client.execute(backup.sqlText)));
      }

      const targets = clients.map(({ name }) => name).join(" + ");
      return { success: true, message: `Backup pushed to ${targets}` };
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
      // Non-AI only — AI opponents keep their equipped loadouts for combat.
      // Non-AI only — AI opponents keep equipped jutsu for combat.
      // Prefer NOT IN (isAi = true): AI accounts are few, so the subquery stays small;
      // IN (isAi = false) would materialize essentially every human userId.
      // Orphan userJutsu/loadout rows (userId missing from UserData) are included —
      // harmless for unequip-all.
      await Promise.all([
        ctx.drizzle
          .update(userJutsu)
          .set({ equipped: false })
          .where(
            and(
              ne(userJutsu.equipped, false),
              sql`${userJutsu.userId} NOT IN (
                SELECT ${userData.userId} FROM ${userData} WHERE ${userData.isAi} = true
              )`,
            ),
          ),
        ctx.drizzle
          .update(jutsuLoadout)
          .set({ jutsuIds: [] })
          .where(
            sql`${jutsuLoadout.userId} NOT IN (
              SELECT ${userData.userId} FROM ${userData} WHERE ${userData.isAi} = true
            )`,
          ),
      ]);
      return {
        success: true,
        message: `All jutsu has been unequipped for all non-AI users.`,
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
      // Non-AI only — AI opponents keep their equipped gear for combat.
      // Clear every item loadout (not only the active pointer), matching unequipAllJutsus.
      // Same NOT IN (isAi = true) pattern as unequipAllJutsus (small AI set vs all humans).
      await Promise.all([
        ctx.drizzle
          .update(userItem)
          .set({ equipped: "NONE" })
          .where(
            and(
              ne(userItem.equipped, "NONE"),
              // Skip rows held by a stack-merge claim (negative quantity) so this bulk write
              // cannot change a claimed row's equipped slot mid-merge-publish.
              gt(userItem.quantity, 0),
              sql`${userItem.userId} NOT IN (
                SELECT ${userData.userId} FROM ${userData} WHERE ${userData.isAi} = true
              )`,
            ),
          ),
        ctx.drizzle
          .update(itemLoadout)
          .set({ itemData: [] })
          .where(
            sql`${itemLoadout.userId} NOT IN (
              SELECT ${userData.userId} FROM ${userData} WHERE ${userData.isAi} = true
            )`,
          ),
      ]);
      return {
        success: true,
        message: `All gear has been unequipped for all non-AI users.`,
      };
    }),
  forceAwake: protectedProcedure
    .output(
      baseServerResponse.extend({
        userId: z.string().optional(),
        requestId: z.string().uuid().optional(),
      }),
    )
    .input(
      z.object({
        userId: z.string(),
        expectedUsername: z.string().min(1).max(191),
        expectedStatus: z.enum(UserStatuses),
        expectedBattleId: z.string().nullable(),
        requestId: z.string().uuid(),
        reason: z.string().trim().min(10, "Reason must be at least 10 characters"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const actionId = `force-awake:${input.requestId}`;
      const result = await ctx.drizzle.transaction(async (tx) => {
        // All force-awake calls and status transitions that update either user serialize here.
        await tx.execute(
          sql`SELECT ${userData.userId} FROM ${userData} WHERE ${userData.userId} IN (${ctx.userId}, ${input.userId}) ORDER BY ${userData.userId} FOR UPDATE`,
        );

        const user = await tx.query.userData.findFirst({
          where: eq(userData.userId, ctx.userId),
        });
        const targetUser = await tx.query.userData.findFirst({
          where: eq(userData.userId, input.userId),
        });
        if (!user || !targetUser) return { response: errorResponse("User not found") };
        if (user.isBanned) {
          return {
            response: errorResponse("You are banned and cannot perform this action"),
          };
        }
        if (!canUnstuckVillage(user.role)) {
          return { response: errorResponse("Not allowed for you") };
        }

        // A retry after a lost success response reuses the same request id and must not
        // perform or audit the intervention twice.
        const previousRequest = await tx.query.actionLog.findFirst({
          where: eq(actionLog.id, actionId),
          columns: { userId: true, relatedId: true },
        });
        if (previousRequest) {
          if (
            previousRequest.userId !== ctx.userId ||
            previousRequest.relatedId !== input.userId
          ) {
            return { response: errorResponse("Invalid force-awake request ID") };
          }
          return {
            response: {
              success: true,
              message: `${targetUser.username} is awake`,
              userId: targetUser.userId,
              requestId: input.requestId,
            },
            targetUser,
          };
        }

        if (targetUser.username !== input.expectedUsername) {
          return {
            response: errorResponse("The target user changed. Refresh and try again"),
          };
        }
        if (
          targetUser.status !== input.expectedStatus ||
          targetUser.battleId !== input.expectedBattleId
        ) {
          return {
            response: errorResponse(
              "The user's status or battle changed. Review their profile and try again",
            ),
          };
        }

        const queueEntries = await tx.query.mpvpBattleUser.findMany({
          where: eq(mpvpBattleUser.userId, input.userId),
        });
        const queueIds = [...new Set(queueEntries.map((entry) => entry.clanBattleId))];

        await tx
          .update(userData)
          .set({ status: "AWAKE", travelFinishAt: null, battleId: null })
          .where(eq(userData.userId, input.userId));
        const mpvpResult = await tx
          .delete(mpvpBattleUser)
          .where(eq(mpvpBattleUser.userId, input.userId));
        const rankedResult = await tx
          .delete(rankedPvpQueue)
          .where(eq(rankedPvpQueue.userId, input.userId));
        const kageResult = await tx
          .update(userRequest)
          .set({ status: "CANCELLED" })
          .where(
            and(
              eq(userRequest.senderId, input.userId),
              eq(userRequest.type, "KAGE"),
              eq(userRequest.status, "PENDING"),
            ),
          );

        // Delete only genuinely empty, unclaimed lobbies. Never reset a live claiming token:
        // its owner will re-read membership and either continue without this user or roll back.
        for (const queueId of queueIds) {
          await tx
            .delete(mpvpBattleQueue)
            .where(
              and(
                eq(mpvpBattleQueue.id, queueId),
                isNull(mpvpBattleQueue.battleId),
                notExists(
                  tx
                    .select({ id: mpvpBattleUser.id })
                    .from(mpvpBattleUser)
                    .where(eq(mpvpBattleUser.clanBattleId, queueId)),
                ),
              ),
            );
        }

        await tx.insert(actionLog).values({
          id: actionId,
          userId: ctx.userId,
          tableName: "user",
          relatedId: input.userId,
          relatedMsg: `Forced ${targetUser.username} awake from ${targetUser.status}`,
          changes: [
            `Previous BattleId: ${targetUser.battleId ?? "none"}`,
            `Reason: ${input.reason}`,
            `Cleared MPvP memberships: ${mpvpResult.rowsAffected}`,
            `Cleared ranked queue rows: ${rankedResult.rowsAffected}`,
            `Cancelled pending Kage challenges: ${kageResult.rowsAffected}`,
          ],
        });

        return {
          response: {
            success: true,
            message: `${targetUser.username} is awake`,
            userId: targetUser.userId,
            requestId: input.requestId,
          },
          targetUser,
        };
      });

      if (result.response.success && result.targetUser) {
        const targetUser = result.targetUser;
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
          battleId: null as string | null,
          username: targetUser.username,
          status: "AWAKE" as UserStatus,
          location: "",
          userId: input.userId,
        };
        // The database commit is authoritative. A realtime delivery failure must not turn a
        // completed intervention into a retryable response that can be submitted again.
        void updateUserOnMap(getServerPusher(), targetUser.sector, output).catch(
          (error: unknown) => Sentry.captureException(error),
        );
      }

      return result.response;
    }),
  insertUserBadge: protectedProcedure
    .input(
      z.object({
        userId: z.string().min(1).max(191),
        expectedUsername: z.string().min(1).max(191),
        badgeId: z.string().min(1).max(191),
        expectedBadgeName: z.string().min(1).max(191),
        requestId: z.string().uuid(),
      }),
    )
    .output(
      baseServerResponse.extend({
        userId: z.string().optional(),
        badgeId: z.string().optional(),
        requestId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const actionId = `insert-user-badge:${input.requestId}`;
      const relatedMsg = `Insert badge: ${input.expectedBadgeName}`;
      const receiptChanges = [
        relatedMsg,
        `Badge ID: ${input.badgeId}`,
        `Target username: ${input.expectedUsername}`,
      ];
      const isMatchingReceipt = (
        receipt:
          | {
              userId: string | null;
              tableName: string | null;
              relatedId: string | null;
              relatedMsg: string | null;
              changes: unknown;
            }
          | undefined,
      ) =>
        receipt?.userId === ctx.userId &&
        receipt.tableName === "user" &&
        receipt.relatedId === input.userId &&
        receipt.relatedMsg === relatedMsg &&
        Array.isArray(receipt.changes) &&
        receipt.changes.length === receiptChanges.length &&
        receipt.changes.every((change, index) => change === receiptChanges[index]);

      try {
        return await ctx.drizzle.transaction(async (tx) => {
          // Serialise assignment against target/profile changes and against another request for
          // this badge. The schema's compound UNIQUE remains the final guard for other writers.
          await tx.execute(
            sql`SELECT ${userData.userId} FROM ${userData} WHERE ${userData.userId} IN (${ctx.userId}, ${input.userId}) ORDER BY ${userData.userId} FOR UPDATE`,
          );
          await tx.execute(
            sql`SELECT ${badge.id} FROM ${badge} WHERE ${badge.id} = ${input.badgeId} FOR UPDATE`,
          );

          const actor = await tx.query.userData.findFirst({
            where: eq(userData.userId, ctx.userId),
          });
          if (!actor) return errorResponse("User not found");
          if (actor.isBanned) {
            return errorResponse("You are banned and cannot perform this action");
          }
          if (!canModifyUserBadges(actor.role)) {
            return errorResponse("Not allowed for you");
          }
          if (canOnlyEditSelf(actor.role) && actor.userId !== input.userId) {
            return errorResponse("Your role can only assign badges to your own user");
          }

          // A retry after a lost response reuses this receipt and performs no second insert or
          // audit. Reusing its request id for a different assignment is rejected explicitly.
          const previousRequest = await tx.query.actionLog.findFirst({
            where: eq(actionLog.id, actionId),
            columns: {
              userId: true,
              tableName: true,
              relatedId: true,
              relatedMsg: true,
              changes: true,
            },
          });
          if (previousRequest) {
            if (!isMatchingReceipt(previousRequest)) {
              return errorResponse("Invalid badge assignment request ID");
            }
            return {
              success: true,
              message: "Badge added",
              userId: input.userId,
              badgeId: input.badgeId,
              requestId: input.requestId,
            };
          }

          // PlanetScale transaction handles are single-flight: overlapping statements on this
          // handle can fail with "transaction in use", even though these reads are logically
          // independent. Keep all transaction statements sequential.
          const targetUser = await tx.query.userData.findFirst({
            where: eq(userData.userId, input.userId),
          });
          const selectedBadge = await tx.query.badge.findFirst({
            where: eq(badge.id, input.badgeId),
          });
          if (!targetUser) return errorResponse("Target user not found");
          if (!selectedBadge) return errorResponse("Badge not found");
          if (targetUser.username !== input.expectedUsername) {
            return errorResponse("The target user changed. Refresh and try again");
          }
          if (selectedBadge.name !== input.expectedBadgeName) {
            return errorResponse("The selected badge changed. Refresh and try again");
          }

          const existingBadge = await tx.query.userBadge.findFirst({
            where: and(
              eq(userBadge.userId, input.userId),
              eq(userBadge.badgeId, input.badgeId),
            ),
          });
          if (existingBadge) {
            return errorResponse(
              `${selectedBadge.name} is already assigned to this user`,
            );
          }

          await tx.insert(userBadge).values({
            userId: input.userId,
            badgeId: input.badgeId,
          });
          await tx.insert(actionLog).values({
            id: actionId,
            userId: ctx.userId,
            tableName: "user",
            changes: receiptChanges,
            relatedId: input.userId,
            relatedMsg,
            relatedImage: targetUser.avatarLight,
          });

          return {
            success: true,
            message: "Badge added",
            userId: input.userId,
            badgeId: input.badgeId,
            requestId: input.requestId,
          };
        });
      } catch (error) {
        if (!isMysqlDuplicateKeyError(error)) throw error;

        // A UNIQUE race can only be a same-request replay or an independently completed badge
        // assignment. Keep those semantics distinct so a pre-existing badge is never presented
        // as this request's success.
        const previousRequest = await ctx.drizzle.query.actionLog.findFirst({
          where: eq(actionLog.id, actionId),
          columns: {
            userId: true,
            tableName: true,
            relatedId: true,
            relatedMsg: true,
            changes: true,
          },
        });
        if (isMatchingReceipt(previousRequest)) {
          return {
            success: true,
            message: "Badge added",
            userId: input.userId,
            badgeId: input.badgeId,
            requestId: input.requestId,
          };
        }
        const existingBadge = await ctx.drizzle.query.userBadge.findFirst({
          where: and(
            eq(userBadge.userId, input.userId),
            eq(userBadge.badgeId, input.badgeId),
          ),
        });
        if (existingBadge) {
          return errorResponse(
            `${input.expectedBadgeName} is already assigned to this user`,
          );
        }
        throw error;
      }
    }),
  removeUserBadge: protectedProcedure
    .input(
      z.object({
        userId: z.string().min(1).max(191),
        expectedUsername: z.string().min(1).max(191),
        badgeId: z.string().min(1).max(191),
        expectedBadgeName: z.string().min(1).max(191),
        expectedAssignmentCreatedAt: z.coerce.date(),
        requestId: z.string().uuid(),
      }),
    )
    .output(
      baseServerResponse.extend({
        userId: z.string().optional(),
        badgeId: z.string().optional(),
        requestId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const actionId = `remove-user-badge:${input.requestId}`;
      const relatedMsg = `Remove badge: ${input.expectedBadgeName}`;
      const receiptChanges = [
        relatedMsg,
        `Badge ID: ${input.badgeId}`,
        `Target username: ${input.expectedUsername}`,
        `Assignment created: ${input.expectedAssignmentCreatedAt.toISOString()}`,
      ];
      const isMatchingReceipt = (
        receipt:
          | {
              userId: string | null;
              tableName: string | null;
              relatedId: string | null;
              relatedMsg: string | null;
              changes: unknown;
            }
          | undefined,
      ) =>
        receipt?.userId === ctx.userId &&
        receipt.tableName === "user" &&
        receipt.relatedId === input.userId &&
        receipt.relatedMsg === relatedMsg &&
        Array.isArray(receipt.changes) &&
        receipt.changes.length === receiptChanges.length &&
        receipt.changes.every((change, index) => change === receiptChanges[index]);
      const successResponse = () => ({
        success: true as const,
        message: "Badge removed",
        userId: input.userId,
        badgeId: input.badgeId,
        requestId: input.requestId,
      });

      try {
        return await ctx.drizzle.transaction(async (tx) => {
          // Serialize all badge changes for the target and protect the actor's current role.
          // PlanetScale transaction handles are single-flight, so statements stay sequential.
          await tx.execute(
            sql`SELECT ${userData.userId} FROM ${userData} WHERE ${userData.userId} IN (${ctx.userId}, ${input.userId}) ORDER BY ${userData.userId} FOR UPDATE`,
          );
          await tx.execute(
            sql`SELECT ${badge.id} FROM ${badge} WHERE ${badge.id} = ${input.badgeId} FOR UPDATE`,
          );
          await tx.execute(
            sql`SELECT ${userBadge.userId} FROM ${userBadge} WHERE ${userBadge.userId} = ${input.userId} AND ${userBadge.badgeId} = ${input.badgeId} FOR UPDATE`,
          );

          const actor = await tx.query.userData.findFirst({
            where: eq(userData.userId, ctx.userId),
          });
          if (!actor) return errorResponse("User not found");
          if (actor.isBanned) {
            return errorResponse("You are banned and cannot perform this action");
          }
          if (!canModifyUserBadges(actor.role)) {
            return errorResponse("Not allowed for you");
          }
          if (canOnlyEditSelf(actor.role) && actor.userId !== input.userId) {
            return errorResponse("Your role can only remove badges from your own user");
          }

          // This receipt is the only condition under which an already-absent assignment is a
          // success: it proves this exact request committed before its response was lost.
          const previousRequest = await tx.query.actionLog.findFirst({
            where: eq(actionLog.id, actionId),
            columns: {
              userId: true,
              tableName: true,
              relatedId: true,
              relatedMsg: true,
              changes: true,
            },
          });
          if (previousRequest) {
            if (!isMatchingReceipt(previousRequest)) {
              return errorResponse("Invalid badge removal request ID");
            }
            return successResponse();
          }

          const targetUser = await tx.query.userData.findFirst({
            where: eq(userData.userId, input.userId),
          });
          const selectedBadge = await tx.query.badge.findFirst({
            where: eq(badge.id, input.badgeId),
          });
          const existingAssignment = await tx.query.userBadge.findFirst({
            where: and(
              eq(userBadge.userId, input.userId),
              eq(userBadge.badgeId, input.badgeId),
            ),
          });
          if (!targetUser) return errorResponse("Target user not found");
          if (!selectedBadge) return errorResponse("Badge not found");
          if (targetUser.username !== input.expectedUsername) {
            return errorResponse("The target user changed. Refresh and try again");
          }
          if (selectedBadge.name !== input.expectedBadgeName) {
            return errorResponse("The selected badge changed. Refresh and try again");
          }
          if (!existingAssignment) {
            return errorResponse(
              `${selectedBadge.name} is no longer assigned to this user`,
            );
          }
          if (
            existingAssignment.createdAt.getTime() !==
            input.expectedAssignmentCreatedAt.getTime()
          ) {
            return errorResponse(
              "This badge assignment changed. Refresh and review the current badge",
            );
          }

          const deletion = await tx
            .delete(userBadge)
            .where(
              and(
                eq(userBadge.userId, input.userId),
                eq(userBadge.badgeId, input.badgeId),
                eq(userBadge.createdAt, input.expectedAssignmentCreatedAt),
              ),
            );
          // Production's PlanetScale driver reports `rowsAffected`; the mysql2-backed test
          // transaction exposes its native ResultSetHeader tuple.
          const deletedCount = Array.isArray(deletion)
            ? (deletion[0] as { affectedRows?: number }).affectedRows
            : deletion.rowsAffected;
          if (deletedCount !== 1) {
            return errorResponse(
              "This badge assignment changed. Refresh and review the current badge",
            );
          }

          await tx.insert(actionLog).values({
            id: actionId,
            userId: ctx.userId,
            tableName: "user",
            changes: receiptChanges,
            relatedId: input.userId,
            relatedMsg,
            relatedImage: targetUser.avatarLight,
          });

          return successResponse();
        });
      } catch (error) {
        if (!isMysqlDuplicateKeyError(error)) throw error;

        // A concurrent same-request replay can race on the receipt's primary key. Confirm the
        // exact receipt after rollback; a different request payload must remain an error.
        const previousRequest = await ctx.drizzle.query.actionLog.findFirst({
          where: eq(actionLog.id, actionId),
          columns: {
            userId: true,
            tableName: true,
            relatedId: true,
            relatedMsg: true,
            changes: true,
          },
        });
        return isMatchingReceipt(previousRequest)
          ? successResponse()
          : errorResponse("Invalid badge removal request ID");
      }
    }),
  // Copy a user's gameplay state into the calling staff member's separate debug account.
  cloneUserForDebug: protectedProcedure
    .input(z.object({ userId: z.string(), expectedUsername: z.string() }))
    .output(
      baseServerResponse.extend({
        userId: z.string().optional(),
        sourceUserId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.drizzle.transaction(async (tx) => {
        // Serialize every replacement of this debug account. This also makes intentional
        // concurrent clones resolve as complete snapshots instead of interleaving delete/insert
        // phases and leaving a mixture of two source users.
        await tx.execute(
          sql`SELECT ${userData.userId} FROM ${userData} WHERE ${userData.userId} IN (${ctx.userId}, ${input.userId}) ORDER BY ${userData.userId} FOR UPDATE`,
        );

        // A transaction owns one connection, so keep its statements sequential. Parallel queries
        // on that connection can race the driver's response parser and fail nondeterministically.
        const user = await tx.query.userData.findFirst({
          where: eq(userData.userId, ctx.userId),
        });
        const target = await tx.query.userData.findFirst({
          where: eq(userData.userId, input.userId),
        });
        if (!user || !target) return errorResponse("User not found");
        if (user.isBanned) return errorResponse("Banned users cannot clone users");
        if (!canCloneUser(user.role)) {
          return errorResponse("You are not allowed to clone users");
        }
        if (canCloneUser(target.role)) {
          return errorResponse("Cannot copy people able to clone");
        }
        if (target.username !== input.expectedUsername) {
          return errorResponse(
            "The selected user's name changed. Refresh and try again",
          );
        }

        const targetJutsus = await tx.query.userJutsu.findMany({
          where: eq(userJutsu.userId, input.userId),
        });
        const targetItems = await tx.query.userItem.findMany({
          where: eq(userItem.userId, input.userId),
        });
        const targetQuestHistory = await tx.query.questHistory.findMany({
          where: eq(questHistory.userId, input.userId),
        });
        const targetRankedUserRewards = await tx.query.rankedUserRewards.findMany({
          where: eq(rankedUserRewards.userId, input.userId),
        });
        const targetAttributes = await tx.query.userAttribute.findMany({
          where: eq(userAttribute.userId, input.userId),
        });
        const existingItems = await tx.query.userItem.findMany({
          columns: { id: true },
          where: eq(userItem.userId, ctx.userId),
        });
        const targetItemIds = targetItems.map((item) => item.id);
        const targetItemImbuements =
          targetItemIds.length > 0
            ? await tx.query.userItemImbuement.findMany({
                where: inArray(userItemImbuement.userItemId, targetItemIds),
              })
            : [];

        // Generate the parent ids once so item imbuements remain owned by the cloned inventory,
        // rather than continuing to point at the source user's item rows.
        const clonedItemIdBySourceId = new Map<string, string>();
        const clonedItems = targetItems.map((item) => {
          const clonedId = nanoid();
          clonedItemIdBySourceId.set(item.id, clonedId);
          return { ...item, id: clonedId, userId: ctx.userId };
        });
        const clonedItemImbuements = targetItemImbuements.map((entry) => {
          const clonedParentId = clonedItemIdBySourceId.get(entry.userItemId);
          if (!clonedParentId) {
            throw new Error("Could not map cloned item imbuement to its parent");
          }
          return {
            ...entry,
            id: nanoid(),
            userItemId: clonedParentId,
          };
        });

        const existingItemIds = existingItems.map((item) => item.id);
        if (existingItemIds.length > 0) {
          await tx
            .delete(userItemImbuement)
            .where(inArray(userItemImbuement.userItemId, existingItemIds));
        }
        await tx.delete(userJutsu).where(eq(userJutsu.userId, ctx.userId));
        await tx.delete(userItem).where(eq(userItem.userId, ctx.userId));
        await tx.delete(questHistory).where(eq(questHistory.userId, ctx.userId));
        await tx.delete(userAttribute).where(eq(userAttribute.userId, ctx.userId));
        await tx
          .delete(rankedUserRewards)
          .where(eq(rankedUserRewards.userId, ctx.userId));

        if (user.anbuId !== target.anbuId && user.anbuId) {
          await tx
            .update(anbuSquad)
            .set({ memberCount: sql`GREATEST(${anbuSquad.memberCount} - 1, 0)` })
            .where(eq(anbuSquad.id, user.anbuId));
        }
        if (user.anbuId !== target.anbuId && target.anbuId) {
          await tx
            .update(anbuSquad)
            .set({ memberCount: sql`${anbuSquad.memberCount} + 1` })
            .where(eq(anbuSquad.id, target.anbuId));
        }

        await tx
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
            updatedAt: new Date(),
          })
          .where(eq(userData.userId, ctx.userId));

        if (targetJutsus.length > 0) {
          await tx.insert(userJutsu).values(
            targetJutsus.map((entry) => ({
              ...entry,
              userId: ctx.userId,
              id: nanoid(),
            })),
          );
        }
        if (clonedItems.length > 0) await tx.insert(userItem).values(clonedItems);
        if (clonedItemImbuements.length > 0) {
          await tx.insert(userItemImbuement).values(clonedItemImbuements);
        }
        if (targetQuestHistory.length > 0) {
          await tx.insert(questHistory).values(
            targetQuestHistory.map((entry) => ({
              ...entry,
              userId: ctx.userId,
              id: nanoid(),
            })),
          );
        }
        if (targetRankedUserRewards.length > 0) {
          await tx.insert(rankedUserRewards).values(
            targetRankedUserRewards.map((entry) => ({
              ...entry,
              userId: ctx.userId,
              id: nanoid(),
            })),
          );
        }
        if (targetAttributes.length > 0) {
          await tx.insert(userAttribute).values(
            targetAttributes.map((entry) => ({
              ...entry,
              userId: ctx.userId,
              id: nanoid(),
            })),
          );
        }
        await tx.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "user",
          changes: [
            `Copied debug gameplay state from ${target.username} (${target.userId})`,
          ],
          relatedId: target.userId,
          relatedMsg: "Clone user for debugging",
          relatedImage: target.avatarLight,
        });

        return {
          success: true,
          message: `Copied ${target.username} into your debug account`,
          userId: ctx.userId,
          sourceUserId: target.userId,
        };
      });
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
  // Move one application identity to a new Clerk user id. This is intentionally owner-only:
  // the destination Clerk account cannot be verified from the application database.
  updateUserId: protectedProcedure
    .input(
      z.object({
        userId: z.string().min(1).max(191),
        expectedUsername: z.string().min(1).max(191),
        newUserId: z
          .string()
          .trim()
          .min(1, "A new user ID is required")
          .max(191)
          .regex(
            /^[A-Za-z0-9_-]+$/,
            "User IDs may only contain letters, numbers, underscores, and hyphens",
          ),
      }),
    )
    .output(
      baseServerResponse.extend({
        oldUserId: z.string().optional(),
        newUserId: z.string().optional(),
        username: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.userId === input.newUserId) {
        return errorResponse("The new user ID must be different");
      }
      if (isDeletedStoreUserId(input.userId) || isDeletedStoreUserId(input.newUserId)) {
        return errorResponse("User ID is reserved");
      }

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          return await ctx.drizzle.transaction(async (tx) => {
            // Serialize both identities. Competing owner requests can never move one source to
            // different destinations, and a destination cannot appear before commit.
            await tx.execute(
              sql`SELECT ${userData.userId} FROM ${userData} WHERE ${userData.userId} IN (${input.userId}, ${input.newUserId}) ORDER BY ${userData.userId} FOR UPDATE`,
            );
            await tx.execute(
              sql`SELECT ${storeUserIdAlias.oldUserId} FROM ${storeUserIdAlias} WHERE ${storeUserIdAlias.oldUserId} IN (${input.userId}, ${input.newUserId}) ORDER BY ${storeUserIdAlias.oldUserId} FOR UPDATE`,
            );

            const user = await tx.query.userData.findFirst({
              where: eq(userData.userId, ctx.userId),
            });
            if (user?.username !== "Terriator") {
              return errorResponse("Only Terriator can update a user ID");
            }
            if (user.isBanned) {
              return errorResponse("Banned users cannot update a user ID");
            }

            const fromUser = await tx.query.userData.findFirst({
              where: eq(userData.userId, input.userId),
            });
            const toUser = await tx.query.userData.findFirst({
              where: eq(userData.userId, input.newUserId),
            });
            const sourceAlias = await tx.query.storeUserIdAlias.findFirst({
              columns: { newUserId: true },
              where: eq(storeUserIdAlias.oldUserId, input.userId),
            });
            const destinationAlias = await tx.query.storeUserIdAlias.findFirst({
              columns: { newUserId: true },
              where: eq(storeUserIdAlias.oldUserId, input.newUserId),
            });

            // A lost HTTP response can be retried after commit. Return the exact committed
            // identity instead of attempting another migration.
            if (
              !fromUser &&
              toUser?.username === input.expectedUsername &&
              sourceAlias?.newUserId === input.newUserId
            ) {
              return {
                success: true,
                message: "User ID was already updated",
                oldUserId: input.userId,
                newUserId: input.newUserId,
                username: toUser.username,
              };
            }

            if (!fromUser) return errorResponse("User not found");
            if (fromUser.username !== input.expectedUsername) {
              return errorResponse("The selected user changed. Refresh and try again");
            }
            if (fromUser.role !== "USER") {
              return errorResponse("Staff accounts cannot be moved to another user ID");
            }
            if (fromUser.isAi || fromUser.isSummon || fromUser.isEvent) {
              return errorResponse("AI and event identities cannot be moved");
            }
            if (fromUser.status === "BATTLE" || fromUser.battleId) {
              return errorResponse(
                "The user must leave their current battle before changing ID",
              );
            }
            if (toUser) return errorResponse("The new user ID is already in use");
            if (destinationAlias) {
              return errorResponse("UserId was previously used and is reserved");
            }
            if (sourceAlias && isDeletedStoreUserId(sourceAlias.newUserId)) {
              return errorResponse("UserId is being deleted and cannot be renamed");
            }
            if (sourceAlias && sourceAlias.newUserId !== input.newUserId) {
              return errorResponse(
                "This user ID was already moved to another identity",
              );
            }

            // Alias, references, account row and audit share one transaction. Any constraint or
            // audit failure rolls the complete identity move back.
            await tx
              .insert(storeUserIdAlias)
              .values({
                oldUserId: input.userId,
                newUserId: input.newUserId,
                updatedAt: new Date(),
              })
              .onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });

            const claim = await tx.query.storeUserIdAlias.findFirst({
              columns: { newUserId: true },
              where: eq(storeUserIdAlias.oldUserId, input.userId),
            });
            if (claim?.newUserId !== input.newUserId) {
              return errorResponse("This user ID was claimed by another identity move");
            }

            await migrateUserIdReferences(tx, input.userId, input.newUserId);
            await tx
              .update(userData)
              .set({ userId: input.newUserId, updatedAt: new Date() })
              .where(
                and(
                  eq(userData.userId, input.userId),
                  eq(userData.username, input.expectedUsername),
                ),
              );
            const movedUser = await tx.query.userData.findFirst({
              columns: { username: true },
              where: eq(userData.userId, input.newUserId),
            });
            const oldUser = await tx.query.userData.findFirst({
              columns: { userId: true },
              where: eq(userData.userId, input.userId),
            });
            if (movedUser?.username !== input.expectedUsername || oldUser) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "The selected user changed while the ID was being updated",
              });
            }

            await tx.insert(actionLog).values({
              id: nanoid(),
              userId: ctx.userId,
              tableName: "user",
              changes: [`Moved user ID from ${input.userId} to ${input.newUserId}`],
              relatedId: input.newUserId,
              relatedMsg: `Updated user ID for ${fromUser.username}`,
              relatedImage: fromUser.avatarLight,
            });

            return {
              success: true,
              message: "UserId updated",
              oldUserId: input.userId,
              newUserId: input.newUserId,
              username: fromUser.username,
            };
          });
        } catch (error) {
          if (!isMysqlDeadlockError(error) || attempt === 3) throw error;
          await delay(25 * attempt);
        }
      }
      throw new Error("User ID update retry loop exhausted");
    }),
  // Delete referral from user
  deleteReferral: protectedProcedure
    .input(
      z.object({
        userId: z.string().min(1).max(191),
        expectedUsername: z.string().min(1).max(191),
        expectedRecruiterId: z.string().min(1).max(191),
        expectedRecruiterUsername: z.string().min(1).max(191),
        expectedRecruiterCount: z.number().int().nonnegative(),
        requestId: z.string().uuid(),
      }),
    )
    .output(
      baseServerResponse.extend({
        userId: z.string().optional(),
        recruiterId: z.string().optional(),
        recruiterCount: z.number().int().nonnegative().optional(),
        requestId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const actionId = `delete-referral:${input.requestId}`;
      const relatedMsg = "Referral has been removed";
      const receiptChanges = [
        `Removed referral: ${input.expectedUsername}`,
        `Recruiter: ${input.expectedRecruiterUsername} (${input.expectedRecruiterId})`,
        `Displayed recruiter count: ${input.expectedRecruiterCount}`,
      ];
      const isMatchingReceipt = (
        receipt:
          | {
              userId: string | null;
              tableName: string | null;
              relatedId: string | null;
              relatedMsg: string | null;
              changes: unknown;
            }
          | undefined,
      ) =>
        receipt?.userId === ctx.userId &&
        receipt.tableName === "user" &&
        receipt.relatedId === input.userId &&
        receipt.relatedMsg === relatedMsg &&
        Array.isArray(receipt.changes) &&
        receipt.changes.length === receiptChanges.length &&
        receipt.changes.every((change, index) => change === receiptChanges[index]);

      const result = await ctx.drizzle.transaction(async (tx) => {
        // Protect the actor's current permissions, the exact relationship, and the counter.
        // All transaction statements remain sequential for PlanetScale transaction handles.
        await tx.execute(
          sql`SELECT ${userData.userId} FROM ${userData} WHERE ${userData.userId} IN (${ctx.userId}, ${input.userId}, ${input.expectedRecruiterId}) ORDER BY ${userData.userId} FOR UPDATE`,
        );

        const actor = await tx.query.userData.findFirst({
          where: eq(userData.userId, ctx.userId),
        });
        if (!actor) return errorResponse("User not found");
        if (actor.isBanned) {
          return errorResponse("You are banned and cannot perform this action");
        }
        if (!canDeleteReferral(actor.role)) {
          return errorResponse("You don't have permission to delete referrals");
        }
        if (canOnlyEditSelf(actor.role) && actor.userId !== input.userId) {
          return errorResponse("Your role can only remove its own referral");
        }

        // Only this exact receipt turns an already-unlinked target into success. This makes a
        // retry after a lost response idempotent without treating another admin's removal as ours.
        const previousRequest = await tx.query.actionLog.findFirst({
          where: eq(actionLog.id, actionId),
          columns: {
            userId: true,
            tableName: true,
            relatedId: true,
            relatedMsg: true,
            changes: true,
          },
        });
        if (previousRequest) {
          if (!isMatchingReceipt(previousRequest)) {
            return errorResponse("Invalid referral removal request ID");
          }
          const recruiter = await tx.query.userData.findFirst({
            where: eq(userData.userId, input.expectedRecruiterId),
            columns: { nRecruited: true },
          });
          return {
            success: true,
            message: `Referral removed from ${input.expectedUsername}`,
            userId: input.userId,
            recruiterId: input.expectedRecruiterId,
            recruiterCount: recruiter?.nRecruited ?? 0,
            requestId: input.requestId,
          };
        }

        const target = await tx.query.userData.findFirst({
          where: eq(userData.userId, input.userId),
        });
        if (!target) return errorResponse("Target user not found");
        const recruiter = await tx.query.userData.findFirst({
          where: eq(userData.userId, input.expectedRecruiterId),
        });
        if (!recruiter) return errorResponse("Recruiter not found");
        if (target.username !== input.expectedUsername) {
          return errorResponse("The recruited user changed. Refresh and try again");
        }
        if (recruiter.username !== input.expectedRecruiterUsername) {
          return errorResponse("The recruiter changed. Refresh and try again");
        }
        if (target.recruiterId !== input.expectedRecruiterId) {
          return errorResponse(
            "The referral relationship changed. Refresh and review it before retrying",
          );
        }

        const unlink = await tx
          .update(userData)
          .set({ recruiterId: null })
          .where(
            and(
              eq(userData.userId, input.userId),
              eq(userData.recruiterId, input.expectedRecruiterId),
            ),
          );
        if (mutationAffectedRows(unlink) !== 1) {
          return errorResponse(
            "The referral relationship changed. Refresh and review it before retrying",
          );
        }

        const recruiterCount = Math.max(recruiter.nRecruited - 1, 0);
        await tx
          .update(userData)
          .set({ nRecruited: recruiterCount })
          .where(eq(userData.userId, input.expectedRecruiterId));
        await tx.insert(actionLog).values({
          id: actionId,
          userId: ctx.userId,
          tableName: "user",
          changes: receiptChanges,
          relatedId: input.userId,
          relatedMsg,
          relatedImage: target.avatarLight,
        });

        return {
          success: true,
          message: `Referral removed from ${target.username}`,
          userId: input.userId,
          recruiterId: input.expectedRecruiterId,
          recruiterCount,
          requestId: input.requestId,
        };
      });

      return result;
    }),
});

export type staffRouter = inferRouterOutputs<typeof staffRouter>;

/**
 * Delay execution for a specified number of milliseconds.
 * @param ms - The number of milliseconds to delay.
 */
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Delete a user and all associated data with automatic retry on deadlock.
 * Implements exponential backoff with jitter to handle MySQL deadlocks (errno 1213).
 * Uses 6 retry attempts with base delay of 100ms (max ~6-7s total retry time).
 * @param client - The database client.
 * @param userId - The ID of the user to delete.
 */
export const deleteUser = async (client: DrizzleClient, userId: string) => {
  const MAX_RETRIES = 6;
  const BASE_DELAY_MS = 100;
  const MAX_JITTER_MS = 100;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await deleteUserInternal(client, userId);
      return;
    } catch (error) {
      if (isMysqlDeadlockError(error) && attempt < MAX_RETRIES) {
        // Exponential backoff with jitter: 300ms, 600ms, 1200ms, 2400ms, 4800ms, 9600ms...
        // Jitter (0-200ms) prevents thundering herd when multiple users retry simultaneously
        const jitter = Math.random() * MAX_JITTER_MS;
        const delayMs = BASE_DELAY_MS * 2 ** (attempt - 1) + jitter;

        // Add Sentry breadcrumb for monitoring retry patterns
        Sentry.addBreadcrumb({
          category: "retry",
          message: `Retrying deleteUser due to deadlock (attempt ${attempt}/${MAX_RETRIES}, delay: ${Math.round(delayMs)}ms)`,
          level: "info",
          data: {
            attempt,
            maxRetries: MAX_RETRIES,
            delayMs: Math.round(delayMs),
            userId,
          },
        });

        await delay(delayMs);
        continue;
      }
      throw error;
    }
  }
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
    // Push writes check for the tombstone before they write; this removes what landed first.
    await lockedClient.delete(userDevice).where(eq(userDevice.userId, userId));
    await lockedClient
      .delete(userLiveActivity)
      .where(eq(userLiveActivity.userId, userId));
    await lockedClient
      .delete(userPushPreference)
      .where(eq(userPushPreference.userId, userId));
  });

  // Batch 1: AI templates may own placement rows. Their lookup is independent of the
  // prerequisite sensei-reference cleanup, so run both together before destructive deletes.
  const [aiPlacements] = await Promise.all([
    client
      .select({ id: overworldAiPlacement.id })
      .from(overworldAiPlacement)
      .where(eq(overworldAiPlacement.aiTemplateUserId, userId)),
    client
      .update(userData)
      .set({ senseiId: null })
      .where(eq(userData.senseiId, userId)),
  ]);
  const aiPlacementIds = aiPlacements.map((placement) => placement.id);

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
    client.delete(farmPlot).where(eq(farmPlot.userId, userId)),
    client.delete(farmExtraction).where(eq(farmExtraction.userId, userId)),
    client.delete(farmCollectionLog).where(eq(farmCollectionLog.userId, userId)),
    client.delete(userJutsu).where(eq(userJutsu.userId, userId)),
    client.delete(userSkill).where(eq(userSkill.userId, userId)),
    client.delete(userAttribute).where(eq(userAttribute.userId, userId)),
    client.delete(jutsuLoadout).where(eq(jutsuLoadout.userId, userId)),
    client.delete(questHistory).where(eq(questHistory.userId, userId)),
    client.delete(userQuestAttempt).where(eq(userQuestAttempt.userId, userId)),
    client.delete(bloodlineRolls).where(eq(bloodlineRolls.userId, userId)),
  ]);

  // Batch 5: History, logs, AI & security
  await Promise.all([
    client.delete(historicalAvatar).where(eq(historicalAvatar.userId, userId)),
    client.delete(historicalIp).where(eq(historicalIp.userId, userId)),
    client.delete(userActivityEvent).where(eq(userActivityEvent.userId, userId)),
    client.delete(actionLog).where(eq(actionLog.userId, userId)),
    client.delete(trainingLog).where(eq(trainingLog.userId, userId)),
    client.delete(aiProfile).where(eq(aiProfile.userId, userId)),
    ...(aiPlacementIds.length > 0
      ? [
          client
            .delete(overworldAiPlacementQuest)
            .where(inArray(overworldAiPlacementQuest.placementId, aiPlacementIds)),
          client
            .delete(overworldAiPlacement)
            .where(inArray(overworldAiPlacement.id, aiPlacementIds)),
        ]
      : []),
    client.delete(captcha).where(eq(captcha.userId, userId)),
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

  // Batch 10: Battle, war & ranked PVP
  await Promise.all([
    client.delete(mpvpBattleUser).where(eq(mpvpBattleUser.userId, userId)),
    client.delete(rankedPvpQueue).where(eq(rankedPvpQueue.userId, userId)),
    client.delete(rankedUserRewards).where(eq(rankedUserRewards.userId, userId)),
    client
      .delete(kageDefendedChallenges)
      .where(eq(kageDefendedChallenges.userId, userId)),
    client
      .delete(kageDefendedChallenges)
      .where(eq(kageDefendedChallenges.kageId, userId)),
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
