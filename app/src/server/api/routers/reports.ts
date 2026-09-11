import {
  and,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNull,
  like,
  lte,
  ne,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { AutomoderationCategory, BanState } from "@/drizzle/constants";
import { TERR_BOT_ID } from "@/drizzle/constants";
import {
  actionLog,
  automatedModeration,
  battleAction,
  battleHistory,
  conceptImage,
  conversation,
  conversationComment,
  forumPost,
  historicalAvatar,
  reportLog,
  userData,
  userNindo,
  userReport,
  userReportComment,
  userReview,
} from "@/drizzle/schema";
import {
  generateModerationDecision,
  getAdditionalContext,
  getRelatedReports,
} from "@/libs/moderator";
import { getServerPusher } from "@/libs/pusher";
import { createUserAvatar } from "@/routers/avatar";
import { isMysqlDuplicateKeyError } from "@/server/utils/mysqlErrors";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  serverError,
} from "@/server/api/trpc";
import {
  canBanUsers,
  canClearReport,
  canClearUserNindo,
  canEscalateBan,
  canMarkAdminResolved,
  canModerateReports,
  canModerateRoles,
  canSeeReport,
  canSeeSecretData,
  canSilenceUsers,
  canTimeoutUsers,
  canWarnUsers,
} from "@/utils/permissions";
import sanitize from "@/utils/sanitize";
import { getMillisecondsFromTimeUnit, secondsFromNow } from "@/utils/time";
import { idSchema } from "@/validators/misc";
import type {
  AdditionalContext,
  ReportCommentSchema,
  UserReportSchema,
} from "@/validators/reports";
import {
  reportCommentSchema,
  reportFilteringSchema,
  reportTimeoutSchema,
  systems,
  userReportSchema,
  userReviewSchema,
} from "@/validators/reports";
import type { DrizzleClient } from "../../db";
import { fetchImage } from "./conceptart";
import { fetchUser } from "./profile";

const pusher = getServerPusher();

/** PlanetScale and the mysql2-backed real-database tests expose different write envelopes. */
const mutationRowsAffected = (result: unknown) => {
  if (result && typeof result === "object" && "rowsAffected" in result) {
    return Number(result.rowsAffected);
  }
  if (
    Array.isArray(result) &&
    result[0] &&
    typeof result[0] === "object" &&
    "affectedRows" in result[0]
  ) {
    return Number(result[0].affectedRows);
  }
  return 0;
};

