import {
  and,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNull,
  like,
  lte,
  ne,
  notExists,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { AutomoderationCategory, BanState } from "@/drizzle/constants";
import {
  MODERATION_PROMPT_VERSION,
  OPENAI_MODERATION_MODEL,
} from "@/drizzle/constants";
import {
  automatedModeration,
  battleAction,
  conversation,
  conversationComment,
  forumPost,
  historicalAvatar,
  moderationScan,
  reportLog,
  userData,
  userNindo,
  userReport,
  userReportComment,
  userReview,
} from "@/drizzle/schema";
import { buildModerationEvidence } from "@/libs/moderation/evidence";
import { getRelatedReports } from "@/libs/moderation/reportSearch";
import { buildModBotStats } from "@/libs/moderation/stats";
import { generateModerationDecision, getAdditionalContext } from "@/libs/moderator";
import { getServerPusher } from "@/libs/pusher";
import { createUserAvatar } from "@/routers/avatar";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  serverError,
} from "@/server/api/trpc";
import { scheduleDiscordSync } from "@/server/utils/discord/sync";
import { updateSanctionReport } from "@/server/utils/sanctionTombstone";
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
  isStaffRole,
} from "@/utils/permissions";
import sanitize from "@/utils/sanitize";
import {
  getMillisecondsFromTimeUnit,
  getUtcDayWindowStart,
  secondsFromNow,
} from "@/utils/time";
import { idSchema } from "@/validators/misc";
import type { AdditionalContext, ReportCommentSchema } from "@/validators/reports";
import {
  modBotPerformanceSchema,
  reportCommentSchema,
  reportFilteringSchema,
  reportTimeoutSchema,
  userReportSchema,
  userReviewSchema,
} from "@/validators/reports";
import type { DrizzleClient } from "../../db";
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
    .input(modBotPerformanceSchema)
    .query(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!isStaffRole(user.role))
        throw serverError("UNAUTHORIZED", "Only staff can view bot performance");
      const now = new Date();
      const start = getUtcDayWindowStart(input.days, now);
      const [reports, scans] = await Promise.all([
        ctx.drizzle
          .select({
            createdAt: userReport.createdAt,
            reporterUserId: userReport.reporterUserId,
            status: userReport.status,
            system: userReport.system,
            predictedStatus: userReport.predictedStatus,
            predictedAt: userReport.predictedAt,
            promptVersion: userReport.promptVersion,
          })
          .from(userReport)
          .where(and(gte(userReport.createdAt, start), lte(userReport.createdAt, now))),
        ctx.drizzle
          .select({
            createdAt: sql<Date>`MIN(${moderationScan.createdAt})`.mapWith(
              moderationScan.createdAt,
            ),
            count: sql`COUNT(*)`.mapWith(Number),
            relationType: moderationScan.relationType,
            outcome: moderationScan.outcome,
            flagged: moderationScan.flagged,
            promptVersion: moderationScan.promptVersion,
          })
          .from(moderationScan)
          .where(
            and(
              gte(moderationScan.createdAt, start),
              lte(moderationScan.createdAt, now),
            ),
          )
          .groupBy(
            sql`DATE(${moderationScan.createdAt})`,
            moderationScan.relationType,
            moderationScan.outcome,
            moderationScan.flagged,
            moderationScan.promptVersion,
          ),
      ]);
      return buildModBotStats(reports, scans, input, now);
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
    const loadReports = () =>
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
      });
    const [user, initialReports] = await Promise.all([
      fetchUser(ctx.drizzle, ctx.userId),
      loadReports(),
    ]);
    let allReports = initialReports;
    const activeReport = (status: BanState) =>
      allReports.find(
        (report) =>
          report.status === status && report.banEnd && report.banEnd > new Date(),
      );
    // Parallel reads can straddle registration or moderation. Recheck in the write;
    // a rejected reset reloads the cases so the sanction screen has a current report.
    const noActiveReport = (statuses: BanState[]) =>
      notExists(
        ctx.drizzle
          .select({ id: userReport.id })
          .from(userReport)
          .where(
            and(
              eq(userReport.reportedUserId, ctx.userId),
              inArray(userReport.status, statuses),
              gt(userReport.banEnd, sql`CURRENT_TIMESTAMP(3)`),
            ),
          ),
      );
    const resets = await Promise.all([
      ...(!activeReport("SILENCE_ACTIVATED") &&
      !activeReport("TIMEOUT_ACTIVATED") &&
      !activeReport("BAN_ACTIVATED") &&
      user.isSilenced
        ? [
            ctx.drizzle
              .update(userData)
              .set({ isSilenced: false })
              .where(
                and(
                  eq(userData.userId, ctx.userId),
                  noActiveReport([
                    "SILENCE_ACTIVATED",
                    "TIMEOUT_ACTIVATED",
                    "BAN_ACTIVATED",
                  ]),
                ),
              ),
          ]
        : []),
      ...(!activeReport("BAN_ACTIVATED") && user.isBanned
        ? [
            ctx.drizzle
              .update(userData)
              .set({ isBanned: false })
              .where(
                and(eq(userData.userId, ctx.userId), noActiveReport(["BAN_ACTIVATED"])),
              ),
          ]
        : []),
    ]);
    if (
      resets.some((result) => result.rowsAffected === 0) ||
      allReports.some((report) => !report.reportedUser)
    )
      allReports = await loadReports();
    const warningReport = user.isWarned
      ? allReports.find((report) => report.status === "OFFICIAL_WARNING")
      : null;
    const report =
      warningReport ??
      activeReport("BAN_ACTIVATED") ??
      activeReport("SILENCE_ACTIVATED") ??
      activeReport("TIMEOUT_ACTIVATED") ??
      null;
    if (report && !canSeeSecretData(user.role)) report.reporterUser = null;
    return report;
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
    // Query. A missing report is the same result as one this player cannot read.
    const [user, report] = await Promise.all([
      fetchUser(ctx.drizzle, ctx.userId),
      fetchUserReport(ctx.drizzle, input.id, ctx.userId),
    ]);
    if (!report || !canSeeReport(user, report)) return null;
    // Get previous reports
    const prevReports = canSeeSecretData(user.role)
      ? await getRelatedReports(ctx.drizzle, report.aiInterpretation, {
          excludeReportId: report.id,
        })
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
            return { infraction: forumPostData, context: threadContext };
          }
          case "conversation_comment": {
            const commentData = await ctx.drizzle.query.conversationComment.findFirst({
              where: eq(conversationComment.id, input.system_id),
            });
            const [convoContext, sourceConversation] = await Promise.all([
              getAdditionalContext(
                ctx.drizzle,
                system,
                commentData?.createdAt,
                commentData?.conversationId,
              ),
              commentData?.conversationId
                ? ctx.drizzle.query.conversation.findFirst({
                    columns: { isPublic: true },
                    where: eq(conversation.id, commentData.conversationId),
                  })
                : Promise.resolve(undefined),
            ]);
            return {
              infraction: commentData,
              context: convoContext,
              visibility: sourceConversation
                ? sourceConversation.isPublic
                  ? ("public" as const)
                  : ("private" as const)
                : undefined,
            };
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
      const source = await getInfraction(input.system);
      const { infraction, context } = source;
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
      const evidence = buildModerationEvidence({
        infraction,
        context,
        system: input.system,
        sourceId: input.system_id,
        reportedUserId,
        reporterReason: input.reason,
        visibility: "visibility" in source ? source.visibility : undefined,
      });
      // Save evidence before optional AI enrichment so provider failures cannot lose a human report.
      // Mutate
      const reportId = await insertUserReport(ctx.drizzle, {
        userId: ctx.userId,
        reportedUserId: reportedUserId,
        system: input.system,
        infraction: infraction,
        reason: input.reason,
        aiInterpretation: "",
        predictedStatus: null,
        additionalContext: context,
      });
      if (input.system === "forum_comment") {
        await ctx.drizzle
          .update(forumPost)
          .set({ isReported: true })
          .where(eq(forumPost.id, input.system_id));
      } else if (input.system === "conversation_comment") {
        await ctx.drizzle
          .update(conversationComment)
          .set({ isReported: true })
          .where(eq(conversationComment.id, input.system_id));
      } else if (input.system === "battle_log") {
        await ctx.drizzle
          .update(battleAction)
          .set({ updatedAt: secondsFromNow(72 * 3600) })
          .where(eq(battleAction.id, input.system_id));
      }
      try {
        const prediction = await generateModerationDecision(ctx.drizzle, evidence, {
          excludeReportId: reportId,
        });
        await ctx.drizzle
          .update(userReport)
          .set({
            aiInterpretation: prediction.aiInterpretation,
            predictedStatus: prediction.decision.createReport,
            predictedAt: new Date(),
            predictionModel: OPENAI_MODERATION_MODEL,
            promptVersion: MODERATION_PROMPT_VERSION,
          })
          .where(and(eq(userReport.id, reportId), isNull(userReport.predictedAt)));
      } catch (error) {
        console.error("Could not enrich saved report with AI prediction", error);
      }
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
      if (!report) return errorResponse("Report not found");
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform moderation actions");
      const hasModRights = canModerateReports(user, report);
      if (!hasModRights) return errorResponse("You cannot resolve this report");
      if (!canBanUsers(user)) return errorResponse("You cannot ban users");
      if (!input.banTime || input.banTime <= 0) {
        return errorResponse("Ban time must be specified.");
      }
      const banEnd = getBanEndDate(input);
      // Update
      if (
        !(await updateSanctionReport(ctx.drizzle, report, {
          status: "BAN_ACTIVATED",
          adminResolved: canMarkAdminResolved(user.role),
          banEnd,
        }))
      )
        return errorResponse(
          "Report or account is no longer available for this decision. Please refresh.",
        );
      await Promise.all([
        ...(report.reportedUserId
          ? [
              ctx.drizzle
                .update(userData)
                .set({ isBanned: true, status: "AWAKE", travelFinishAt: null })
                .where(eq(userData.userId, report.reportedUserId)),
            ]
          : []),
        ctx.drizzle.insert(userReportComment).values({
          id: nanoid(),
          userId: ctx.userId,
          reportId: input.object_id,
          content: sanitize(input.comment),
          decision: "BAN_ACTIVATED",
        }),
      ]);
      // An indefinite ban or silence also bans the linked Discord account.
      scheduleDiscordSync(ctx.drizzle, report.reportedUserId);
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
      if (!report) return errorResponse("Report not found");
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform moderation actions");
      const hasModRights = canModerateReports(user, report);
      if (!hasModRights) return errorResponse("You cannot resolve this report");
      if (!canSilenceUsers(user)) return errorResponse("You cannot silence users");
      if (!input.banTime || input.banTime <= 0) {
        return errorResponse("Ban time must be specified.");
      }
      const banEnd = getBanEndDate(input);
      // Update
      if (
        !(await updateSanctionReport(ctx.drizzle, report, {
          status: "SILENCE_ACTIVATED",
          adminResolved: canMarkAdminResolved(user.role),
          banEnd,
        }))
      )
        return errorResponse(
          "Report or account is no longer available for this decision. Please refresh.",
        );
      await Promise.all([
        ...(report.reportedUserId
          ? [
              ctx.drizzle
                .update(userData)
                .set({ isSilenced: true, status: "AWAKE" })
                .where(eq(userData.userId, report.reportedUserId)),
            ]
          : []),
        ctx.drizzle.insert(userReportComment).values({
          id: nanoid(),
          userId: ctx.userId,
          reportId: input.object_id,
          content: sanitize(input.comment),
          decision: "SILENCE_ACTIVATED",
        }),
      ]);
      // An indefinite ban or silence also bans the linked Discord account.
      scheduleDiscordSync(ctx.drizzle, report.reportedUserId);
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
      if (!report) return errorResponse("Report not found");
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform moderation actions");
      const hasModRights = canModerateReports(user, report);
      if (!hasModRights) return errorResponse("You cannot resolve this report");
      if (!canTimeoutUsers(user)) return errorResponse("You cannot timeout users");
      const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
      if (
        !(await updateSanctionReport(ctx.drizzle, report, {
          status: "TIMEOUT_ACTIVATED",
          adminResolved: true,
          banEnd: oneHourFromNow,
        }))
      )
        return errorResponse(
          "Report or account is no longer available for this decision. Please refresh.",
        );
      await Promise.all([
        ...(report.reportedUserId
          ? [
              ctx.drizzle
                .update(userData)
                .set({ isSilenced: true, status: "AWAKE" })
                .where(eq(userData.userId, report.reportedUserId)),
            ]
          : []),
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
      if (!report) return errorResponse("Report not found");
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform moderation actions");
      const hasModRights = canModerateReports(user, report);
      if (!report.reportedUserId) return errorResponse("No user to warn");
      if (!hasModRights) return errorResponse("No permission to warn");
      if (!canWarnUsers(user)) return errorResponse("You cannot warn users");
      // Update
      if (
        !(await updateSanctionReport(ctx.drizzle, report, {
          status: "OFFICIAL_WARNING",
          adminResolved: canMarkAdminResolved(user.role),
          banEnd: null,
        }))
      )
        return errorResponse(
          "Report or account is no longer available for this decision. Please refresh.",
        );
      await Promise.all([
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
      if (!report) return errorResponse("Report not found");
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
      if (!report) return errorResponse("Report not found");
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform moderation actions");
      if (!canClearReport(user, report)) return errorResponse("No permission");
      if (
        !(await updateSanctionReport(ctx.drizzle, report, {
          adminResolved: canMarkAdminResolved(user.role),
          status: "REPORT_CLEARED",
        }))
      )
        return errorResponse(
          "Report or account is no longer available for this decision. Please refresh.",
        );
      const mutations: PromiseLike<unknown>[] = [];
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
        // A character can be recreated after these reads; only reset flags while
        // no current report still enforces that restriction.
        const noActiveReport = (statuses: BanState[]) =>
          notExists(
            ctx.drizzle
              .select({ id: userReport.id })
              .from(userReport)
              .where(
                and(
                  eq(userReport.reportedUserId, reportedUserId),
                  inArray(userReport.status, statuses),
                  gte(userReport.banEnd, sql`CURRENT_TIMESTAMP(3)`),
                ),
              ),
          );
        mutations.push(
          ...(bans.length === 0
            ? [
                ctx.drizzle
                  .update(userData)
                  .set({ isBanned: false })
                  .where(
                    and(
                      eq(userData.userId, reportedUserId),
                      noActiveReport(["BAN_ACTIVATED"]),
                    ),
                  ),
              ]
            : []),
          ...(activeSilenceOrTimeout.length === 0
            ? [
                ctx.drizzle
                  .update(userData)
                  .set({ isSilenced: false })
                  .where(
                    and(
                      eq(userData.userId, reportedUserId),
                      noActiveReport(["SILENCE_ACTIVATED", "TIMEOUT_ACTIVATED"]),
                    ),
                  ),
              ]
            : []),
          ...(activeTradeBans.length === 0
            ? [
                ctx.drizzle
                  .update(userData)
                  .set({ isTradeBanned: false })
                  .where(
                    and(
                      eq(userData.userId, reportedUserId),
                      noActiveReport(["TRADE_BAN_ACTIVATED"]),
                    ),
                  ),
              ]
            : []),
        );
      }
      mutations.push(
        ctx.drizzle.insert(userReportComment).values({
          id: nanoid(),
          userId: ctx.userId,
          reportId: report.id,
          content: sanitize(input.comment),
          decision: "REPORT_CLEARED",
        }),
      );
      await Promise.all(mutations);
      // Lifts the Discord ban once no other indefinite sanction remains.
      scheduleDiscordSync(ctx.drizzle, report.reportedUserId);
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
      if (!report) return errorResponse("Report not found");
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform moderation actions");
      const hasModRights = canModerateReports(user, report);
      if (!hasModRights) return errorResponse("You cannot resolve this report");
      if (!canBanUsers(user)) return errorResponse("You cannot ban users");
      if (!input.banTime || input.banTime <= 0) {
        return errorResponse("Ban time must be specified.");
      }
      // Create a system report for the trade ban
      if (
        !(await updateSanctionReport(ctx.drizzle, report, {
          status: "TRADE_BAN_ACTIVATED",
          adminResolved: canMarkAdminResolved(user.role),
          banEnd: getBanEndDate(input),
        }))
      )
        return errorResponse(
          "Report or account is no longer available for this decision. Please refresh.",
        );
      await Promise.all([
        ...(report.reportedUserId
          ? [
              ctx.drizzle
                .update(userData)
                .set({ isTradeBanned: true })
                .where(eq(userData.userId, report.reportedUserId)),
            ]
          : []),
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
  if (!entry) return null;
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
    predictedStatus: BanState | null;
  },
) => {
  const id = nanoid();
  await client.insert(userReport).values({
    id,
    reporterUserId: info.userId,
    reportedUserId: info.reportedUserId,
    system: info.system,
    infraction: info.infraction,
    aiInterpretation: info.aiInterpretation,
    reason: sanitize(info.reason),
    predictedStatus: info.predictedStatus,
    predictedAt: info.predictedStatus ? new Date() : null,
    predictionModel: info.predictedStatus ? OPENAI_MODERATION_MODEL : null,
    promptVersion: info.predictedStatus ? MODERATION_PROMPT_VERSION : null,
    additionalContext: info.additionalContext,
  });
  return id;
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
