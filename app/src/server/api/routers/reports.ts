import { notExists } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { BanState } from "@/drizzle/constants";
import { getForumContext, resolveForumPost } from "@/libs/forum";
import { buildModerationEvidence } from "@/libs/moderation/evidence";
import { getRelatedReports } from "@/libs/moderation/reportSearch";
import { buildModBotStats } from "@/libs/moderation/stats";
import { generateModerationDecision, getAdditionalContext } from "@/libs/moderator";
import { getServerPusher } from "@/libs/pusher";
import { findConversationCommentById } from "@/queries/comments";
import { fetchImage } from "@/queries/conceptart";
import { findForumPost } from "@/queries/forum";
import {
  markConversationCommentReported,
  markForumPostReported,
} from "@/queries/moderator";
import { deleteUserNindo, fetchUser } from "@/queries/profile";
import {
  clearUserBanWithoutActiveReport,
  findConversationForGetInfraction,
  findUserReviewForUpsertStaffReview,
  insertHistoricalAvatarForUpdateUserAvatar,
  insertReportLogForClearNindo,
  insertReportLogForUpdateUserAvatar,
  insertUserReportCommentForBan,
  insertUserReportCommentForClear,
  insertUserReportCommentForEscalate,
  insertUserReportCommentForSilence,
  insertUserReportCommentForTimeout,
  insertUserReportCommentForTradeBan,
  insertUserReportCommentForWarn,
  insertUserReportForInsertUserReport,
  insertUserReviewForUpsertStaffReview,
  listUserReportForClear,
  listUserReportForClear2,
  listUserReportForClear3,
  listUserReportForGetUserReports,
  listUserReportForLoadReports,
  listUserReviewForGetUserStaffReviews,
  selectAutomatedModerationForGetUserModerationSummary,
  selectDistinctUserReportForGetReportSystemNames,
  selectModerationScanForGetModBotPerformance,
  selectUserDataForGetReportStatistics,
  selectUserReportCommentForGetReportStatistics,
  selectUserReportForGetAll,
  selectUserReportForGetModBotPerformance,
  selectUserReportForGetReportStatistics,
  selectUserReportForGetReportStatistics2,
  selectUserReportForNoActiveReport,
  selectUserReportForNoActiveReport2,
  updateBattleActionForCreate,
  updateUserDataForAcceptWarning,
  updateUserDataForBan,
  updateUserDataForClear2,
  updateUserDataForClear3,
  updateUserDataForGetBan,
  updateUserDataForSilence,
  updateUserDataForTradeBan,
  updateUserDataForUpdateUserAvatar,
  updateUserDataForWarn,
  updateUserReportForCreate,
  updateUserReportForEscalate,
  updateUserReviewForUpsertStaffReview,
} from "@/queries/reports";
import { createUserAvatar } from "@/routers/avatar";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  serverError,
} from "@/server/api/trpc";
import { scheduleDiscordSync } from "@/server/utils/discord/sync";
import { fetchUserReport } from "@/server/utils/reports";
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
import { getMillisecondsFromTimeUnit, getUtcDayWindowStart } from "@/utils/time";
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

const pusher = getServerPusher();

