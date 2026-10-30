/**
 * Database access for reports; authorization and transaction scopes stay in callers.
 */
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import {
  type AutomoderationCategory,
  type BanState,
  MODERATION_PROMPT_VERSION,
  OPENAI_MODERATION_MODEL,
  OPENAI_REPORT_EMBEDDING_MODEL,
} from "@/drizzle/constants";
import {
  accountDeletion,
  actionLog,
  automatedModeration,
  battleAction,
  conversation,
  historicalAvatar,
  historicalIp,
  moderationScan,
  reportLog,
  type SanctionTombstone,
  sanctionTombstone,
  storeUserIdAlias,
  userData,
  userReport,
  userReportComment,
  userReportEmbedding,
  userReview,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { DELETED_STORE_USER_PREFIX } from "@/server/utils/purchases/grant";
import sanitize from "@/utils/sanitize";
import { secondsFromNow } from "@/utils/time";
import type { AdditionalContext } from "@/validators/reports";

/** Build the `userReport` listing for `GET`, using predicates on `status` and `banEnd`. */
export const listUserReportForGET = (client: Pick<DrizzleClient, "query">) =>
  client.query.userReport.findMany({
    where: and(
      inArray(userReport.status, [
        "BAN_ACTIVATED",
        "SILENCE_ACTIVATED",
        "TIMEOUT_ACTIVATED",
        "TRADE_BAN_ACTIVATED",
      ]),
      lt(userReport.banEnd, new Date()),
    ),
    with: {
      reportedUser: {
        columns: {
          userId: true,
          isBanned: true,
          isSilenced: true,
          isTradeBanned: true,
        },
      },
    },
  });

/** Build the `userReport` listing for `GET`, using predicates on `reportedUserId`, `status`, `banEnd`. */
export const listUserReportForGET2 = (
  client: Pick<DrizzleClient, "query">,
  bannedUsers: Map<string, boolean>,
  silencedUsers: Map<string, boolean>,
  tradeBannedUsers: Map<string, boolean>,
) =>
  client.query.userReport.findMany({
    where: and(
      inArray(userReport.reportedUserId, [
        ...bannedUsers.keys(),
        ...silencedUsers.keys(),
        ...tradeBannedUsers.keys(),
      ]),
      inArray(userReport.status, [
        "BAN_ACTIVATED",
        "SILENCE_ACTIVATED",
        "TIMEOUT_ACTIVATED",
        "TRADE_BAN_ACTIVATED",
      ]),
      gt(userReport.banEnd, new Date()),
    ),
  });

/** Build the `userData` update for `GET`, setting `isBanned`, using predicates on `userId`. */
export const updateUserDataForGET = (
  client: Pick<DrizzleClient, "update">,
  usersToUnban: string[],
) =>
  client
    .update(userData)
    .set({ isBanned: false })
    .where(inArray(userData.userId, usersToUnban));

/** Build the `userData` update for `GET`, setting `isSilenced`, using predicates on `userId`. */
export const updateUserDataForGET2 = (
  client: Pick<DrizzleClient, "update">,
  usersToUnsilence: string[],
) =>
  client
    .update(userData)
    .set({ isSilenced: false })
    .where(inArray(userData.userId, usersToUnsilence));

/** Build the `userData` update for `GET`, setting `isTradeBanned`, using predicates on `userId`. */
export const updateUserDataForGET3 = (
  client: Pick<DrizzleClient, "update">,
  usersToUntradeBan: string[],
) =>
  client
    .update(userData)
    .set({ isTradeBanned: false })
    .where(inArray(userData.userId, usersToUntradeBan));

/** Build the oldest 50 reports marked needsAiSummary, retaining the summary-input projection and createdAt ordering. */
export const listUserReportForSummaryIndexer = (client: Pick<DrizzleClient, "query">) =>
  client.query.userReport.findMany({
    columns: {
      id: true,
      system: true,
      reportedUserId: true,
      infraction: true,
      additionalContext: true,
    },
    where: eq(userReport.needsAiSummary, true),
    limit: 50,
    orderBy: asc(userReport.createdAt),
  });

/** Build the `userReport` update for `GET`, setting `aiInterpretation`, using predicates on `id` and `aiInterpretation`. */
export const updateUserReportForGET = (
  client: Pick<DrizzleClient, "update">,
  aiInterpretation: string,
  report: { id: string },
) =>
  client
    .update(userReport)
    .set({
      aiInterpretation: aiInterpretation,
    })
    .where(and(eq(userReport.id, report.id), eq(userReport.aiInterpretation, "")));

/** Build the `userData` listing for `GET`, using predicates on `role`. */
export const listUserDataForGET = (client: Pick<DrizzleClient, "query">) =>
  client.query.userData.findMany({
    where: ne(userData.role, "USER"),
  });

/** Build the `userReview` listing for `GET`, using predicates on `createdAt`, `review`, `targetUserId`. */
export const listUserReviewForGET = (
  client: Pick<DrizzleClient, "query">,
  frequency: number,
  user: { userId: string },
) =>
  client.query.userReview.findMany({
    where: and(
      gt(userReview.createdAt, secondsFromNow(-frequency * 60 * 60)),
      ne(userReview.review, ""),
      eq(userReview.targetUserId, user.userId),
    ),
  });

/** Build the `userReportComment` selection for `comment`, using predicates on `reportId`, `id`, `decision`. */
export const selectUserReportCommentForComment = (
  client: Pick<DrizzleClient, "select">,
) =>
  client
    .select({ content: userReportComment.content })
    .from(userReportComment)
    .where(
      and(
        eq(userReportComment.reportId, userReport.id),
        isNotNull(userReportComment.decision),
      ),
    )
    .orderBy(desc(userReportComment.createdAt), desc(userReportComment.id))
    .limit(1);

/** Build the `userReportComment` selection for `eligibleReports`, using predicates on `reportId`, `id`, `decision`. */
export const selectUserReportCommentForEligibleReports = (
  client: Pick<DrizzleClient, "select">,
) =>
  client
    .select({ id: userReportComment.id })
    .from(userReportComment)
    .where(
      and(
        eq(userReportComment.reportId, userReport.id),
        isNotNull(userReportComment.decision),
      ),
    );

/** Build the `userReportEmbedding` selection for `supportsReportVectorSearch`. */
export const selectUserReportEmbeddingForSupportsReportVectorSearch = (
  client: Pick<DrizzleClient, "select">,
) =>
  client
    .select({
      distance: sql<number>`DISTANCE(TO_VECTOR('[1,0]'), TO_VECTOR('[1,0]'), 'cosine')`,
    })
    .from(userReportEmbedding)
    .limit(1);

/**
 * Build the `userReportEmbedding` deletion for `deleteUserReportEmbeddings`, including
 * predicates on `reportId`, `id`, `reporterUserId`.
 */
export const deleteUserReportEmbeddingForDeleteUserReportEmbeddings = (
  client: Pick<DrizzleClient, "delete" | "select">,
  userId: string,
) =>
  client.delete(userReportEmbedding).where(
    inArray(
      userReportEmbedding.reportId,
      client
        .select({ id: userReport.id })
        .from(userReport)
        .where(
          or(
            eq(userReport.reporterUserId, userId),
            eq(userReport.reportedUserId, userId),
          ),
        ),
    ),
  );

/** Build the `userReport` selection for `getRelatedReports`, using the configured predicates. */
export const selectUserReportForGetRelatedReports = (
  client: Pick<DrizzleClient, "select">,
  distance: SQL<number>,
  eligible: undefined | SQL<unknown>,
) =>
  client
    .select({
      ...reportColumns(client),
      score: sql<number>`1 - ${distance}`.mapWith(Number),
    })
    .from(userReport)
    .innerJoin(
      userReportEmbedding,
      and(
        eq(userReportEmbedding.reportId, userReport.id),
        eq(userReportEmbedding.sourceText, userReport.aiInterpretation),
        eq(userReportEmbedding.model, OPENAI_REPORT_EMBEDDING_MODEL),
      ),
    )
    .where(eligible)
    .orderBy(asc(distance), desc(userReport.createdAt), asc(userReport.id))
    .limit(10);

/** Build the `userReport` selection for `getRelatedReports`, using the configured predicates. */
export const selectUserReportForGetRelatedReports2 = (
  client: Pick<DrizzleClient, "select">,
  score: SQL<number>,
  eligible: undefined | SQL<unknown>,
) =>
  client
    .select({ ...reportColumns(client), score })
    .from(userReport)
    .where(and(eligible, sql`${score} > 0`))
    .orderBy(desc(score), desc(userReport.createdAt), asc(userReport.id))
    .limit(10);

/** Build the `userReport` selection for `getRelatedReports`, using the configured predicates. */
export const selectUserReportForGetRelatedReports3 = (
  client: Pick<DrizzleClient, "select">,
  score: SQL<number>,
  eligible: undefined | SQL<unknown>,
  matches: SQL<unknown>[],
) =>
  client
    .select({ ...reportColumns(client), score })
    .from(userReport)
    .where(and(eligible, or(...matches)))
    .orderBy(desc(score), desc(userReport.createdAt), asc(userReport.id))
    .limit(10);

/** Build the `userReport` selection for `deleteOrphanedReportEmbeddings`, using predicates on `id` and `reportId`. */
export const selectUserReportForDeleteOrphanedReportEmbeddings = (
  client: Pick<DrizzleClient, "select">,
) =>
  client
    .select({ id: userReport.id })
    .from(userReport)
    .where(eq(userReport.id, userReportEmbedding.reportId));

/** Build the `userReportEmbedding` selection for `deleteOrphanedReportEmbeddings`, using the configured predicates. */
export const selectUserReportEmbeddingForDeleteOrphanedReportEmbeddings = (
  client: Pick<DrizzleClient, "select">,
  hasNoReport: SQL<unknown>,
) =>
  client
    .select({ reportId: userReportEmbedding.reportId })
    .from(userReportEmbedding)
    .where(hasNoReport);

/** Build the `userReportEmbedding` deletion for `deleteOrphanedReportEmbeddings`, using predicates on `reportId`. */
export const deleteUserReportEmbeddingForDeleteOrphanedReportEmbeddings = (
  client: Pick<DrizzleClient, "delete">,
  batch: Pick<import("@/drizzle/schema").UserReportComment, "reportId">[],
  hasNoReport: SQL<unknown>,
) =>
  client.delete(userReportEmbedding).where(
    and(
      inArray(
        userReportEmbedding.reportId,
        batch.map(({ reportId }) => reportId),
      ),
      // A parent restored since the read must keep its embedding.
      hasNoReport,
    ),
  );

/**
 * Build the `userReport` selection for `indexReportEmbeddings`, including predicates
 * on `reportId`, `sourceText`, `aiInterpretation`.
 */
export const selectUserReportForIndexReportEmbeddings = (
  client: Pick<DrizzleClient, "select">,
  eligible: SQL<unknown> | undefined,
) =>
  client
    .select({ id: userReport.id, text: userReport.aiInterpretation })
    .from(userReport)
    .leftJoin(userReportEmbedding, eq(userReportEmbedding.reportId, userReport.id))
    .where(
      and(
        eligible,
        or(
          isNull(userReportEmbedding.reportId),
          ne(userReportEmbedding.sourceText, userReport.aiInterpretation),
          ne(userReportEmbedding.model, OPENAI_REPORT_EMBEDDING_MODEL),
        ),
      ),
    )
    .orderBy(asc(userReport.createdAt), asc(userReport.id))
    .limit(50);

/**
 * Build the `userReportEmbedding` insert from `userReport` for `indexReportEmbeddings`,
 * using predicates on `id` and `aiInterpretation`, updating duplicate keys.
 */
export const insertUserReportEmbeddingForIndexReportEmbeddings = (
  client: Pick<DrizzleClient, "insert" | "select">,
  embedding: SQL<unknown>,
  report: { id: string; text: string },
) =>
  client
    .insert(userReportEmbedding)
    .select(
      client
        .select({
          reportId: userReport.id,
          sourceText: userReport.aiInterpretation,
          model: sql`${OPENAI_REPORT_EMBEDDING_MODEL}`.as("model"),
          embedding: embedding.as("embedding"),
        })
        .from(userReport)
        .where(
          and(
            eq(userReport.id, report.id),
            eq(userReport.aiInterpretation, report.text),
          ),
        ),
    )
    .onDuplicateKeyUpdate({
      set: {
        sourceText: report.text,
        model: OPENAI_REPORT_EMBEDDING_MODEL,
        embedding,
      },
    });

/** Build report columns, omitting reporterUserId for ordinary viewers and retaining the lazy comment subquery. */
const reportColumns = (client: Pick<DrizzleClient, "select">) => ({
  id: userReport.id,
  createdAt: userReport.createdAt,
  aiInterpretation: userReport.aiInterpretation,
  reason: userReport.reason,
  infraction: userReport.infraction,
  status: userReport.status,
  system: userReport.system,
  predictedStatus: userReport.predictedStatus,
  // A report contributes one precedent, even when it has several comments.
  comment: sql<string>`(${selectUserReportCommentForComment(client)})`,
});

/**
 * Build the report lookup with raw reporter and subject relations. Use fetchUserReport
 * to apply subject-facing reporter redaction.
 */
export const findUserReportWithUsers = (client: DrizzleClient, userReportId: string) =>
  client.query.userReport.findFirst({
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

/** Table alias for reporter user joins, keeping its columns distinct from other participants. */
const reporterUser = alias(userData, "reporterUser");

/** Table alias for reported user joins, keeping its columns distinct from other participants. */
const reportedUser = alias(userData, "reportedUser");

/** Build the `userReport` distinct selection for `getReportSystemNames`. */
export const selectDistinctUserReportForGetReportSystemNames = (
  client: Pick<DrizzleClient, "selectDistinct">,
) => client.selectDistinct({ system: userReport.system }).from(userReport);

/** Build the `userData` selection for `getReportStatistics`, using predicates on `role`. */
export const selectUserDataForGetReportStatistics = (
  client: Pick<DrizzleClient, "select">,
) =>
  client
    .select({
      userId: userData.userId,
      username: userData.username,
      avatar: userData.avatar,
    })
    .from(userData)
    .where(ne(userData.role, "USER"));

/** Build the `userReport` selection for `getReportStatistics`. */
export const selectUserReportForGetReportStatistics = (
  client: Pick<DrizzleClient, "select">,
) =>
  client
    .select({
      userId: userData.userId,
      count: sql`COUNT(${userReport.id})`.mapWith(Number),
    })
    .from(userReport)
    .innerJoin(userData, eq(userData.userId, userReport.reportedUserId))
    .groupBy(sql`${userReport.reportedUserId}`);

/** Build the `userReport` selection for `getReportStatistics`. */
export const selectUserReportForGetReportStatistics2 = (
  client: Pick<DrizzleClient, "select">,
) =>
  client
    .select({
      userId: userData.userId,
      count: sql`COUNT(${userReport.id})`.mapWith(Number),
    })
    .from(userReport)
    .innerJoin(userData, eq(userData.userId, userReport.reporterUserId))
    .groupBy(sql`${userReport.reporterUserId}`);

/** Build the `userReportComment` selection for `getReportStatistics`. */
export const selectUserReportCommentForGetReportStatistics = (
  client: Pick<DrizzleClient, "select">,
) =>
  client
    .select({
      userId: userReportComment.userId,
      count: sql`COUNT(${userReportComment.id})`.mapWith(Number),
      decision: userReportComment.decision,
    })
    .from(userReportComment)
    .groupBy(sql`${userReportComment.userId}, ${userReportComment.decision}`);

/** Build the `userReport` selection for `getModBotPerformance`, using predicates on `createdAt`. */
export const selectUserReportForGetModBotPerformance = (
  client: Pick<DrizzleClient, "select">,
  start: Date,
  now: Date,
) =>
  client
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
    .where(and(gte(userReport.createdAt, start), lte(userReport.createdAt, now)));

/** Build the `moderationScan` selection for `getModBotPerformance`, using predicates on `createdAt`. */
export const selectModerationScanForGetModBotPerformance = (
  client: Pick<DrizzleClient, "select">,
  start: Date,
  now: Date,
) =>
  client
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
      and(gte(moderationScan.createdAt, start), lte(moderationScan.createdAt, now)),
    )
    .groupBy(
      sql`DATE(${moderationScan.createdAt})`,
      moderationScan.relationType,
      moderationScan.outcome,
      moderationScan.flagged,
      moderationScan.promptVersion,
    );

/** Build the `userReport` listing for `getUserReports`, using predicates on `reportedUserId` and `status`. */
export const listUserReportForGetUserReports = (
  client: Pick<DrizzleClient, "query">,
  input: { userId: string },
) =>
  client.query.userReport.findMany({
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
  });

/** Build the `userReport` selection for `getAll`, including predicates on `system`, `createdAt`, `reportedUserId`. */
export const selectUserReportForGetAll = (
  client: Pick<DrizzleClient, "select">,
  staffUser: false | true,
  input: {
    system?: undefined | string;
    startDate?: undefined | Date;
    endDate?: undefined | Date;
    status?: BanState | undefined;
    reportedUser?: undefined | string;
    reporterUser?: undefined | string;
    limit: number;
  },
  ctx: { userId: string },
  timeoutOnlyStaff: false | true,
  skip: number,
) => {
  const { reporterUserId, ...rest } = getTableColumns(userReport);
  return client
    .select({
      UserReport: !staffUser ? { ...rest } : getTableColumns(userReport),
      reportedUser: { ...getTableColumns(reportedUser) },
    })
    .from(userReport)
    .where(
      and(
        ...(input.system !== undefined ? [eq(userReport.system, input.system)] : []),
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
};

/** Build the `userReport` listing for `loadReports`, using predicates on `status` and `reportedUserId`. */
export const listUserReportForLoadReports = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.userReport.findMany({
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

/** Build the `userReport` selection for `noActiveReport`, using predicates on `reportedUserId`, `status`, `banEnd`. */
export const selectUserReportForNoActiveReport = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
  statuses: import("@/drizzle/schema").ReportAction[],
) =>
  client
    .select({ id: userReport.id })
    .from(userReport)
    .where(
      and(
        eq(userReport.reportedUserId, ctx.userId),
        inArray(userReport.status, statuses),
        gt(userReport.banEnd, sql`CURRENT_TIMESTAMP(3)`),
      ),
    );

/** Build the `userData` update for `getBan`, setting `isSilenced`, using predicates on `userId`. */
export const updateUserDataForGetBan = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
  noActiveReport: (statuses: BanState[]) => SQL<unknown>,
) =>
  client
    .update(userData)
    .set({ isSilenced: false })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        noActiveReport(["SILENCE_ACTIVATED", "TIMEOUT_ACTIVATED", "BAN_ACTIVATED"]),
      ),
    );

/** Build the `userData` update for `acceptWarning`, setting `isWarned`, using predicates on `userId`. */
export const updateUserDataForAcceptWarning = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({ isWarned: false })
    .where(eq(userData.userId, ctx.userId));

/** Build the `conversation` lookup for `getInfraction`, selecting only `isPublic`, using predicates on `id`. */
export const findConversationForGetInfraction = (
  client: Pick<DrizzleClient, "query">,
  commentData: { conversationId: string },
) =>
  client.query.conversation.findFirst({
    columns: { isPublic: true },
    where: eq(conversation.id, commentData.conversationId),
  });

/** Build the `battleAction` update for `create`, setting `updatedAt`, using predicates on `id`. */
export const updateBattleActionForCreate = (
  client: Pick<DrizzleClient, "update">,
  input: { system_id: string },
) =>
  client
    .update(battleAction)
    .set({ updatedAt: secondsFromNow(72 * 3600) })
    .where(eq(battleAction.id, input.system_id));

/** Build the `userReport` update for `create`, using predicates on `id` and `predictedAt`. */
export const updateUserReportForCreate = (
  client: Pick<DrizzleClient, "update">,
  prediction: {
    aiInterpretation: string;
    decision: { createReport: import("@/drizzle/schema").ReportAction };
  },
  reportId: string,
) =>
  client
    .update(userReport)
    .set({
      aiInterpretation: prediction.aiInterpretation,
      predictedStatus: prediction.decision.createReport,
      predictedAt: new Date(),
      predictionModel: OPENAI_MODERATION_MODEL,
      promptVersion: MODERATION_PROMPT_VERSION,
    })
    .where(and(eq(userReport.id, reportId), isNull(userReport.predictedAt)));

/** Build the `userData` update for `ban`, using predicates on `userId`. */
export const updateUserDataForBan = (
  client: Pick<DrizzleClient, "update">,
  report: { reportedUserId: string },
) =>
  client
    .update(userData)
    .set({ isBanned: true, status: "AWAKE", travelFinishAt: null })
    .where(eq(userData.userId, report.reportedUserId));

/** Build the `userReportComment` insert for `ban`. */
export const insertUserReportCommentForBan = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { object_id: string; comment: string },
) =>
  client.insert(userReportComment).values({
    id: nanoid(),
    userId: ctx.userId,
    reportId: input.object_id,
    content: sanitize(input.comment),
    decision: "BAN_ACTIVATED",
  });

/** Build the `userData` update for `silence`, setting `isSilenced` and `status`, using predicates on `userId`. */
export const updateUserDataForSilence = (
  client: Pick<DrizzleClient, "update">,
  report: { reportedUserId: string },
) =>
  client
    .update(userData)
    .set({ isSilenced: true, status: "AWAKE" })
    .where(eq(userData.userId, report.reportedUserId));

/** Build the `userReportComment` insert for `silence`. */
export const insertUserReportCommentForSilence = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { object_id: string; comment: string },
) =>
  client.insert(userReportComment).values({
    id: nanoid(),
    userId: ctx.userId,
    reportId: input.object_id,
    content: sanitize(input.comment),
    decision: "SILENCE_ACTIVATED",
  });

