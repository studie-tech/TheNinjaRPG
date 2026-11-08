import { gt } from "drizzle-orm";
import { z } from "zod";
import {
  ActiveBanStates,
  ActiveSilenceStates,
  type BanState,
  BanStates,
  REPORT_TIMEOUT_HOURS,
} from "@/drizzle/constants";
import type { UserReport } from "@/drizzle/schema";
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
  clearUserSilenceWithoutActiveReport,
  clearUserTradeBanWithoutActiveReport,
  findConversationForGetInfraction,
  findUserReviewForUpsertStaffReview,
  insertHistoricalAvatarForUpdateUserAvatar,
  insertReportLogForClearNindo,
  insertReportLogForUpdateUserAvatar,
  insertUserReport,
  insertUserReportDecisionComment,
  insertUserReviewForUpsertStaffReview,
  listUserReportForGetUserReports,
  listUserReportForLoadReports,
  listUserReviewForGetUserStaffReviews,
  noActiveReportGuard,
  selectAutomatedModerationForGetUserModerationSummary,
  selectDistinctUserReportForGetReportSystemNames,
  selectModerationScanForGetModBotPerformance,
  selectUserDataForGetReportStatistics,
  selectUserReportCommentForGetReportStatistics,
  selectUserReportForGetAll,
  selectUserReportForGetModBotPerformance,
  selectUserReportForGetReportStatistics,
  selectUserReportForGetReportStatistics2,
  updateBattleActionForCreate,
  updateUserDataForAcceptWarning,
  updateUserDataForBan,
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
import type { DrizzleClient } from "@/server/db";
import { scheduleDiscordSync } from "@/server/utils/discord/sync";
import { offsetPage } from "@/server/utils/pagination";
import { fetchUserReport } from "@/server/utils/reports";
import { updateSanctionReport } from "@/server/utils/sanctionTombstone";
import {
  canBanUsers,
  canClearReport,
  canClearUserNindo,
  canEscalateBan,
  canMarkAdminResolved,
  canModerate,
  canModerateReports,
  canSeeReport,
  canSeeSecretData,
  canSilenceUsers,
  canTimeoutUsers,
  canWarnUsers,
  isStaffRole,
} from "@/utils/permissions";
import {
  getMillisecondsFromTimeUnit,
  getUtcDayWindowStart,
  HOUR_S,
  secondsFromNow,
} from "@/utils/time";
import { idSchema } from "@/validators/misc";
import type { ReportCommentSchema } from "@/validators/reports";
import {
  modBotPerformanceSchema,
  reportCommentSchema,
  userReportSchema,
  userReviewSchema,
} from "@/validators/reports";

const reportTimeoutSchema = z.object({
  comment: z.string().min(10).max(5000),
  object_id: z.string(),
});

const reportFilteringSchema = z.object({
  reportedUser: z.string().optional(),
  reporterUser: z.string().optional(),
  status: z.enum(BanStates).optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  system: z.string().optional(),
});

const pusher = getServerPusher();
const SANCTION_UNAVAILABLE_MESSAGE =
  "Report or account is no longer available for this decision. Please refresh.";

