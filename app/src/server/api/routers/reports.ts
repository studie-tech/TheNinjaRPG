import {
  and,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
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
  automatedModeration,
  battleAction,
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
import {
  canBanUsers,
  canClearReport,
  canClearUserNindo,
  canEscalateBan,
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
import type { AdditionalContext, ReportCommentSchema } from "@/validators/reports";
import {
  reportCommentSchema,
  reportFilteringSchema,
  reportTimeoutSchema,
  userReportSchema,
  userReviewSchema,
} from "@/validators/reports";
import type { DrizzleClient } from "../../db";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  serverError,
} from "../trpc";
import { fetchImage } from "./conceptart";
import { fetchUser } from "./profile";

const pusher = getServerPusher();

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
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
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
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const getInfraction = async (system: typeof input.system) => {
        switch (system) {
          case "forum_comment": {
            const forumPostData = await ctx.drizzle.query.forumPost.findFirst({
              where: eq(forumPost.id, input.system_id),
            });
            const threadContext = await getAdditionalContext(
              ctx.drizzle,
              system,
              forumPostData?.createdAt,
              forumPostData?.threadId,
            );
            await ctx.drizzle
              .update(forumPost)
              .set({ isReported: true })
              .where(eq(forumPost.id, input.system_id));
            return { infraction: forumPostData, context: threadContext };
          }
          case "conversation_comment": {
            const commentData = await ctx.drizzle.query.conversationComment.findFirst({
              where: eq(conversationComment.id, input.system_id),
            });
            const convoContext = await getAdditionalContext(
              ctx.drizzle,
              system,
              commentData?.createdAt,
              commentData?.conversationId,
            );
            await ctx.drizzle
              .update(conversationComment)
              .set({ isReported: true })
              .where(eq(conversationComment.id, input.system_id));
            return { infraction: commentData, context: convoContext };
          }
          case "user_profile":
            return {
              infraction: await fetchUser(ctx.drizzle, input.system_id),
              context: [],
            };
          case "concept_art":
            return {
              infraction: await fetchImage(ctx.drizzle, input.system_id, ""),
              context: [],
            };
          case "battle_log": {
            await ctx.drizzle
              .update(battleAction)
              .set({ updatedAt: secondsFromNow(72 * 3600) })
              .where(eq(battleAction.id, input.system_id));
            return {
              infraction: {
                content: `<br /><a href="/battlelog/${input.system_id}"><b>Link to Battle Log (available for 72h)<b></a>`,
              },
              context: [],
            };
          }
          default:
            throw serverError("INTERNAL_SERVER_ERROR", "Invalid report system");
        }
      };
      // Create interpretation
      const { infraction, context } = await getInfraction(input.system);
      const { decision, aiInterpretation } = await generateModerationDecision(
        ctx.drizzle,
        JSON.stringify(input),
        context,
      );
      // Guard
      if (!infraction) return errorResponse("Infraction not found");
      if ("isReported" in infraction && infraction.isReported) {
        return errorResponse("This infraction has already been reported");
      }
      // Figure out who was reported. If there is an authorId, use that first, otherwise infraction userId, otherwise input
      const reportedUserId =
        "authorId" in infraction
          ? infraction.authorId
          : "userId" in infraction
            ? infraction.userId
            : input.reported_userId;
      // Mutate
      await insertUserReport(ctx.drizzle, {
        userId: ctx.userId,
        reportedUserId: reportedUserId,
        system: input.system,
        infraction: infraction,
        reason: input.reason,
        aiInterpretation: aiInterpretation,
        predictedStatus: decision.createReport,
        additionalContext: context,
      });
      // Return
      return {
        success: true,
        message: "Your report has been submitted. A moderator will review it asap.",
      };
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
            adminResolved: user.role.includes("ADMIN") || user.role === "OWNER",
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
            adminResolved: user.role.includes("ADMIN") || user.role === "OWNER",
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
            adminResolved: user.role.includes("ADMIN") || user.role === "OWNER",
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
        // Remove ban if no other active bans
        const bans = await ctx.drizzle.query.userReport.findMany({
          where: and(
            eq(userReport.reportedUserId, report.reportedUserId ?? ""),
            eq(userReport.status, "BAN_ACTIVATED"),
            gte(userReport.banEnd, new Date()),
            ne(userReport.id, report.id),
          ),
        });
        if (bans.length === 0) {
          await ctx.drizzle
            .update(userData)
            .set({ isBanned: false })
            .where(eq(userData.userId, report.reportedUserId));
        }
        // Remove silence if no other active silence or timeout reports
        const activeSilenceOrTimeout = await ctx.drizzle.query.userReport.findMany({
          where: and(
            eq(userReport.reportedUserId, report.reportedUserId ?? ""),
            inArray(userReport.status, ["SILENCE_ACTIVATED", "TIMEOUT_ACTIVATED"]),
            gte(userReport.banEnd, new Date()),
            ne(userReport.id, report.id),
          ),
        });
        if (activeSilenceOrTimeout.length === 0) {
          await ctx.drizzle
            .update(userData)
            .set({ isSilenced: false })
            .where(eq(userData.userId, report.reportedUserId));
        }
      }
      // Update report
      await Promise.all([
        ctx.drizzle
          .update(userReport)
          .set({
            adminResolved: user.role.includes("ADMIN") || user.role === "OWNER",
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
    .input(z.object({ userId: z.string() }))
    .output(baseServerResponse)
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
      // Mutate
      const { avatarUrl, thumbnailUrl } = await createUserAvatar(
        ctx.drizzle,
        target,
        false,
      );
      if (!avatarUrl) return errorResponse("Failed to create avatar");
      // Mutate
      await Promise.all([
        ctx.drizzle.insert(reportLog).values({
          id: nanoid(),
          staffUserId: ctx.userId,
          action: "AVATAR_CHANGE",
          targetUserId: input.userId,
        }),
        ctx.drizzle
          .update(userData)
          .set({ avatar: avatarUrl, avatarLight: thumbnailUrl ?? null })
          .where(eq(userData.userId, input.userId)),
        ctx.drizzle.insert(historicalAvatar).values({
          userId: input.userId,
          avatar: avatarUrl,
          avatarLight: thumbnailUrl ?? null,
          status: "success",
          done: true,
        }),
      ]);
      return { success: true, message: "Avatar update request sent" };
    }),
  clearNindo: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .output(baseServerResponse)
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
      // Mutate
      await Promise.all([
        ctx.drizzle.insert(reportLog).values({
          id: nanoid(),
          staffUserId: ctx.userId,
          action: "NINDO_CLEARED",
          targetUserId: input.userId,
        }),
        ctx.drizzle.delete(userNindo).where(eq(userNindo.userId, target.userId)),
      ]);
      return { success: true, message: "Nindo cleared" };
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
            adminResolved: user.role.includes("ADMIN") || user.role === "OWNER",
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

export const insertUserReport = async (
  client: DrizzleClient,
  info: {
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
    id: nanoid(),
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