/** Build the `userReportComment` insert for `timeout`. */
export const insertUserReportCommentForTimeout = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { object_id: string; comment: string },
) =>
  client.insert(userReportComment).values({
    id: nanoid(),
    userId: ctx.userId,
    reportId: input.object_id,
    content: sanitize(input.comment),
    decision: "TIMEOUT_ACTIVATED",
  });

/** Build the `userData` update for `warn`, setting `isWarned`, using predicates on `userId`. */
export const updateUserDataForWarn = (
  client: Pick<DrizzleClient, "update">,
  report: { reportedUserId: string },
) =>
  client
    .update(userData)
    .set({ isWarned: true })
    .where(eq(userData.userId, report.reportedUserId ?? ""));

/** Build the `userReportComment` insert for `warn`. */
export const insertUserReportCommentForWarn = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { object_id: string; comment: string },
) =>
  client.insert(userReportComment).values({
    id: nanoid(),
    userId: ctx.userId,
    reportId: input.object_id,
    content: sanitize(input.comment),
    decision: "OFFICIAL_WARNING",
  });

/** Build the `userReport` update for `escalate`, setting `status` and `updatedAt`, using predicates on `id`. */
export const updateUserReportForEscalate = (
  client: Pick<DrizzleClient, "update">,
  input: { object_id: string },
) =>
  client
    .update(userReport)
    .set({ status: "BAN_ESCALATED", updatedAt: new Date() })
    .where(eq(userReport.id, input.object_id));