export const reportsRouter = createTRPCRouter({
  getReportSystemNames: protectedProcedure.query(async ({ ctx }) => {
    return await ctx.drizzle
      .selectDistinct({ system: userReport.system })
      .from(userReport);
  }),
  getReportStatistics: protectedProcedure.query(async ({ ctx }) => {
    const [user, staff, timesReported, timesReporting, decisions] = await Promise.all([
      fetchUser(ctx.drizzle, ctx.userId),
      await ctx.drizzle
        .select({
          userId: userData.userId,
          username: userData.username,
          avatar: userData.avatar,
        })
        .from(userData)
        .where(ne(userData.role, "USER")),
      await ctx.drizzle
        .select({
          userId: userData.userId,
          count: sql`COUNT(${userReport.id})`.mapWith(Number),
        })
        .from(userReport)
        .innerJoin(userData, eq(userData.userId, userReport.reportedUserId))
        .groupBy(sql`${userReport.reportedUserId}`),
      await ctx.drizzle
        .select({
          userId: userData.userId,
          count: sql`COUNT(${userReport.id})`.mapWith(Number),
        })
        .from(userReport)
        .innerJoin(userData, eq(userData.userId, userReport.reporterUserId))
        .groupBy(sql`${userReport.reporterUserId}`),
      await ctx.drizzle
        .select({
          userId: userReportComment.userId,
          count: sql`COUNT(${userReportComment.id})`.mapWith(Number),
          decision: userReportComment.decision,
        })
        .from(userReportComment)
        .groupBy(sql`${userReportComment.userId}, ${userReportComment.decision}`),
    ]);
    if (user.role === "USER") {
      throw serverError("UNAUTHORIZED", "You cannot view this page");
    }
    return { staff, timesReported, timesReporting, decisions };
  }),
  getModBotPerformance: protectedProcedure
    .input(z.object({ timeframe: z.enum(["daily", "weekly"]) }))
    .query(async ({ ctx, input }) => {
      // Query selector
      const selector =
        input.timeframe === "daily"
          ? {
              year: sql<number>`YEAR(CAST(${userReport.createdAt} AS DATE))`,
              time: sql<number>`DAYOFYEAR(CAST(${userReport.createdAt} AS DATE))`,
              count: sql`COUNT(${userReport.id})`.mapWith(Number),
            }
          : {
              year: sql<number>`YEAR(CAST(${userReport.createdAt} AS DATE))`,
              time: sql<number>`WEEK(CAST(${userReport.createdAt} AS DATE))`,
              count: sql`COUNT(${userReport.id})`.mapWith(Number),
            };
      // Where clause
      const whereClause =
        input.timeframe === "daily"
          ? sql`${userReport.createdAt} > CURRENT_TIMESTAMP() -  INTERVAL 30 DAY`
          : sql`${userReport.createdAt} > CURRENT_TIMESTAMP() -  INTERVAL 4 MONTH`;
      // Query
      const [user, totalUserReports, totalBotReports, botReports] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        await ctx.drizzle
          .select(selector)
          .from(userReport)
          .where(
            and(
              ne(userReport.reporterUserId, TERR_BOT_ID),
              ne(userReport.status, "UNVIEWED"),
              whereClause,
            ),
          )
          .groupBy(selector.year, selector.time),
        await ctx.drizzle
          .select(selector)
          .from(userReport)
          .where(
            and(
              eq(userReport.reporterUserId, TERR_BOT_ID),
              ne(userReport.status, "UNVIEWED"),
              ne(userReport.predictedStatus, "REPORT_CLEARED"),
              whereClause,
            ),
          )
          .groupBy(selector.year, selector.time),
        await ctx.drizzle
          .select({
            ...selector,
            status: userReport.status,
            predictedStatus: userReport.predictedStatus,
          })
          .from(userReport)
          .where(
            and(
              eq(userReport.reporterUserId, TERR_BOT_ID),
              ne(userReport.status, "UNVIEWED"),
              ne(userReport.predictedStatus, "REPORT_CLEARED"),
              whereClause,
            ),
          )
          .groupBy(
            selector.year,
            selector.time,
            userReport.status,
            userReport.predictedStatus,
          ),
      ]);
      if (user.role === "USER") {
        throw serverError("UNAUTHORIZED", "You cannot view this page");
      }
      return { totalUserReports, totalBotReports, botReports };
    }),
  getUserReports: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Query
      const [user, reports] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.userReport.findMany({
          where: and(
            eq(userReport.reportedUserId, input.userId),
            ne(userReport.status, "REPORT_CLEARED"),
          ),
          with: {
            reporterUser: {
              columns: {
                userId: true,
                username: true,
                avatar: true,
              },
            },
          },
        }),
      ]);
      // Guard
      if (!canSeeSecretData(user.role)) {
        throw serverError("UNAUTHORIZED", "You cannot view this user's reports");
      }
      // Return reports
      return reports;
    }),
  // Let moderators and higher see all reports, let users see reports associated with them
  getAll: protectedProcedure
    .input(
      reportFilteringSchema.extend({
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input.cursor ? input.cursor : 0;
      const skip = currentCursor * input.limit;
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      const reportedUser = alias(userData, "reportedUser");
      const reporterUser = alias(userData, "reporterUser");
      const staffUser = canModerateRoles.includes(user.role);
      const timeoutOnlyStaff = canTimeoutUsers(user);
      const { reporterUserId, ...rest } = getTableColumns(userReport);
      const reports = await ctx.drizzle
        .select({
          UserReport: !staffUser ? { ...rest } : getTableColumns(userReport),
          reportedUser: { ...getTableColumns(reportedUser) },
        })
        .from(userReport)
        .where(
          and(
            ...(input.system !== undefined
              ? [eq(userReport.system, input.system)]
              : []),
            ...(input.startDate !== undefined
              ? [gte(userReport.createdAt, new Date(input.startDate))]
              : []),
            ...(input.endDate !== undefined
              ? [lte(userReport.createdAt, new Date(input.endDate))]
              : []),
            ...(!staffUser
              ? [
                  and(
                    eq(userReport.reportedUserId, ctx.userId),
                    inArray(userReport.status, [
                      "BAN_ACTIVATED",
                      "OFFICIAL_WARNING",
                      "SILENCE_ACTIVATED",
                      "TIMEOUT_ACTIVATED",
                    ]),
                  ),
                ]
              : timeoutOnlyStaff
                ? [inArray(userReport.status, ["UNVIEWED", "TIMEOUT_ACTIVATED"])] // Aligned with canSeeReport: no reporter/reported exception
                : [input.status ? eq(userReport.status, input.status) : undefined]),
          ),
        )
        .innerJoin(
          reportedUser,
          and(
            eq(reportedUser.userId, userReport.reportedUserId),
            ...(input.reportedUser !== undefined
              ? [like(reportedUser.username, `%${input.reportedUser}%`)]
              : []),
          ),
        )
        .leftJoin(
          reporterUser,
          and(
            eq(reporterUser.userId, userReport.reporterUserId),
            ...(input.reporterUser !== undefined
              ? [like(reporterUser.username, `%${input.reporterUser}%`)]
              : []),
          ),
        )
        .limit(input.limit)
        .orderBy(desc(userReport.updatedAt))
        .offset(skip);

      const nextCursor = reports.length < input.limit ? null : currentCursor + 1;
      return {
        data: reports,
        nextCursor: nextCursor,
      };
    }),
  // Get user report
  getBan: protectedProcedure.query(async ({ ctx }) => {
    // Selector statement
    const [user, allReports] = await Promise.all([
      fetchUser(ctx.drizzle, ctx.userId),
      ctx.drizzle.query.userReport.findMany({
        where: and(
          inArray(userReport.status, [
            "BAN_ACTIVATED",
            "SILENCE_ACTIVATED",
            "TIMEOUT_ACTIVATED",
            "OFFICIAL_WARNING",
          ]),
          eq(userReport.reportedUserId, ctx.userId),
        ),
        with: {
          reporterUser: {
            columns: {
              userId: true,
              username: true,
              avatar: true,
              rank: true,
              isOutlaw: true,
              level: true,
              role: true,
              federalStatus: true,
            },
          },
          reportedUser: {
            columns: {
              userId: true,
              username: true,
              avatar: true,
              rank: true,
              isOutlaw: true,
              level: true,
              role: true,
              federalStatus: true,
            },
          },
        },
      }),
    ]);

    const banReport = allReports?.find(
      (r) => r.status === "BAN_ACTIVATED" && r.banEnd && r.banEnd > new Date(),
    );
    const silenceReport = allReports?.find(
      (r) => r.status === "SILENCE_ACTIVATED" && r.banEnd && r.banEnd > new Date(),
    );
    const timeoutReport = allReports?.find(
      (r) => r.status === "TIMEOUT_ACTIVATED" && r.banEnd && r.banEnd > new Date(),
    );
    const warningReport = user.isWarned
      ? allReports?.find((r) => r.status === "OFFICIAL_WARNING")
      : null;

    // If user can not see secret data, hide reporter
    if (!canSeeSecretData(user.role)) {
      if (banReport) {
        banReport.reporterUser = null;
      }
      if (silenceReport) {
        silenceReport.reporterUser = null;
      }
      if (timeoutReport) {
        timeoutReport.reporterUser = null;
      }
      if (warningReport) {
        warningReport.reporterUser = null;
      }
    }

    // Unsilence user if no active silence, timeout, or ban
    if (!silenceReport && !timeoutReport && !banReport && user.isSilenced) {
      await ctx.drizzle
        .update(userData)
        .set({ isSilenced: false })
        .where(eq(userData.userId, ctx.userId));
    }

    // Unban user if ban no longer active
    if (!banReport && user.isBanned) {
      await ctx.drizzle
        .update(userData)
        .set({ isBanned: false })
        .where(eq(userData.userId, ctx.userId));
    }
    return warningReport ?? banReport ?? silenceReport ?? timeoutReport ?? null;
  }),
  // Accept warning
  acceptWarning: protectedProcedure
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      await ctx.drizzle
        .update(userData)
        .set({ isWarned: false })
        .where(eq(userData.userId, ctx.userId));
      return { success: true, message: "Warning accepted" };
    }),
  // Get a single report
  get: protectedProcedure.input(idSchema).query(async ({ ctx, input }) => {
    // Query
    const [user, report] = await Promise.all([
      fetchUser(ctx.drizzle, ctx.userId),
      fetchUserReport(ctx.drizzle, input.id, ctx.userId),
    ]);
    // Guard
    if (!canSeeReport(user, report)) {
      throw serverError("UNAUTHORIZED", "You have no access to the report");
    }
    // Get previous reports
    const prevReports = canSeeSecretData(user.role)
      ? await getRelatedReports(ctx.drizzle, report.aiInterpretation)
      : [];
    // Return
    return { report, prevReports };
  }),
  // Create a new user report
  create: protectedProcedure
    .input(userReportSchema)
    .output(
      baseServerResponse.extend({
        requestId: z.string().optional(),
        reportId: z.string().optional(),
        system: z.enum(systems).optional(),
        systemId: z.string().optional(),
        reportedUserId: z.string().optional(),
        reportSubjectUserId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return await createUserReport(ctx.drizzle, ctx.userId, input);
    }),
  // Ban a user. If no escalation: moderator-only. If escalated: admin-only
  ban: protectedProcedure
    .input(reportCommentSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, report] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserReport(ctx.drizzle, input.object_id, ctx.userId),
      ]);
      // Guard
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform moderation actions");
      const hasModRights = canModerateReports(user, report);
      if (!hasModRights) return errorResponse("You cannot resolve this report");
      if (!canBanUsers(user)) return errorResponse("You cannot ban users");
      if (!input.banTime || input.banTime <= 0) {
        return errorResponse("Ban time must be specified.");
      }
      // Update
      await Promise.all([
        ...(report.reportedUserId
          ? [
              ctx.drizzle
                .update(userData)
                .set({ isBanned: true, status: "AWAKE", travelFinishAt: null })
                .where(eq(userData.userId, report.reportedUserId)),
            ]
          : []),
        ctx.drizzle
          .update(userReport)
          .set({
            status: "BAN_ACTIVATED",
            adminResolved: canMarkAdminResolved(user.role),
            updatedAt: new Date(),
            banEnd: getBanEndDate(input),
          })
          .where(eq(userReport.id, input.object_id)),
        ctx.drizzle.insert(userReportComment).values({
          id: nanoid(),
          userId: ctx.userId,
          reportId: input.object_id,
          content: sanitize(input.comment),
          decision: "BAN_ACTIVATED",
        }),
      ]);
      return { success: true, message: "User banned" };
    }),
  // Silence a user. If no escalation: moderator-only. If escalated: admin-only
  silence: protectedProcedure
    .input(reportCommentSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, report] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserReport(ctx.drizzle, input.object_id, ctx.userId),
      ]);
      // Guard
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform moderation actions");
      const hasModRights = canModerateReports(user, report);
      if (!hasModRights) return errorResponse("You cannot resolve this report");
      if (!canSilenceUsers(user)) return errorResponse("You cannot silence users");
      if (!input.banTime || input.banTime <= 0) {
        return errorResponse("Ban time must be specified.");
      }
      // Update
      await Promise.all([
        ...(report.reportedUserId
          ? [
              ctx.drizzle
                .update(userData)
                .set({ isSilenced: true, status: "AWAKE" })
                .where(eq(userData.userId, report.reportedUserId)),
            ]
          : []),
        ctx.drizzle
          .update(userReport)
          .set({
            status: "SILENCE_ACTIVATED",
            adminResolved: canMarkAdminResolved(user.role),
            updatedAt: new Date(),
            banEnd: getBanEndDate(input),
          })
          .where(eq(userReport.id, input.object_id)),
        ctx.drizzle.insert(userReportComment).values({
          id: nanoid(),
          userId: ctx.userId,
          reportId: input.object_id,
          content: sanitize(input.comment),
          decision: "SILENCE_ACTIVATED",
        }),
      ]);
      return { success: true, message: "User silenced" };
    }),
  // Timeout: 1-hour silence. CONTENT-ADMIN and EVENT-ADMIN only.
  timeout: protectedProcedure
    .input(reportTimeoutSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, report] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserReport(ctx.drizzle, input.object_id, ctx.userId),
      ]);
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform moderation actions");
      const hasModRights = canModerateReports(user, report);
      if (!hasModRights) return errorResponse("You cannot resolve this report");
      if (!canTimeoutUsers(user)) return errorResponse("You cannot timeout users");
      const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
      await Promise.all([
        ...(report.reportedUserId
          ? [
              ctx.drizzle
                .update(userData)
                .set({ isSilenced: true, status: "AWAKE" })
                .where(eq(userData.userId, report.reportedUserId)),
            ]
          : []),
        ctx.drizzle
          .update(userReport)
          .set({
            status: "TIMEOUT_ACTIVATED",
            adminResolved: true,
            updatedAt: new Date(),
            banEnd: oneHourFromNow,
          })
          .where(eq(userReport.id, input.object_id)),
        ctx.drizzle.insert(userReportComment).values({
          id: nanoid(),
          userId: ctx.userId,
          reportId: input.object_id,
          content: sanitize(input.comment),
          decision: "TIMEOUT_ACTIVATED",
        }),
      ]);
      return { success: true, message: "User timed out (1 hour)" };
    }),
  // Issue warning to user
  warn: protectedProcedure
    .input(reportCommentSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, report] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserReport(ctx.drizzle, input.object_id, ctx.userId),
      ]);
      // Guard
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform moderation actions");
      const hasModRights = canModerateReports(user, report);
      if (!report.reportedUserId) return errorResponse("No user to warn");
      if (!hasModRights) return errorResponse("No permission to warn");
      if (!canWarnUsers(user)) return errorResponse("You cannot warn users");
      // Update
      await Promise.all([
        ctx.drizzle
          .update(userReport)
          .set({
            status: "OFFICIAL_WARNING",
            adminResolved: canMarkAdminResolved(user.role),
            updatedAt: new Date(),
            banEnd: null,
          })
          .where(eq(userReport.id, input.object_id)),
        ctx.drizzle
          .update(userData)
          .set({ isWarned: true })
          .where(eq(userData.userId, report.reportedUserId ?? "")),
        ctx.drizzle.insert(userReportComment).values({
          id: nanoid(),
          userId: ctx.userId,
          reportId: input.object_id,
          content: sanitize(input.comment),
          decision: "OFFICIAL_WARNING",
        }),
      ]);
      if (report.reportedUserId) {
        void pusher.trigger(report.reportedUserId, "event", {
          type: "userMessage",
          message: `You have been given a warning`,
          route: "/reports",
          routeText: "To Report",
        });
      }
      return { success: true, message: "User warned" };
    }),
  // Escalate a report to admin. Only if already banned, and no previous escalation
  escalate: protectedProcedure
    .input(reportCommentSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, report] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserReport(ctx.drizzle, input.object_id, ctx.userId),
      ]);
      // Guard
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform moderation actions");
      if (canEscalateBan(user, report)) return errorResponse("You cannot escalate");
      // Update
      await Promise.all([
        ctx.drizzle
          .update(userReport)
          .set({ status: "BAN_ESCALATED", updatedAt: new Date() })
          .where(eq(userReport.id, input.object_id)),
        ctx.drizzle.insert(userReportComment).values({
          id: nanoid(),
          userId: ctx.userId,
          reportId: input.object_id,
          content: sanitize(input.comment),
          decision: "BAN_ESCALATED",
        }),
      ]);
      return { success: true, message: "Report escalated" };
    }),
  clear: protectedProcedure
    .input(reportCommentSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, report] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserReport(ctx.drizzle, input.object_id, ctx.userId),
      ]);
      // Guard
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform moderation actions");
      if (!canClearReport(user, report)) return errorResponse("No permission");
      // If someone was reported
      if (report.reportedUserId) {
        const reportedUserId = report.reportedUserId;
        const [bans, activeSilenceOrTimeout, activeTradeBans] = await Promise.all([
          ctx.drizzle.query.userReport.findMany({
            where: and(
              eq(userReport.reportedUserId, reportedUserId),
              eq(userReport.status, "BAN_ACTIVATED"),
              gte(userReport.banEnd, new Date()),
              ne(userReport.id, report.id),
            ),
          }),
          ctx.drizzle.query.userReport.findMany({
            where: and(
              eq(userReport.reportedUserId, reportedUserId),
              inArray(userReport.status, ["SILENCE_ACTIVATED", "TIMEOUT_ACTIVATED"]),
              gte(userReport.banEnd, new Date()),
              ne(userReport.id, report.id),
            ),
          }),
          ctx.drizzle.query.userReport.findMany({
            where: and(
              eq(userReport.reportedUserId, reportedUserId),
              eq(userReport.status, "TRADE_BAN_ACTIVATED"),
              gte(userReport.banEnd, new Date()),
              ne(userReport.id, report.id),
            ),
          }),
        ]);
        await Promise.all([
          ...(bans.length === 0
            ? [
                ctx.drizzle
                  .update(userData)
                  .set({ isBanned: false })
                  .where(eq(userData.userId, reportedUserId)),
              ]
            : []),
          ...(activeSilenceOrTimeout.length === 0
            ? [
                ctx.drizzle
                  .update(userData)
                  .set({ isSilenced: false })
                  .where(eq(userData.userId, reportedUserId)),
              ]
            : []),
          ...(activeTradeBans.length === 0
            ? [
                ctx.drizzle
                  .update(userData)
                  .set({ isTradeBanned: false })
                  .where(eq(userData.userId, reportedUserId)),
              ]
            : []),
        ]);
      }
      // Update report
      await Promise.all([
        ctx.drizzle
          .update(userReport)
          .set({
            adminResolved: canMarkAdminResolved(user.role),
            status: "REPORT_CLEARED",
            updatedAt: new Date(),
          })
          .where(eq(userReport.id, report.id)),
        ctx.drizzle.insert(userReportComment).values({
          id: nanoid(),
          userId: ctx.userId,
          reportId: report.id,
          content: sanitize(input.comment),
          decision: "REPORT_CLEARED",
        }),
      ]);
      return { success: true, message: "Report cleared" };
    }),
  updateUserAvatar: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        expectedAvatar: z.string().nullable(),
      }),
    )
    .output(
      baseServerResponse.extend({
        userId: z.string().optional(),
        avatar: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, target] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.userId),
      ]);
      // Guard
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform moderation actions");
      if (!canClearUserNindo(user)) {
        return errorResponse("You cannot replace user avatars");
      }
      if (target.isAi) return errorResponse("AI avatars cannot be replaced here");
      if (target.avatar !== input.expectedAvatar) {
        return errorResponse(
          "This user's avatar has changed. Refresh the profile before replacing it.",
        );
      }
      // Mutate
      const { avatarUrl, thumbnailUrl } = await createUserAvatar(
        ctx.drizzle,
        target,
        false,
      );
      if (!avatarUrl) return errorResponse("Failed to create avatar");
      // Generation can take long enough for the moderator's access to change. Do not
      // let a request authorized minutes ago commit after a ban or role removal.
      const currentUser = await fetchUser(ctx.drizzle, ctx.userId);
      if (currentUser.isBanned) {
        return errorResponse("You are banned and cannot perform moderation actions");
      }
      if (!canClearUserNindo(currentUser)) {
        return errorResponse("You cannot replace user avatars");
      }
      // Commit the avatar, audit, and history atomically. The expected-avatar guard
      // makes concurrent moderation requests deterministic: only the first may win.
      const committed = await ctx.drizzle.transaction(async (tx) => {
        const updateResult = await tx
          .update(userData)
          .set({ avatar: avatarUrl, avatarLight: thumbnailUrl ?? null })
          .where(
            and(
              eq(userData.userId, input.userId),
              input.expectedAvatar === null
                ? isNull(userData.avatar)
                : eq(userData.avatar, input.expectedAvatar),
            ),
          );
        if (updateResult.rowsAffected !== 1) return false;

        await tx.insert(reportLog).values({
          id: nanoid(),
          staffUserId: ctx.userId,
          action: "AVATAR_CHANGE",
          targetUserId: input.userId,
        });
        await tx.insert(historicalAvatar).values({
          userId: input.userId,
          avatar: avatarUrl,
          avatarLight: thumbnailUrl ?? null,
          status: "success",
          done: true,
        });
        return true;
      });
      if (!committed) {
        return errorResponse(
          "This user's avatar changed while the replacement was generated. Refresh and try again.",
        );
      }
      return {
        success: true,
        message: "Avatar replaced",
        userId: input.userId,
        avatar: avatarUrl,
      };
    }),
  clearNindo: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        nindoId: z.string(),
        expectedContent: z.string(),
      }),
    )
    .output(
      baseServerResponse.extend({
        userId: z.string().optional(),
        nindoId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, target] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.userId),
      ]);
      // Guard
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform moderation actions");
      if (!canClearUserNindo(user)) return errorResponse("You cannot clear nindos");

      // The displayed nindo and its audit entry are one atomic moderation action.
      // Including the source id and content in the delete predicate prevents a stale
      // confirmation from clearing text the target edited after the modal opened.
      const committed = await ctx.drizzle.transaction(async (tx) => {
        const deleted = await tx
          .delete(userNindo)
          .where(
            and(
              eq(userNindo.id, input.nindoId),
              eq(userNindo.userId, target.userId),
              sql`BINARY ${userNindo.content} = BINARY ${input.expectedContent}`,
            ),
          );
        if (deleted.rowsAffected !== 1) return false;

        await tx.insert(reportLog).values({
          id: nanoid(),
          staffUserId: ctx.userId,
          action: "NINDO_CLEARED",
          targetUserId: input.userId,
        });
        return true;
      });
      if (!committed) {
        return errorResponse(
          "This nindo changed or was already cleared. Refresh the profile and try again.",
        );
      }
      return {
        success: true,
        message: "Nindo cleared",
        userId: input.userId,
        nindoId: input.nindoId,
      };
    }),
  getUserStaffReviews: protectedProcedure.query(async ({ ctx }) => {
    return await ctx.drizzle.query.userReview.findMany({
      where: eq(userReview.authorUserId, ctx.userId),
    });
  }),
  upsertStaffReview: protectedProcedure
    .input(userReviewSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, target, review] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.staffUserId),
        ctx.drizzle.query.userReview.findFirst({
          where: and(
            eq(userReview.targetUserId, input.staffUserId),
            eq(userReview.authorUserId, ctx.userId),
          ),
        }),
      ]);
      // Guard
      if (user.isBanned) return errorResponse("You are banned and cannot post reviews");
      if (target.role === "USER") return errorResponse("You cannot review users");
      // Mutate
      if (review) {
        await ctx.drizzle
          .update(userReview)
          .set({
            positive: input.positive,
            review: input.review,
            createdAt: new Date(),
          })
          .where(eq(userReview.id, review.id));
        return { success: true, message: "Staff review updated" };
      } else {
        await ctx.drizzle.insert(userReview).values({
          id: nanoid(),
          targetUserId: input.staffUserId,
          authorUserId: ctx.userId,
          authorIp: ctx.userIp ?? "unknown",
          positive: input.positive,
          review: input.review,
        });
        return { success: true, message: "Staff review created" };
      }
    }),
  getUserModerationSummary: protectedProcedure
    .input(z.object({ userId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      // Query
      const targetUserId = input.userId ?? ctx.userId;
      const [user, results] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle
          .select({
            totalEntries: sql`COUNT(*)`.mapWith(Number),
            sexual:
              sql<number>`SUM(CASE WHEN ${automatedModeration.sexual} = true THEN 1 ELSE 0 END)`.mapWith(
                Number,
              ),
            sexual_minors:
              sql<number>`SUM(CASE WHEN ${automatedModeration.sexual_minors} = true THEN 1 ELSE 0 END)`.mapWith(
                Number,
              ),
            harassment:
              sql<number>`SUM(CASE WHEN ${automatedModeration.harassment} = true THEN 1 ELSE 0 END)`.mapWith(
                Number,
              ),
            harassment_threatening:
              sql<number>`SUM(CASE WHEN ${automatedModeration.harassment_threatening} = true THEN 1 ELSE 0 END)`.mapWith(
                Number,
              ),
            hate: sql<number>`SUM(CASE WHEN ${automatedModeration.hate} = true THEN 1 ELSE 0 END)`.mapWith(
              Number,
            ),
            hate_threatening:
              sql<number>`SUM(CASE WHEN ${automatedModeration.hate_threatening} = true THEN 1 ELSE 0 END)`.mapWith(
                Number,
              ),
            illicit:
              sql<number>`SUM(CASE WHEN ${automatedModeration.illicit} = true THEN 1 ELSE 0 END)`.mapWith(
                Number,
              ),
            illicit_violent:
              sql<number>`SUM(CASE WHEN ${automatedModeration.illicit_violent} = true THEN 1 ELSE 0 END)`.mapWith(
                Number,
              ),
            self_harm:
              sql<number>`SUM(CASE WHEN ${automatedModeration.self_harm} = true THEN 1 ELSE 0 END)`.mapWith(
                Number,
              ),
            self_harm_intent:
              sql<number>`SUM(CASE WHEN ${automatedModeration.self_harm_intent} = true THEN 1 ELSE 0 END)`.mapWith(
                Number,
              ),
            self_harm_instructions:
              sql<number>`SUM(CASE WHEN ${automatedModeration.self_harm_instructions} = true THEN 1 ELSE 0 END)`.mapWith(
                Number,
              ),
            violence:
              sql<number>`SUM(CASE WHEN ${automatedModeration.violence} = true THEN 1 ELSE 0 END)`.mapWith(
                Number,
              ),
            violence_graphic:
              sql<number>`SUM(CASE WHEN ${automatedModeration.violence_graphic} = true THEN 1 ELSE 0 END)`.mapWith(
                Number,
              ),
          })
          .from(automatedModeration)
          .where(eq(automatedModeration.userId, targetUserId)),
      ]);

      // Only allow users to see their own moderation data or staff to see anyone's
      if (targetUserId !== ctx.userId && !canSeeSecretData(user.role)) {
        throw serverError(
          "UNAUTHORIZED",
          "You cannot view this user's moderation data",
        );
      }
      return results;
    }),
  // Trade ban a user - moderators can ban users from blackmarket and auction house
  tradeBan: protectedProcedure
    .input(reportCommentSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, report] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserReport(ctx.drizzle, input.object_id, ctx.userId),
      ]);
      // Guard
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform moderation actions");
      const hasModRights = canModerateReports(user, report);
      if (!hasModRights) return errorResponse("You cannot resolve this report");
      if (!canBanUsers(user)) return errorResponse("You cannot ban users");
      if (!input.banTime || input.banTime <= 0) {
        return errorResponse("Ban time must be specified.");
      }
      // Create a system report for the trade ban
      await Promise.all([
        ...(report.reportedUserId
          ? [
              ctx.drizzle
                .update(userData)
                .set({ isTradeBanned: true })
                .where(eq(userData.userId, report.reportedUserId)),
            ]
          : []),
        ctx.drizzle
          .update(userReport)
          .set({
            status: "TRADE_BAN_ACTIVATED",
            adminResolved: canMarkAdminResolved(user.role),
            updatedAt: new Date(),
            banEnd: getBanEndDate(input),
          })
          .where(eq(userReport.id, input.object_id)),
        ctx.drizzle.insert(userReportComment).values({
          id: nanoid(),
          userId: ctx.userId,
          reportId: input.object_id,
          content: sanitize(input.comment),
          decision: "TRADE_BAN_ACTIVATED",
        }),
      ]);
      return { success: true, message: "User trade banned" };
    }),
});