export const reportsRouter = createTRPCRouter({
  getReportSystemNames: protectedProcedure.query(async ({ ctx }) => {
    return await selectDistinctUserReportForGetReportSystemNames(ctx.drizzle);
  }),
  getReportStatistics: protectedProcedure.query(async ({ ctx }) => {
    // The aggregates scan whole tables, so they run only after the staff check
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    if (!isStaffRole(user.role)) {
      throw serverError("UNAUTHORIZED", "You cannot view this page");
    }
    const [staff, timesReported, timesReporting, decisions] = await Promise.all([
      selectUserDataForGetReportStatistics(ctx.drizzle),
      selectUserReportForGetReportStatistics(ctx.drizzle),
      selectUserReportForGetReportStatistics2(ctx.drizzle),
      selectUserReportCommentForGetReportStatistics(ctx.drizzle),
    ]);
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
      const { skip, cursorAfter } = offsetPage(input);
      const user = await fetchUser(ctx.drizzle, ctx.userId);

      const staffUser = canModerate(user.role);
      const timeoutOnlyStaff = canTimeoutUsers(user);
      const reports = await selectUserReportForGetAll(
        ctx.drizzle,
        staffUser,
        input,
        ctx,
        timeoutOnlyStaff,
        skip,
      );

      const nextCursor = cursorAfter(reports);
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
    const activeReport = (...statuses: BanState[]) =>
      allReports.find(
        (report) =>
          statuses.includes(report.status) &&
          report.banEnd &&
          report.banEnd > new Date(),
      );
    // Parallel reads can straddle registration or moderation. Recheck in the write;
    // a rejected reset reloads the cases so the sanction screen has a current report.
    const noActiveReport = noActiveReportGuard(ctx.drizzle, ctx.userId, gt);
    const resets = await Promise.all([
      ...(!activeReport(...ActiveSilenceStates) && user.isSilenced
        ? [
            clearUserSilenceWithoutActiveReport(
              ctx.drizzle,
              [ctx.userId],
              noActiveReport,
            ),
          ]
        : []),
      ...(!activeReport(...ActiveBanStates) && user.isBanned
        ? [clearUserBanWithoutActiveReport(ctx.drizzle, [ctx.userId], noActiveReport)]
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
      activeReport(...ActiveBanStates) ??
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
                content: `<br /><a href="/battlelog/${input.system_id}"><b>Link to Battle Log (available for 72h)</b></a>`,
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
      const applied = await applySanction(
        ctx,
        report,
        input,
        {
          status: "BAN_ACTIVATED",
          adminResolved: canMarkAdminResolved(user.role),
          banEnd,
        },
        updateUserDataForBan,
      );
      if (!applied) return errorResponse(SANCTION_UNAVAILABLE_MESSAGE);
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
      const applied = await applySanction(
        ctx,
        report,
        input,
        {
          status: "SILENCE_ACTIVATED",
          adminResolved: canMarkAdminResolved(user.role),
          banEnd,
        },
        updateUserDataForSilence,
      );
      if (!applied) return errorResponse(SANCTION_UNAVAILABLE_MESSAGE);
      // An indefinite ban or silence also bans the linked Discord account.
      scheduleDiscordSync(ctx.drizzle, report.reportedUserId);
      return { success: true, message: "User silenced" };
    }),
  // Timeout: timed silence. CONTENT-ADMIN and EVENT-ADMIN only.
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
      const timeoutEnd = secondsFromNow(REPORT_TIMEOUT_HOURS * HOUR_S);
      const applied = await applySanction(
        ctx,
        report,
        input,
        {
          status: "TIMEOUT_ACTIVATED",
          adminResolved: true,
          banEnd: timeoutEnd,
        },
        updateUserDataForSilence,
      );
      if (!applied) return errorResponse(SANCTION_UNAVAILABLE_MESSAGE);
      return {
        success: true,
        message: `User timed out (${REPORT_TIMEOUT_HOURS} hour)`,
      };
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
      const applied = await applySanction(
        ctx,
        report,
        input,
        {
          status: "OFFICIAL_WARNING",
          adminResolved: canMarkAdminResolved(user.role),
          banEnd: null,
        },
        updateUserDataForWarn,
      );
      if (!applied) return errorResponse(SANCTION_UNAVAILABLE_MESSAGE);
      void pusher.trigger(report.reportedUserId, "event", {
        type: "userMessage",
        message: `You have been given a warning`,
        route: "/reports",
        routeText: "To Report",
      });
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
      // Guard. Only the banned user can escalate their own ban, so the banned-moderator
      // guard of the other procedures does not apply here.
      if (!report) return errorResponse("Report not found");
      if (!canEscalateBan(user, report)) return errorResponse("You cannot escalate");
      // Update
      const escalated = await updateUserReportForEscalate(ctx.drizzle, report, ctx);
      if (escalated.rowsAffected === 0) {
        return errorResponse("Report changed. Refresh and try again");
      }
      await insertUserReportDecisionComment(ctx.drizzle, ctx, {
        reportId: input.object_id,
        comment: input.comment,
        decision: "BAN_ESCALATED",
      });
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
        return errorResponse(SANCTION_UNAVAILABLE_MESSAGE);
      const mutations: PromiseLike<unknown>[] = [];
      // If someone was reported
      if (report.reportedUserId) {
        const targetIds = [report.reportedUserId];
        // Each reset applies only while no current report enforces that restriction.
        const noActiveReport = noActiveReportGuard(
          ctx.drizzle,
          report.reportedUserId,
          gt,
        );
        mutations.push(
          clearUserBanWithoutActiveReport(ctx.drizzle, targetIds, noActiveReport),
          clearUserSilenceWithoutActiveReport(ctx.drizzle, targetIds, noActiveReport),
          clearUserTradeBanWithoutActiveReport(ctx.drizzle, targetIds, noActiveReport),
        );
      }
      mutations.push(
        insertUserReportDecisionComment(ctx.drizzle, ctx, {
          reportId: report.id,
          comment: input.comment,
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
      if (!canClearUserNindo(user))
        return errorResponse("You cannot regenerate avatars");
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
      if (!isStaffRole(target.role)) return errorResponse("You cannot review users");
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
      const applied = await applySanction(
        ctx,
        report,
        input,
        {
          status: "TRADE_BAN_ACTIVATED",
          adminResolved: canMarkAdminResolved(user.role),
          banEnd: getBanEndDate(input),
        },
        updateUserDataForTradeBan,
      );
      if (!applied) return errorResponse(SANCTION_UNAVAILABLE_MESSAGE);
      return { success: true, message: "User trade banned" };
    }),
});

/** Records a decision on the report and its author, then applies it to the reported user. */
const applySanction = async (
  ctx: { drizzle: DrizzleClient; userId: string },
  report: Pick<UserReport, "id" | "reportedUserId">,
  input: { object_id: string; comment: string },
  decision: Pick<UserReport, "status" | "adminResolved"> & { banEnd: Date | null },
  flagUser: (
    client: DrizzleClient,
    target: { reportedUserId: string },
  ) => PromiseLike<unknown>,
) => {
  if (!(await updateSanctionReport(ctx.drizzle, report, decision))) return false;
  await Promise.all([
    ...(report.reportedUserId
      ? [flagUser(ctx.drizzle, { reportedUserId: report.reportedUserId })]
      : []),
    insertUserReportDecisionComment(ctx.drizzle, ctx, {
      reportId: input.object_id,
      comment: input.comment,
      decision: decision.status,
    }),
  ]);
  return true;
};

export const getBanEndDate = (input: ReportCommentSchema) => {
  return input.banTime !== undefined && input.banTimeUnit !== undefined
    ? new Date(
        Date.now() + input.banTime * getMillisecondsFromTimeUnit(input.banTimeUnit),
      )
    : null;
};