/** Build the `userReportComment` insert for `escalate`. */
export const insertUserReportCommentForEscalate = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { object_id: string; comment: string },
) =>
  client.insert(userReportComment).values({
    id: nanoid(),
    userId: ctx.userId,
    reportId: input.object_id,
    content: sanitize(input.comment),
    decision: "BAN_ESCALATED",
  });

/** Build the `userReport` listing for `clear`, including predicates on `reportedUserId`, `status`, `banEnd`. */
export const listUserReportForClear = (
  client: Pick<DrizzleClient, "query">,
  reportedUserId: string,
  report: { id: string },
) =>
  client.query.userReport.findMany({
    where: and(
      eq(userReport.reportedUserId, reportedUserId),
      eq(userReport.status, "BAN_ACTIVATED"),
      gte(userReport.banEnd, new Date()),
      ne(userReport.id, report.id),
    ),
  });

/** Build the `userReport` listing for `clear`, including predicates on `reportedUserId`, `status`, `banEnd`. */
export const listUserReportForClear2 = (
  client: Pick<DrizzleClient, "query">,
  reportedUserId: string,
  report: { id: string },
) =>
  client.query.userReport.findMany({
    where: and(
      eq(userReport.reportedUserId, reportedUserId),
      inArray(userReport.status, ["SILENCE_ACTIVATED", "TIMEOUT_ACTIVATED"]),
      gte(userReport.banEnd, new Date()),
      ne(userReport.id, report.id),
    ),
  });