export const fetchUserReport = async (
  client: DrizzleClient,
  userReportId: string,
  fetcherUserId: string,
) => {
  const entry = await client.query.userReport.findFirst({
    where: eq(userReport.id, userReportId),
    with: {
      reporterUser: {
        columns: {
          userId: true,
          username: true,
          avatar: true,
          rank: true,
          isOutlaw: true,
          level: true,
          role: true,
          federalStatus: true,
        },
      },
      reportedUser: {
        columns: {
          userId: true,
          username: true,
          avatar: true,
          rank: true,
          isOutlaw: true,
          level: true,
          role: true,
          federalStatus: true,
        },
      },
    },
  });
  if (!entry) {
    throw new Error("Report not found");
  }
  // If fetching report on yourself, hide reporter
  if (fetcherUserId === entry.reportedUserId) {
    entry.reporterUser = null;
    entry.reporterUserId = null;
  }
  return entry;
};

export const getBanEndDate = (input: ReportCommentSchema) => {
  return input.banTime !== undefined && input.banTimeUnit !== undefined
    ? new Date(
        Date.now() + input.banTime * getMillisecondsFromTimeUnit(input.banTimeUnit),
      )
    : null;
};

type ReportSubject = {
  infraction: Record<string, unknown>;
  context: AdditionalContext[];
  reportedUserId: string;
};

