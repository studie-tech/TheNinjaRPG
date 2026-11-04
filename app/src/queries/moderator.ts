/**
 * Database access for moderator; authorization and transaction scopes stay in callers.
 */
import { and, desc, eq, isNull, lt, ne } from "drizzle-orm";
import type { Moderation } from "openai/resources/moderations";
import type { AutomoderationCategory } from "@/drizzle/constants";
import {
  MODERATION_PROMPT_VERSION,
  OPENAI_MODERATION_MODEL,
  REPORT_CONTEXT_WINDOW,
} from "@/drizzle/constants";
import {
  conversationComment,
  forumPost,
  moderationScan,
  userData,
  userReportComment,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/** Build the `moderationScan` insert for `moderateContent`. */
export const insertModerationScanForModerateContent = (
  client: Pick<DrizzleClient, "insert">,
  scanId: string,
  userId: string,
  relationId: string,
  relationType: AutomoderationCategory,
  gateModel: string,
) =>
  client.insert(moderationScan).values({
    id: scanId,
    userId,
    relationId,
    relationType,
    gateModel,
    decisionModel: OPENAI_MODERATION_MODEL,
    promptVersion: MODERATION_PROMPT_VERSION,
  });

/** Build the `moderationScan` update for `moderateContent`, using predicates on `id`. */
export const updateModerationScanForModerateContent = (
  client: Pick<DrizzleClient, "update">,
  result: Pick<Moderation, "flagged" | "category_scores">,
  scanId: string,
) =>
  client
    .update(moderationScan)
    .set({
      flagged: result.flagged,
      categoryScores: { ...result.category_scores },
      outcome: result.flagged ? "CHECKING" : "GATE_CLEAR",
      completedAt: result.flagged ? null : new Date(),
    })
    .where(eq(moderationScan.id, scanId));

/** Build the `moderationScan` update for `moderateContent`, using predicates on `id`. */
export const updateModerationScanForModerateContent2 = (
  client: Pick<DrizzleClient, "update">,
  reportId: null | string,
  scanId: string,
) =>
  client
    .update(moderationScan)
    .set({
      outcome: reportId ? "REPORTED" : "DECISION_CLEAR",
      reportId,
      completedAt: new Date(),
    })
    .where(eq(moderationScan.id, scanId));

/** Build the `moderationScan` update for `moderateContent`, using predicates on `id`. */
export const updateModerationScanForModerateContent3 = (
  client: Pick<DrizzleClient, "update">,
  stage: "decision" | "gate" | "report",
  reportId: null | string,
  scanId: string,
) =>
  client
    .update(moderationScan)
    .set({
      outcome: "ERROR",
      errorStage: stage,
      reportId,
      completedAt: new Date(),
    })
    .where(eq(moderationScan.id, scanId));

/** The author and message columns moderation context reads from either comment table. */
const additionalContextColumns = (
  table: typeof conversationComment | typeof forumPost,
) => ({
  userId: table.userId,
  authorId: table.authorId,
  username: userData.username,
  avatar: userData.avatar,
  level: userData.level,
  rank: userData.rank,
  federalStatus: userData.federalStatus,
  isOutlaw: userData.isOutlaw,
  role: userData.role,
  content: table.content,
  createdAt: table.createdAt,
});

/**
 * Build the `conversationComment` selection for `getAdditionalContext`, using
 * predicates on `conversationId`, `id`, `createdAt`.
 */
export const selectConversationCommentForGetAdditionalContext = (
  client: Pick<DrizzleClient, "select">,
  conversationId: string,
  excludeId: undefined | string,
  timestamp: undefined | null | Date,
) =>
  client
    .select(additionalContextColumns(conversationComment))
    .from(conversationComment)
    .innerJoin(userData, eq(conversationComment.userId, userData.userId))
    .where(
      and(
        eq(conversationComment.conversationId, conversationId),
        excludeId ? ne(conversationComment.id, excludeId) : undefined,
        lt(conversationComment.createdAt, timestamp || new Date()),
      ),
    )
    .orderBy(desc(conversationComment.createdAt))
    .limit(REPORT_CONTEXT_WINDOW);

/**
 * Build the `forumPost` selection for `getAdditionalContext`, using
 * predicates on `threadId`, `id`, `createdAt`.
 */
export const selectForumPostForGetAdditionalContext = (
  client: Pick<DrizzleClient, "select">,
  conversationId: string,
  excludeId: undefined | string,
  timestamp: undefined | null | Date,
) =>
  client
    .select(additionalContextColumns(forumPost))
    .from(forumPost)
    .innerJoin(userData, eq(forumPost.userId, userData.userId))
    .where(
      and(
        eq(forumPost.threadId, conversationId),
        eq(forumPost.isApproved, true),
        isNull(forumPost.deletedAt),
        excludeId ? ne(forumPost.id, excludeId) : undefined,
        lt(forumPost.createdAt, timestamp || new Date()),
      ),
    )
    .orderBy(desc(forumPost.createdAt))
    .limit(REPORT_CONTEXT_WINDOW);

/** Build the reported-flag update for one conversation comment. */
export const markConversationCommentReported = (
  client: Pick<DrizzleClient, "update">,
  commentId: string,
) =>
  client
    .update(conversationComment)
    .set({ isReported: true })
    .where(eq(conversationComment.id, commentId));

/** Build the reported-flag update for one forum post. */
export const markForumPostReported = (
  client: Pick<DrizzleClient, "update">,
  postId: string,
) => client.update(forumPost).set({ isReported: true }).where(eq(forumPost.id, postId));

/** Build the `userReportComment` update for `updateReportedStatus`, setting `isReported`, using predicates on `id`. */
export const updateUserReportCommentForUpdateReportedStatus = (
  client: Pick<DrizzleClient, "update">,
  relationId: string,
) =>
  client
    .update(userReportComment)
    .set({ isReported: true })
    .where(eq(userReportComment.id, relationId));