/** Build the `userReport` listing for `clear`, including predicates on `reportedUserId`, `status`, `banEnd`. */
export const listUserReportForClear3 = (
  client: Pick<DrizzleClient, "query">,
  reportedUserId: string,
  report: { id: string },
) =>
  client.query.userReport.findMany({
    where: and(
      eq(userReport.reportedUserId, reportedUserId),
      eq(userReport.status, "TRADE_BAN_ACTIVATED"),
      gte(userReport.banEnd, new Date()),
      ne(userReport.id, report.id),
    ),
  });

/** Build the `userReport` selection for `noActiveReport`, using predicates on `reportedUserId`, `status`, `banEnd`. */
export const selectUserReportForNoActiveReport2 = (
  client: Pick<DrizzleClient, "select">,
  reportedUserId: string,
  statuses: import("@/drizzle/schema").ReportAction[],
) =>
  client
    .select({ id: userReport.id })
    .from(userReport)
    .where(
      and(
        eq(userReport.reportedUserId, reportedUserId),
        inArray(userReport.status, statuses),
        gte(userReport.banEnd, sql`CURRENT_TIMESTAMP(3)`),
      ),
    );

/** Build a ban reset guarded by the caller’s active-report predicate. */
export const clearUserBanWithoutActiveReport = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
  noActiveReport: (statuses: BanState[]) => SQL<unknown>,
) =>
  client
    .update(userData)
    .set({ isBanned: false })
    .where(and(eq(userData.userId, userId), noActiveReport(["BAN_ACTIVATED"])));