type CreateReportReceipt = {
  request: {
    system: UserReportSchema["system"];
    systemId: string;
    reportedUserId: string;
    reason: string;
  };
  response: {
    reportId: string;
    system: UserReportSchema["system"];
    systemId: string;
    reportedUserId: string;
    reportSubjectUserId: string;
  };
};

const reportCreatedMessage =
  "Your report has been submitted. A moderator will review it asap.";

const getCreateReportReceipt = async (client: DrizzleClient, actionId: string) => {
  return await client.query.actionLog.findFirst({
    where: eq(actionLog.id, actionId),
    columns: {
      userId: true,
      tableName: true,
      relatedId: true,
      relatedMsg: true,
      changes: true,
    },
  });
};

const replayCreateReport = (
  receipt: Awaited<ReturnType<typeof getCreateReportReceipt>>,
  actorUserId: string,
  requestId: string,
  expectedRequest: CreateReportReceipt["request"],
) => {
  if (!receipt) return null;
  const changes = receipt.changes as Partial<CreateReportReceipt> | null;
  const storedRequest = changes?.request;
  const response = changes?.response;
  const valid =
    receipt.userId === actorUserId &&
    receipt.tableName === "UserReport" &&
    receipt.relatedMsg === requestId &&
    storedRequest?.system === expectedRequest.system &&
    storedRequest.systemId === expectedRequest.systemId &&
    storedRequest.reportedUserId === expectedRequest.reportedUserId &&
    storedRequest.reason === expectedRequest.reason &&
    typeof response?.reportId === "string" &&
    response.reportId.length > 0 &&
    response.reportId === receipt.relatedId &&
    response.system === expectedRequest.system &&
    response.systemId === expectedRequest.systemId &&
    response.reportedUserId === expectedRequest.reportedUserId &&
    typeof response.reportSubjectUserId === "string" &&
    response.reportSubjectUserId.length > 0;
  if (!valid) return errorResponse("Invalid report request ID");
  if (!response) return errorResponse("Invalid report request ID");
  return {
    success: true as const,
    message: reportCreatedMessage,
    requestId,
    reportId: response.reportId,
    system: response.system,
    systemId: expectedRequest.systemId,
    reportedUserId: response.reportedUserId,
    reportSubjectUserId: response.reportSubjectUserId,
  };
};