export const reportsRouter = createTRPCRouter({
  getReportSystemNames: protectedProcedure.query(async ({ ctx }) => {
    return await selectDistinctUserReportForGetReportSystemNames(ctx.drizzle);
  }),
  getReportStatistics: protectedProcedure.query(async ({ ctx }) => {
    const [user, staff, timesReported, timesReporting, decisions] = await Promise.all([
      fetchUser(ctx.drizzle, ctx.userId),
      await selectUserDataForGetReportStatistics(ctx.drizzle),
      await selectUserReportForGetReportStatistics(ctx.drizzle),
      await selectUserReportForGetReportStatistics2(ctx.drizzle),
      await selectUserReportCommentForGetReportStatistics(ctx.drizzle),
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
        selectUserReportForGetModBotPerformance(ctx.drizzle, start, now),
        selectModerationScanForGetModBotPerformance(ctx.drizzle, start, now),
      ]);
      return buildModBotStats(reports, scans, input, now);
    }),
  getUserReports: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Query
      const [user, reports] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        listUserReportForGetUserReports(ctx.drizzle, input),
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

      const staffUser = canModerateRoles.includes(user.role);
      const timeoutOnlyStaff = canTimeoutUsers(user);
      const reports = await selectUserReportForGetAll(
        ctx.drizzle,
        staffUser,
        input,
        ctx,
        timeoutOnlyStaff,
        skip,
      );

      const nextCursor = reports.length < input.limit ? null : currentCursor + 1;
      return {
        data: reports,
        nextCursor: nextCursor,
      };
    }),
  // Get user report
  getBan: protectedProcedure.query(async ({ ctx }) => {
    const loadReports = () => listUserReportForLoadReports(ctx.drizzle, ctx);
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
      notExists(selectUserReportForNoActiveReport(ctx.drizzle, ctx, statuses));
    const resets = await Promise.all([
      ...(!activeReport("SILENCE_ACTIVATED") &&
      !activeReport("TIMEOUT_ACTIVATED") &&
      !activeReport("BAN_ACTIVATED") &&
      user.isSilenced
        ? [updateUserDataForGetBan(ctx.drizzle, ctx, noActiveReport)]
        : []),
      ...(!activeReport("BAN_ACTIVATED") && user.isBanned
        ? [clearUserBanWithoutActiveReport(ctx.drizzle, ctx.userId, noActiveReport)]
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
      await updateUserDataForAcceptWarning(ctx.drizzle, ctx);
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
            // Authorize the current destination before including post content or nearby evidence.
            const forumAccess = await getForumContext(ctx.drizzle, ctx.userId);
            const readable = await resolveForumPost(
              ctx.drizzle,
              input.system_id,
              forumAccess,
            );
            if (!readable) return { infraction: undefined, context: [] };
            const forumPostData = await findForumPost(ctx.drizzle, input.system_id);
            if (
              !forumPostData ||
              forumPostData.threadId !== readable.threadId ||
              forumPostData.deletedAt ||
              !forumPostData.isApproved
            )
              return { infraction: undefined, context: [] };
            const threadContext = await getAdditionalContext(
              ctx.drizzle,
              system,
              forumPostData?.createdAt,
              readable.threadId,
            );
            return { infraction: forumPostData, context: threadContext };
          }
          case "conversation_comment": {
            const commentData = await findConversationCommentById(
              ctx.drizzle,
              input.system_id,
            );
            const [convoContext, sourceConversation] = await Promise.all([
              getAdditionalContext(
                ctx.drizzle,
                system,
                commentData?.createdAt,
                commentData?.conversationId,
              ),
              commentData?.conversationId
                ? findConversationForGetInfraction(ctx.drizzle, {
                    conversationId: commentData.conversationId,
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
        await markForumPostReported(ctx.drizzle, input.system_id);
      } else if (input.system === "conversation_comment") {
        await markConversationCommentReported(ctx.drizzle, input.system_id);
      } else if (input.system === "battle_log") {
        await updateBattleActionForCreate(ctx.drizzle, input);
      }
      try {
        const prediction = await generateModerationDecision(ctx.drizzle, evidence, {
          excludeReportId: reportId,
        });
        await updateUserReportForCreate(ctx.drizzle, prediction, reportId);
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
              updateUserDataForBan(ctx.drizzle, {
                reportedUserId: report.reportedUserId,
              }),
            ]
          : []),
        insertUserReportCommentForBan(ctx.drizzle, ctx, input),
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
              updateUserDataForSilence(ctx.drizzle, {
                reportedUserId: report.reportedUserId,
              }),
            ]
          : []),
        insertUserReportCommentForSilence(ctx.drizzle, ctx, input),
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
              updateUserDataForSilence(ctx.drizzle, {
                reportedUserId: report.reportedUserId,
              }),
            ]
          : []),
        insertUserReportCommentForTimeout(ctx.drizzle, ctx, input),
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
        updateUserDataForWarn(ctx.drizzle, { reportedUserId: report.reportedUserId }),
        insertUserReportCommentForWarn(ctx.drizzle, ctx, input),
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
        updateUserReportForEscalate(ctx.drizzle, input),
        insertUserReportCommentForEscalate(ctx.drizzle, ctx, input),
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
          listUserReportForClear(ctx.drizzle, reportedUserId, report),
          listUserReportForClear2(ctx.drizzle, reportedUserId, report),
          listUserReportForClear3(ctx.drizzle, reportedUserId, report),
        ]);
        // A character can be recreated after these reads; only reset flags while
        // no current report still enforces that restriction.
        const noActiveReport = (statuses: BanState[]) =>
          notExists(
            selectUserReportForNoActiveReport2(ctx.drizzle, reportedUserId, statuses),
          );
        mutations.push(
          ...(bans.length === 0
            ? [
                clearUserBanWithoutActiveReport(
                  ctx.drizzle,
                  reportedUserId,
                  noActiveReport,
                ),
              ]
            : []),
          ...(activeSilenceOrTimeout.length === 0
            ? [updateUserDataForClear2(ctx.drizzle, reportedUserId, noActiveReport)]
            : []),
          ...(activeTradeBans.length === 0
            ? [updateUserDataForClear3(ctx.drizzle, reportedUserId, noActiveReport)]
            : []),
        );
      }
      mutations.push(insertUserReportCommentForClear(ctx.drizzle, ctx, report, input));
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
        insertReportLogForUpdateUserAvatar(ctx.drizzle, ctx, input),
        updateUserDataForUpdateUserAvatar(ctx.drizzle, avatarUrl, thumbnailUrl, input),
        insertHistoricalAvatarForUpdateUserAvatar(
          ctx.drizzle,
          input,
          avatarUrl,
          thumbnailUrl,
        ),
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
        insertReportLogForClearNindo(ctx.drizzle, ctx, input),
        deleteUserNindo(ctx.drizzle, target.userId),
      ]);
      return { success: true, message: "Nindo cleared" };
    }),
  getUserStaffReviews: protectedProcedure.query(async ({ ctx }) => {
    return await listUserReviewForGetUserStaffReviews(ctx.drizzle, ctx);
  }),
  upsertStaffReview: protectedProcedure
    .input(userReviewSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, target, review] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.staffUserId),
        findUserReviewForUpsertStaffReview(ctx.drizzle, input, ctx),
      ]);
      // Guard
      if (user.isBanned) return errorResponse("You are banned and cannot post reviews");
      if (target.role === "USER") return errorResponse("You cannot review users");
      // Mutate
      if (review) {
        await updateUserReviewForUpsertStaffReview(ctx.drizzle, input, review);
        return { success: true, message: "Staff review updated" };
      } else {
        await insertUserReviewForUpsertStaffReview(ctx.drizzle, input, ctx);
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
        selectAutomatedModerationForGetUserModerationSummary(ctx.drizzle, targetUserId),
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
              updateUserDataForTradeBan(ctx.drizzle, {
                reportedUserId: report.reportedUserId,
              }),
            ]
          : []),
        insertUserReportCommentForTradeBan(ctx.drizzle, ctx, input),
      ]);
      return { success: true, message: "User trade banned" };
    }),
});

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
  await insertUserReportForInsertUserReport(client, id, info);
  return id;
};