/** Build the `userData` update for `clear`, setting `isSilenced`, using predicates on `userId`. */
export const updateUserDataForClear2 = (
  client: Pick<DrizzleClient, "update">,
  reportedUserId: string,
  noActiveReport: (statuses: BanState[]) => SQL<unknown>,
) =>
  client
    .update(userData)
    .set({ isSilenced: false })
    .where(
      and(
        eq(userData.userId, reportedUserId),
        noActiveReport(["SILENCE_ACTIVATED", "TIMEOUT_ACTIVATED"]),
      ),
    );

/** Build the `userData` update for `clear`, setting `isTradeBanned`, using predicates on `userId`. */
export const updateUserDataForClear3 = (
  client: Pick<DrizzleClient, "update">,
  reportedUserId: string,
  noActiveReport: (statuses: BanState[]) => SQL<unknown>,
) =>
  client
    .update(userData)
    .set({ isTradeBanned: false })
    .where(
      and(eq(userData.userId, reportedUserId), noActiveReport(["TRADE_BAN_ACTIVATED"])),
    );

/** Build the `userReportComment` insert for `clear`. */
export const insertUserReportCommentForClear = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  report: { id: string },
  input: { comment: string },
) =>
  client.insert(userReportComment).values({
    id: nanoid(),
    userId: ctx.userId,
    reportId: report.id,
    content: sanitize(input.comment),
    decision: "REPORT_CLEARED",
  });