const loadReportSubject = async (
  client: DrizzleClient,
  actor: typeof userData.$inferSelect,
  input: UserReportSchema,
): Promise<ReportSubject | { error: string }> => {
  switch (input.system) {
    case "forum_comment": {
      const entry = await client.query.forumPost.findFirst({
        where: eq(forumPost.id, input.system_id),
      });
      if (!entry) return { error: "Infraction not found" };
      if (entry.isReported)
        return { error: "This infraction has already been reported" };
      if (input.reported_userId !== entry.userId) {
        return { error: "The reported user changed. Refresh and try again" };
      }
      return {
        infraction: entry,
        context: await getAdditionalContext(
          client,
          input.system,
          entry.createdAt,
          entry.threadId,
        ),
        // authorId is the authenticated account behind AI/persona-authored content.
        reportedUserId: entry.authorId,
      };
    }
    case "conversation_comment":
    case "tavern_comment": {
      const entry = await client.query.conversationComment.findFirst({
        where: eq(conversationComment.id, input.system_id),
      });
      if (!entry) return { error: "Infraction not found" };
      if (entry.isReported)
        return { error: "This infraction has already been reported" };
      if (input.reported_userId !== entry.userId) {
        return { error: "The reported user changed. Refresh and try again" };
      }
      if (entry.conversationId) {
        const parent = await client.query.conversation.findFirst({
          where: eq(conversation.id, entry.conversationId),
          with: { users: true },
        });
        if (!parent) return { error: "Conversation not found" };
        const canView =
          parent.isPublic ||
          parent.users.some((member) => member.userId === actor.userId) ||
          (parent.isStaffAvailable && actor.role !== "USER");
        if (!canView) return { error: "You cannot report content you cannot view" };
      }
      return {
        infraction: entry,
        context: await getAdditionalContext(
          client,
          "conversation_comment",
          entry.createdAt,
          entry.conversationId,
        ),
        reportedUserId: entry.authorId,
      };
    }
    case "user_profile": {
      const target = await client.query.userData.findFirst({
        where: eq(userData.userId, input.system_id),
      });
      if (!target) return { error: "User not found" };
      if (input.reported_userId !== target.userId) {
        return { error: "The reported user changed. Refresh and try again" };
      }
      return { infraction: target, context: [], reportedUserId: target.userId };
    }
    case "concept_art": {
      const image = await fetchImage(client, input.system_id, actor.userId);
      if (!image) return { error: "Infraction not found" };
      if (input.reported_userId !== image.userId) {
        return { error: "The reported user changed. Refresh and try again" };
      }
      return { infraction: image, context: [], reportedUserId: image.userId };
    }
    case "battle_log": {
      const history = await client.query.battleHistory.findFirst({
        where: eq(battleHistory.battleId, input.system_id),
      });
      if (!history) return { error: "Battle log not found" };
      if (
        input.reported_userId !== history.attackedId &&
        input.reported_userId !== history.defenderId
      ) {
        return {
          error: "The reported battle participant changed. Refresh and try again",
        };
      }
      return {
        infraction: {
          id: input.system_id,
          content: `<br /><a href="/battlelog/${input.system_id}"><b>Link to Battle Log (available for 72h)<b></a>`,
        },
        context: [],
        reportedUserId: input.reported_userId,
      };
    }
  }
};