/** Build the `reportLog` insert for `updateUserAvatar`. */
export const insertReportLogForUpdateUserAvatar = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { userId: string },
) =>
  client.insert(reportLog).values({
    id: nanoid(),
    staffUserId: ctx.userId,
    action: "AVATAR_CHANGE",
    targetUserId: input.userId,
  });

/** Build the `userData` update for `updateUserAvatar`, setting `avatar` and `avatarLight`, using predicates on `userId`. */
export const updateUserDataForUpdateUserAvatar = (
  client: Pick<DrizzleClient, "update">,
  avatarUrl: string,
  thumbnailUrl: null | string,
  input: { userId: string },
) =>
  client
    .update(userData)
    .set({ avatar: avatarUrl, avatarLight: thumbnailUrl ?? null })
    .where(eq(userData.userId, input.userId));

/** Build the `historicalAvatar` insert for `updateUserAvatar`. */
export const insertHistoricalAvatarForUpdateUserAvatar = (
  client: Pick<DrizzleClient, "insert">,
  input: { userId: string },
  avatarUrl: string,
  thumbnailUrl: null | string,
) =>
  client.insert(historicalAvatar).values({
    userId: input.userId,
    avatar: avatarUrl,
    avatarLight: thumbnailUrl ?? null,
    status: "success",
    done: true,
  });

/** Build the `reportLog` insert for `clearNindo`. */
export const insertReportLogForClearNindo = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { userId: string },
) =>
  client.insert(reportLog).values({
    id: nanoid(),
    staffUserId: ctx.userId,
    action: "NINDO_CLEARED",
    targetUserId: input.userId,
  });

/** Build the `userReview` listing for `getUserStaffReviews`, using predicates on `authorUserId`. */
export const listUserReviewForGetUserStaffReviews = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.userReview.findMany({
    where: eq(userReview.authorUserId, ctx.userId),
  });

/** Build the `userReview` lookup for `upsertStaffReview`, using predicates on `targetUserId` and `authorUserId`. */
export const findUserReviewForUpsertStaffReview = (
  client: Pick<DrizzleClient, "query">,
  input: { staffUserId: string },
  ctx: { userId: string },
) =>
  client.query.userReview.findFirst({
    where: and(
      eq(userReview.targetUserId, input.staffUserId),
      eq(userReview.authorUserId, ctx.userId),
    ),
  });

/** Build the `userReview` update for `upsertStaffReview`, using predicates on `id`. */
export const updateUserReviewForUpsertStaffReview = (
  client: Pick<DrizzleClient, "update">,
  input: { positive?: undefined | false | true; review: string },
  review: { id: string },
) =>
  client
    .update(userReview)
    .set({
      positive: input.positive,
      review: input.review,
      createdAt: new Date(),
    })
    .where(eq(userReview.id, review.id));

/** Build the `userReview` insert for `upsertStaffReview`. */
export const insertUserReviewForUpsertStaffReview = (
  client: Pick<DrizzleClient, "insert">,
  input: { staffUserId: string; positive?: undefined | false | true; review: string },
  ctx: { userId: string; userIp: string },
) =>
  client.insert(userReview).values({
    id: nanoid(),
    targetUserId: input.staffUserId,
    authorUserId: ctx.userId,
    authorIp: ctx.userIp ?? "unknown",
    positive: input.positive,
    review: input.review,
  });

/** Build the `automatedModeration` selection for `getUserModerationSummary`, using predicates on `userId`. */
export const selectAutomatedModerationForGetUserModerationSummary = (
  client: Pick<DrizzleClient, "select">,
  targetUserId: string,
) =>
  client
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
    .where(eq(automatedModeration.userId, targetUserId));

/** Build the `userData` update for `tradeBan`, setting `isTradeBanned`, using predicates on `userId`. */
export const updateUserDataForTradeBan = (
  client: Pick<DrizzleClient, "update">,
  report: { reportedUserId: string },
) =>
  client
    .update(userData)
    .set({ isTradeBanned: true })
    .where(eq(userData.userId, report.reportedUserId));

/** Build the `userReportComment` insert for `tradeBan`. */
export const insertUserReportCommentForTradeBan = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { object_id: string; comment: string },
) =>
  client.insert(userReportComment).values({
    id: nanoid(),
    userId: ctx.userId,
    reportId: input.object_id,
    content: sanitize(input.comment),
    decision: "TRADE_BAN_ACTIVATED",
  });