/**
 * Create one user report with a durable request receipt. Moderation is completed before the
 * transaction, while the reported flag, report, retention update and receipt commit together.
 * The optional moderation dependency keeps the database contract executable in focused tests.
 */
export const createUserReport = async (
  client: DrizzleClient,
  actorUserId: string,
  input: UserReportSchema,
  moderate: typeof generateModerationDecision = generateModerationDecision,
) => {
  const requestId = input.requestId ?? crypto.randomUUID();
  const actionId = `create-report:${actorUserId}:${requestId}`;
  const expectedRequest: CreateReportReceipt["request"] = {
    system: input.system,
    systemId: input.system_id,
    reportedUserId: input.reported_userId,
    reason: sanitize(input.reason),
  };

  // A lost response should not invoke the moderation service again.
  const previousReceipt = await getCreateReportReceipt(client, actionId);
  if (previousReceipt) {
    return (
      replayCreateReport(previousReceipt, actorUserId, requestId, expectedRequest) ??
      errorResponse("Invalid report request ID")
    );
  }

  const actor = await client.query.userData.findFirst({
    where: eq(userData.userId, actorUserId),
  });
  if (!actor) return errorResponse("User not found");
  if (actor.isBanned) return errorResponse("You are banned and cannot submit reports");

  const subject = await loadReportSubject(client, actor, input);
  if ("error" in subject) return errorResponse(subject.error);
  if (subject.reportedUserId === actorUserId) {
    return errorResponse("You cannot report yourself");
  }
  const target = await client.query.userData.findFirst({
    where: eq(userData.userId, subject.reportedUserId),
    columns: { userId: true },
  });
  if (!target) return errorResponse("Reported user not found");

  const moderation = await moderate(
    client,
    JSON.stringify({ ...expectedRequest, requestId: undefined }),
    subject.context,
  );
  const reportId = nanoid();
  const retentionUntil = secondsFromNow(72 * 3600);

  try {
    const committed = await client.transaction(async (tx) => {
      // Actor/target locks keep authorization and identity stable through the commit. Statements
      // are intentionally sequential: PlanetScale transaction handles are single-connection.
      await tx.execute(
        sql`SELECT ${userData.userId} FROM ${userData} WHERE ${userData.userId} IN (${actorUserId}, ${subject.reportedUserId}) ORDER BY ${userData.userId} FOR UPDATE`,
      );

      const currentActor = await tx.query.userData.findFirst({
        where: eq(userData.userId, actorUserId),
      });
      if (!currentActor) return errorResponse("User not found");
      if (currentActor.isBanned) {
        return errorResponse("You are banned and cannot submit reports");
      }
      if (subject.reportedUserId === actorUserId) {
        return errorResponse("You cannot report yourself");
      }
      const currentTarget = await tx.query.userData.findFirst({
        where: eq(userData.userId, subject.reportedUserId),
        columns: { userId: true },
      });
      if (!currentTarget) return errorResponse("Reported user not found");

      const racedReceipt = await getCreateReportReceipt(tx, actionId);
      if (racedReceipt) {
        return (
          replayCreateReport(racedReceipt, actorUserId, requestId, expectedRequest) ??
          errorResponse("Invalid report request ID")
        );
      }

      if (input.system === "forum_comment") {
        const entry = subject.infraction as typeof forumPost.$inferSelect;
        const claimed = await tx
          .update(forumPost)
          .set({ isReported: true })
          .where(
            and(
              eq(forumPost.id, input.system_id),
              eq(forumPost.authorId, entry.authorId),
              eq(forumPost.userId, entry.userId),
              sql`BINARY ${forumPost.content} = BINARY ${entry.content}`,
              eq(forumPost.isReported, false),
            ),
          );
        if (mutationRowsAffected(claimed) !== 1) {
          return errorResponse("This infraction changed or has already been reported");
        }
      } else if (
        input.system === "conversation_comment" ||
        input.system === "tavern_comment"
      ) {
        const entry = subject.infraction as typeof conversationComment.$inferSelect;
        if (entry.conversationId) {
          const parent = await tx.query.conversation.findFirst({
            where: eq(conversation.id, entry.conversationId),
            with: { users: true },
          });
          const canStillView =
            parent &&
            (parent.isPublic ||
              parent.users.some((member) => member.userId === actorUserId) ||
              (parent.isStaffAvailable && currentActor.role !== "USER"));
          if (!canStillView) {
            return errorResponse("You can no longer view this conversation");
          }
        }
        const claimed = await tx
          .update(conversationComment)
          .set({ isReported: true })
          .where(
            and(
              eq(conversationComment.id, input.system_id),
              eq(conversationComment.authorId, entry.authorId),
              eq(conversationComment.userId, entry.userId),
              sql`BINARY ${conversationComment.content} = BINARY ${entry.content}`,
              eq(conversationComment.isReported, false),
            ),
          );
        if (mutationRowsAffected(claimed) !== 1) {
          return errorResponse("This infraction changed or has already been reported");
        }
      } else if (input.system === "battle_log") {
        const history = await tx.query.battleHistory.findFirst({
          where: and(
            eq(battleHistory.battleId, input.system_id),
            sql`${input.reported_userId} IN (${battleHistory.attackedId}, ${battleHistory.defenderId})`,
          ),
        });
        if (!history) {
          return errorResponse("The battle log changed. Refresh and try again");
        }
        await tx
          .update(battleAction)
          .set({ updatedAt: retentionUntil })
          .where(eq(battleAction.battleId, input.system_id));
      } else if (input.system === "concept_art") {
        const currentImage = await tx.query.conceptImage.findFirst({
          where: and(
            eq(conceptImage.id, input.system_id),
            eq(conceptImage.userId, subject.reportedUserId),
          ),
          columns: { id: true },
        });
        if (!currentImage)
          return errorResponse("The concept art changed. Refresh and try again");
      }

      await insertUserReport(tx, {
        id: reportId,
        userId: actorUserId,
        reportedUserId: subject.reportedUserId,
        system: input.system,
        infraction: subject.infraction,
        reason: expectedRequest.reason,
        aiInterpretation: moderation.aiInterpretation,
        predictedStatus: moderation.decision.createReport,
        additionalContext: subject.context,
      });
      const receipt: CreateReportReceipt = {
        request: expectedRequest,
        response: {
          reportId,
          system: input.system,
          systemId: input.system_id,
          reportedUserId: input.reported_userId,
          reportSubjectUserId: subject.reportedUserId,
        },
      };
      await tx.insert(actionLog).values({
        id: actionId,
        userId: actorUserId,
        tableName: "UserReport",
        changes: receipt,
        relatedId: reportId,
        relatedMsg: requestId,
      });
      return {
        success: true as const,
        message: reportCreatedMessage,
        requestId,
        reportId,
        system: input.system,
        systemId: input.system_id,
        reportedUserId: input.reported_userId,
        reportSubjectUserId: subject.reportedUserId,
      };
    });
    return committed;
  } catch (error) {
    if (!isMysqlDuplicateKeyError(error)) throw error;
    // A same-request concurrent transaction can lose the receipt PK race. The winner's commit
    // is the only state that converts that duplicate into success.
    const receipt = await getCreateReportReceipt(client, actionId);
    return (
      replayCreateReport(receipt, actorUserId, requestId, expectedRequest) ??
      errorResponse("This report was submitted concurrently. Refresh and try again")
    );
  }
};