/** Build the `userReport` insert for `insertUserReport`. */
export const insertUserReportForInsertUserReport = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
  info: {
    userId: string;
    reportedUserId: string;
    system: string;
    infraction: unknown;
    aiInterpretation: string;
    reason: string;
    predictedStatus: BanState | null;
    additionalContext: AdditionalContext[];
  },
) =>
  client.insert(userReport).values({
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

/** Table alias for captured source joins, keeping its columns distinct from other participants. */
const capturedSource = alias(sanctionTombstone, "capturedSource");

/** Build the `userReport` lookup for `recordSanctionTombstone`, selecting only `id`, using the configured predicates. */
export const findUserReportForRecordSanctionTombstone = (
  client: Pick<DrizzleClient, "query">,

  userId: string,
) =>
  client.query.userReport.findFirst({
    columns: { id: true },
    where: activeSanctionReportsWhere(userId),
  });

/** Build the `userData` lookup for `recordSanctionTombstone`, selecting only `lastIp`, using predicates on `userId`. */
export const findUserDataForRecordSanctionTombstone = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userData.findFirst({
    columns: { lastIp: true },
    where: eq(userData.userId, userId),
  });

/**
 * Build the `sanctionTombstone` insert from `userReport` for `recordSanctionTombstone`,
 * using the configured predicates, updating duplicate keys.
 */
export const insertSanctionTombstoneForRecordSanctionTombstone = (
  client: Pick<DrizzleClient, "insert" | "select">,
  userId: string,
  sanction: SQL<"BAN" | "SILENCE">,
  hashes: { emailHash: null | string; accountHashes: string[] },
) =>
  client
    .insert(sanctionTombstone)
    .select(
      client
        .select({
          userId: sql`${userId}`.as("userId"),
          sourceId: userReport.id,
          sanction: sanction.as("sanction"),
          sanctionEndsAt: userReport.banEnd,
          emailHash: sql`${hashes.emailHash}`.as("emailHash"),
          // INSERT SELECT bypasses column encoders; produce SQL JSON for arrays.
          accountHashes: sql`CAST(${JSON.stringify(hashes.accountHashes)} AS JSON)`.as(
            "accountHashes",
          ),
          ipHashes: sql`JSON_ARRAY()`.as("ipHashes"),
          carryoverReportIds: sql`JSON_ARRAY()`.as("carryoverReportIds"),
          createdAt: sql`CURRENT_TIMESTAMP(3)`.as("createdAt"),
        })
        .from(userReport)
        .where(activeSanctionReportsWhere(userId)),
    )
    .onDuplicateKeyUpdate({
      set: {
        emailHash: hashes.emailHash,
        accountHashes: hashes.accountHashes,
      },
    });

/** Build the `historicalIp` listing for `recordSanctionTombstone`, selecting only `ip`, using predicates on `userId`. */
export const listHistoricalIpForRecordSanctionTombstone = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.historicalIp.findMany({
    columns: { ip: true },
    where: eq(historicalIp.userId, userId),
  });

/**
 * Build the `sanctionTombstone` update for `retainSanctionIps`, setting `ipHashes`,
 * using predicates on `userId` and `sanctionEndsAt`.
 */
export const updateSanctionTombstoneForRetainSanctionIps = (
  client: Pick<DrizzleClient, "update">,
  hashes: string[],
  userId: string,
) =>
  client
    .update(sanctionTombstone)
    .set({
      ipHashes: sql`JSON_MERGE_PRESERVE(${sanctionTombstone.ipHashes}, ${sql.join(
        hashes.map(
          (hash) =>
            sql`IF(JSON_CONTAINS(${sanctionTombstone.ipHashes}, JSON_QUOTE(${hash})), JSON_ARRAY(), JSON_ARRAY(${hash}))`,
        ),
        sql`, `,
      )})`,
    })
    .where(
      and(
        eq(sanctionTombstone.userId, userId),
        gt(sanctionTombstone.sanctionEndsAt, sql`CURRENT_TIMESTAMP(3)`),
      ),
    );

/** Unexpired tombstones; registration matches them in memory. */
export const fetchActiveSanctionTombstones = (client: DrizzleClient) =>
  client.query.sanctionTombstone.findMany({
    where: gt(sanctionTombstone.sanctionEndsAt, new Date()),
  });

/**
 * Build the `sanctionTombstone` update for `discardUnpublishedSanctions`, setting
 * `carryoverReportIds`, using predicates on `carryoverReportIds`.
 */
export const updateSanctionTombstoneForDiscardUnpublishedSanctions = (
  client: Pick<DrizzleClient, "update">,
  reportId: string,
  accountAbsent: (userId: string) => SQL<unknown>,
  userId: string,
) =>
  client
    .update(sanctionTombstone)
    .set({
      carryoverReportIds: sql`JSON_REMOVE(${sanctionTombstone.carryoverReportIds}, JSON_UNQUOTE(JSON_SEARCH(${sanctionTombstone.carryoverReportIds}, 'one', ${reportId})))`,
    })
    .where(
      and(
        accountAbsent(userId),
        sql`JSON_CONTAINS(${sanctionTombstone.carryoverReportIds}, JSON_QUOTE(${reportId}))`,
      ),
    );

/** Execute the database statement for `discardUnpublishedSanctions`. */
export const executeRowsForDiscardUnpublishedSanctions = (
  client: Pick<DrizzleClient, "execute">,
  userId: string,
  reportIds: string[],
  accountAbsent: (userId: string) => SQL<unknown>,
) =>
  client.execute(sql`
    DELETE ${userReport}, ${userReportComment}, ${actionLog} FROM ${userReport}
    LEFT JOIN ${userReportComment} ON ${eq(userReportComment.reportId, userReport.id)}
    LEFT JOIN ${actionLog} ON ${and(eq(actionLog.relatedId, userReport.id), eq(actionLog.tableName, "userReport"), eq(actionLog.userId, userId))}
    WHERE ${and(eq(userReport.reportedUserId, userId), eq(userReport.system, "sanction_carryover"), inArray(userReport.id, reportIds), accountAbsent(userId))}
  `);

/** Execute the database statement for `insertRecord`. */
export const executeRowsForInsertRecord = (
  client: Pick<DrizzleClient, "execute">,
  table: typeof userReport | typeof userReportComment | typeof actionLog,
  values: Record<string, unknown>,
  guard: undefined | SQL<unknown>,
) => {
  const columns = getTableColumns(table);
  const keys = Object.keys(values) as (keyof typeof columns)[];
  return client.execute(sql`
      INSERT INTO ${table} (${sql.join(
        keys.map((key) => sql.identifier(columns[key].name)),
        sql`, `,
      )})
      SELECT ${sql.join(
        keys.map((key) => sql.param(values[key], columns[key])),
        sql`, `,
      )}
      WHERE ${guard}
      ON DUPLICATE KEY UPDATE id = id
    `);
};

/**
 * Build the `sanctionTombstone` update for `reapplySanctions`, setting
 * `carryoverReportIds`, using predicates on `carryoverReportIds`.
 */
export const updateSanctionTombstoneForReapplySanctions = (
  client: Pick<DrizzleClient, "update">,
  reportId: string,
  accountAbsent: (userId: string) => SQL<unknown>,
  userId: string,
  reportExists: SQL<unknown>,
  match: { tombstones: import("@/drizzle/schema").SanctionTombstone[] },
  unchangedSource: (source: SanctionTombstone) => SQL<unknown> | undefined,
) =>
  client
    .update(sanctionTombstone)
    .set({
      carryoverReportIds: sql`JSON_ARRAY_APPEND(${sanctionTombstone.carryoverReportIds}, '$', ${reportId})`,
    })
    .where(
      and(
        accountAbsent(userId),
        reportExists,
        or(...match.tombstones.map(unchangedSource)),
        sql`NOT JSON_CONTAINS(${sanctionTombstone.carryoverReportIds}, JSON_QUOTE(${reportId}))`,
      ),
    );

/** Execute the database statement for `updateSanctionReport`. */
export const executeResultForUpdateSanctionReport = (
  client: Pick<DrizzleClient, "execute">,
  sources: undefined | SQL<unknown>,
  decision: {
    status: import("@/drizzle/schema").ReportAction;
    adminResolved: false | true;
    banEnd?: undefined | null | Date;
  },
  activeEnd: undefined | null | Date,
  sanction: "BAN" | "SILENCE",
  endsAt: Date,
  report: { id: string },
) =>
  client.execute(sql`
    UPDATE ${userReport}
    LEFT JOIN ${sanctionTombstone} ON ${sources}
    LEFT JOIN ${accountDeletion} ON ${and(eq(accountDeletion.userId, userReport.reportedUserId), ne(accountDeletion.phase, "COMPLETE"))}
    LEFT JOIN ${storeUserIdAlias} ON ${and(eq(storeUserIdAlias.oldUserId, userReport.reportedUserId), sql`LEFT(${storeUserIdAlias.newUserId}, ${DELETED_STORE_USER_PREFIX.length}) = BINARY ${DELETED_STORE_USER_PREFIX}`)}
    LEFT JOIN ${sanctionTombstone} capturedSource ON ${and(eq(capturedSource.userId, userReport.reportedUserId), eq(capturedSource.sourceId, userReport.id))}
    SET ${userReport.status} = ${decision.status},
        ${userReport.adminResolved} = ${decision.adminResolved},
        ${userReport.updatedAt} = CURRENT_TIMESTAMP(3),
        ${decision.banEnd !== undefined ? sql`${userReport.banEnd} = ${sql.param(decision.banEnd, userReport.banEnd)},` : sql``}
        ${sanctionTombstone.sanction} = ${activeEnd ? sql`${sanction}` : sanctionTombstone.sanction},
        ${sanctionTombstone.sanctionEndsAt} = ${sql.param(endsAt, sanctionTombstone.sanctionEndsAt)}
    WHERE ${and(eq(userReport.id, report.id), ne(userReport.status, "REPORT_CLEARED"), activeEnd ? or(and(isNull(accountDeletion.userId), isNull(storeUserIdAlias.oldUserId)), isNotNull(capturedSource.sourceId)) : undefined)}
  `);

/** Execute the database statement for `removeExpiredSanctionTombstones`. */
export const executeRowsForRemoveExpiredSanctionTombstones = (
  client: Pick<DrizzleClient, "execute">,
  expired: undefined | SQL<unknown>,
) =>
  client.execute(sql`
      UPDATE ${userReport}
      INNER JOIN ${sanctionTombstone} ON ${and(eq(userReport.id, sanctionTombstone.sourceId), eq(userReport.reportedUserId, sanctionTombstone.userId))}
      SET ${userReport.status} = 'REPORT_CLEARED', ${userReport.adminResolved} = TRUE, ${userReport.updatedAt} = CURRENT_TIMESTAMP(3)
      WHERE ${and(expired, inArray(userReport.status, ["BAN_ACTIVATED", "SILENCE_ACTIVATED", "TIMEOUT_ACTIVATED"]), gt(userReport.banEnd, sql`CURRENT_TIMESTAMP(3)`))}
    `);

/** Build the `sanctionTombstone` deletion for `removeExpiredSanctionTombstones`, using the configured predicates. */
export const deleteSanctionTombstoneForRemoveExpiredSanctionTombstones = (
  client: Pick<DrizzleClient, "delete">,
  expired: undefined | SQL<unknown>,
) => client.delete(sanctionTombstone).where(expired);

/** Current bans and silences, including timeouts, at both preflight and persistence. */
const activeSanctionReportsWhere = (userId: string) =>
  and(
    eq(userReport.reportedUserId, userId),
    inArray(userReport.status, [
      "BAN_ACTIVATED",
      "SILENCE_ACTIVATED",
      "TIMEOUT_ACTIVATED",
    ]),
    gt(userReport.banEnd, new Date()),
  );