export const insertUserReport = async (
  client: DrizzleClient,
  info: {
    id?: string;
    userId: string;
    reportedUserId: string;
    system: string;
    infraction: unknown;
    additionalContext: AdditionalContext[];
    reason: string;
    aiInterpretation: string;
    predictedStatus: BanState;
  },
) => {
  await client.insert(userReport).values({
    id: info.id ?? nanoid(),
    reporterUserId: info.userId,
    reportedUserId: info.reportedUserId,
    system: info.system,
    infraction: info.infraction,
    aiInterpretation: info.aiInterpretation,
    reason: sanitize(info.reason),
    predictedStatus: info.predictedStatus,
    additionalContext: info.additionalContext,
  });
};

/**
 * Insert an automated moderation report
 * @param client - The database client
 * @param info - The information to insert
 */
export const insertAutomatedModeration = async (
  client: DrizzleClient,
  info: {
    userId: string;
    content: string;
    relationType: AutomoderationCategory;
    categories: {
      sexual: boolean;
      sexual_minors: boolean;
      harassment: boolean;
      harassment_threatening: boolean;
      hate: boolean;
      hate_threatening: boolean;
      illicit: boolean;
      illicit_violent: boolean;
      self_harm: boolean;
      self_harm_intent: boolean;
      self_harm_instructions: boolean;
      violence: boolean;
      violence_graphic: boolean;
    };
  },
) => {
  await client.insert(automatedModeration).values({
    id: nanoid(),
    userId: info.userId,
    content: info.content,
    relationType: info.relationType,
    sexual: info.categories.sexual,
    sexual_minors: info.categories.sexual_minors,
    harassment: info.categories.harassment,
    harassment_threatening: info.categories.harassment_threatening,
    hate: info.categories.hate,
    hate_threatening: info.categories.hate_threatening,
    illicit: info.categories.illicit,
    illicit_violent: info.categories.illicit_violent,
    self_harm: info.categories.self_harm,
    self_harm_intent: info.categories.self_harm_intent,
    self_harm_instructions: info.categories.self_harm_instructions,
    violence: info.categories.violence,
    violence_graphic: info.categories.violence_graphic,
  });
};
