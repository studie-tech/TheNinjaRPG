/**
 * Database access for data; authorization and transaction scopes stay in callers.
 */

import {
  and,
  asc,
  countDistinct,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  lt,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import { type BattleType, TUTORIAL_STEPS_COUNT } from "@/drizzle/constants";
import {
  abEvent,
  actionLog,
  bloodline,
  dataBattleAction,
  historicalIp,
  item,
  jutsu,
  logBattleLengths,
  logQueueLengths,
  logRankedPicks,
  paypalTransaction,
  quest,
  questHistory,
  referralSource,
  userData,
  userItem,
  userJutsu,
  userSkill,
  visitorLog,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { WEEK_S } from "@/utils/time";

/** Table alias for completion joins, keeping its columns distinct from other participants. */
const completion = alias(abEvent, "completion");

/** Build the `abEvent` distinct selection for `getAbTests`, using predicates on `createdAt`. */
export const selectDistinctAbEventForGetAbTests = (
  client: Pick<DrizzleClient, "selectDistinct">,
) =>
  client
    .selectDistinct({ experiment: abEvent.experiment })
    .from(abEvent)
    .where(gte(abEvent.createdAt, new Date(Date.now() - WEEK_S * 1000)));

/** Build the `abEvent` selection for `getAbTests`, using predicates on `event`. */
export const selectAbEventForGetAbTests = (
  client: Pick<DrizzleClient, "select">,
  whereConds: import("@/utils/typeutils").QueryCondition[],
) =>
  client
    .select({
      experiment: sql<string>`ANY_VALUE(${abEvent.experiment})`,
      variant: sql<string>`ANY_VALUE(${abEvent.variant})`,
      userAgent: sql<string | null>`ANY_VALUE(${abEvent.userAgent})`,
      loaded: sql`COUNT(*)`.mapWith(Number),
      // Empty IPs and completion IDs cannot identify an attributable conversion.
      register:
        sql`COUNT(CASE WHEN LENGTH(${abEvent.ipHash}) > 0 AND LENGTH(${completion.id}) > 0 THEN 1 END)`.mapWith(
          Number,
        ),
    })
    .from(abEvent)
    .leftJoin(
      completion,
      and(
        eq(completion.experiment, abEvent.experiment),
        eq(completion.ipHash, abEvent.ipHash),
        eq(completion.variant, abEvent.variant),
        eq(completion.event, "success"),
      ),
    )
    .where(and(eq(abEvent.event, "loaded"), ...whereConds))
    // Binary groups keep keys exact; ANY_VALUE returns their original text.
    .groupBy(
      sql`BINARY ${abEvent.experiment}`,
      sql`BINARY ${abEvent.variant}`,
      sql`BINARY ${abEvent.userAgent}`,
    );

/** Build the `visitorLog` distinct selection for `getVisitorUtmSources`, using predicates on `utmSource`. */
export const selectDistinctVisitorLogForGetVisitorUtmSources = (
  client: Pick<DrizzleClient, "selectDistinct">,
) =>
  client
    .selectDistinct({ utmSource: visitorLog.utmSource })
    .from(visitorLog)
    .where(and(isNotNull(visitorLog.utmSource), ne(visitorLog.utmSource, "")))
    .orderBy(asc(visitorLog.utmSource));

/** Build the `visitorLog` selection for `getRecruitmentMainMetrics`, using the configured predicates. */
export const selectVisitorLogForGetRecruitmentMainMetrics = (
  client: Pick<DrizzleClient, "select">,
  visitorWhere: import("@/utils/typeutils").QueryCondition[],
) =>
  client
    .select({
      userAgent: visitorLog.userAgent,
    })
    .from(visitorLog)
    .where(visitorWhere.length > 0 ? and(...visitorWhere) : undefined);

/**
 * Build the `visitorLog` selection for `getRecruitmentMainMetrics`, including
 * predicates on `isAi`, `tutorialStep`, `createdAt`.
 */
export const selectVisitorLogForGetRecruitmentMainMetrics2 = (
  client: Pick<DrizzleClient, "select">,
  visitorWhere: import("@/utils/typeutils").QueryCondition[],
  input: { utmSource?: undefined | string },
) =>
  client
    .select({
      userId: userData.userId,
      username: userData.username,
      tutorialStep: userData.tutorialStep,
      tutorialOn: userData.tutorialOn,
      userAgent: visitorLog.userAgent,
    })
    .from(visitorLog)
    .innerJoin(historicalIp, eq(historicalIp.ipHash, visitorLog.ipHash))
    .leftJoin(userData, eq(userData.userId, historicalIp.userId))
    .innerJoin(referralSource, eq(referralSource.userId, userData.userId))
    .where(
      and(
        ...(visitorWhere.length > 0 ? visitorWhere : []),
        eq(userData.isAi, false),
        lt(userData.tutorialStep, 100),
        gte(userData.createdAt, visitorLog.createdAt),
        ...(input.utmSource && input.utmSource.length > 0
          ? [eq(referralSource.source, input.utmSource)]
          : []),
      ),
    );

/** Build the `visitorLog` selection for `getRecruitmentMainMetrics`, using predicates on `isAi`, `createdAt`, `rank`. */
export const selectVisitorLogForGetRecruitmentMainMetrics3 = (
  client: Pick<DrizzleClient, "select">,
  visitorWhere: import("@/utils/typeutils").QueryCondition[],
) =>
  client
    .select({
      userId: userData.userId,
      userAgent: visitorLog.userAgent,
      tutorialOn: userData.tutorialOn,
    })
    .from(visitorLog)
    .innerJoin(historicalIp, eq(historicalIp.ipHash, visitorLog.ipHash))
    .innerJoin(userData, eq(userData.userId, historicalIp.userId))
    .where(
      and(
        ...(visitorWhere.length > 0 ? visitorWhere : []),
        eq(userData.isAi, false),
        gte(userData.createdAt, visitorLog.createdAt),
        ne(userData.rank, "STUDENT"),
      ),
    );

/** Build the `visitorLog` selection for `getRecruitmentMainMetrics`, using predicates on `isAi`, `createdAt`, `rank`. */
export const selectVisitorLogForGetRecruitmentMainMetrics4 = (
  client: Pick<DrizzleClient, "select">,
  visitorWhere: import("@/utils/typeutils").QueryCondition[],
) =>
  client
    .select({
      userId: userData.userId,
      userAgent: visitorLog.userAgent,
      tutorialOn: userData.tutorialOn,
    })
    .from(visitorLog)
    .innerJoin(historicalIp, eq(historicalIp.ipHash, visitorLog.ipHash))
    .innerJoin(userData, eq(userData.userId, historicalIp.userId))
    .where(
      and(
        ...(visitorWhere.length > 0 ? visitorWhere : []),
        eq(userData.isAi, false),
        gte(userData.createdAt, visitorLog.createdAt),
        ne(userData.rank, "STUDENT"),
        ne(userData.rank, "GENIN"),
      ),
    );

/**
 * Build the `visitorLog` selection for `getRecruitmentMainMetrics`, using predicates
 * on `isAi`, `createdAt`, `pvpFights`.
 */
export const selectVisitorLogForGetRecruitmentMainMetrics5 = (
  client: Pick<DrizzleClient, "select">,
  visitorWhere: import("@/utils/typeutils").QueryCondition[],
) =>
  client
    .select({
      userId: userData.userId,
      userAgent: visitorLog.userAgent,
    })
    .from(visitorLog)
    .innerJoin(historicalIp, eq(historicalIp.ipHash, visitorLog.ipHash))
    .innerJoin(userData, eq(userData.userId, historicalIp.userId))
    .where(
      and(
        ...(visitorWhere.length > 0 ? visitorWhere : []),
        eq(userData.isAi, false),
        gte(userData.createdAt, visitorLog.createdAt),
        gt(userData.pvpFights, 0),
      ),
    );

/**
 * Build the `visitorLog` selection for `getRecruitmentMainMetrics`, using predicates
 * on `isAi`, `createdAt`, `tutorialStep`.
 */
export const selectVisitorLogForGetRecruitmentMainMetrics6 = (
  client: Pick<DrizzleClient, "select">,
  visitorWhere: import("@/utils/typeutils").QueryCondition[],
) =>
  client
    .select({
      userId: userData.userId,
      userAgent: visitorLog.userAgent,
    })
    .from(visitorLog)
    .innerJoin(historicalIp, eq(historicalIp.ipHash, visitorLog.ipHash))
    .innerJoin(userData, eq(userData.userId, historicalIp.userId))
    .where(
      and(
        ...(visitorWhere.length > 0 ? visitorWhere : []),
        eq(userData.isAi, false),
        gte(userData.createdAt, visitorLog.createdAt),
        gte(userData.tutorialStep, TUTORIAL_STEPS_COUNT),
        lt(userData.tutorialStep, 100),
      ),
    );

/**
 * Build the `paypalTransaction` selection for `getRecruitmentMainMetrics`, including
 * predicates on `utmSource`, `status`, `isAi`.
 */
export const selectPaypalTransactionForGetRecruitmentMainMetrics = (
  client: Pick<DrizzleClient, "select">,
  input: { utmSource?: undefined | string },
) =>
  client
    .select({
      amount: paypalTransaction.amount,
      userAgent: visitorLog.userAgent,
      userId: userData.userId,
      userCreatedAt: userData.createdAt,
      transactionCreatedAt: paypalTransaction.createdAt,
    })
    .from(paypalTransaction)
    .innerJoin(userData, eq(paypalTransaction.createdById, userData.userId))
    .innerJoin(historicalIp, eq(historicalIp.userId, userData.userId))
    .innerJoin(visitorLog, eq(visitorLog.ipHash, historicalIp.ipHash))
    .where(
      and(
        ...(input.utmSource && input.utmSource.length > 0
          ? [eq(visitorLog.utmSource, input.utmSource)]
          : [isNotNull(visitorLog.utmSource)]),
        inArray(paypalTransaction.status, ["COMPLETED", "REVIEW_REQUIRED"]),
        eq(userData.isAi, false),
        gte(userData.createdAt, visitorLog.createdAt),
      ),
    );

/**
 * Build the `visitorLog` selection for `getRecruitmentMainMetrics`, including
 * predicates on `utmSource`, `isAi`, `tutorialStep`.
 */
export const selectVisitorLogForGetRecruitmentMainMetrics7 = (
  client: Pick<DrizzleClient, "select">,
  input: { utmSource?: undefined | string },
) =>
  client
    .select({
      userId: userData.userId,
    })
    .from(visitorLog)
    .innerJoin(historicalIp, eq(historicalIp.ipHash, visitorLog.ipHash))
    .leftJoin(userData, eq(userData.userId, historicalIp.userId))
    .innerJoin(referralSource, eq(referralSource.userId, userData.userId))
    .where(
      and(
        input.utmSource && input.utmSource.length > 0
          ? eq(visitorLog.utmSource, input.utmSource)
          : ne(visitorLog.utmSource, ""),
        eq(userData.isAi, false),
        lt(userData.tutorialStep, 100),
        gte(userData.createdAt, visitorLog.createdAt),
        ...(input.utmSource && input.utmSource.length > 0
          ? [eq(referralSource.source, input.utmSource)]
          : []),
      ),
    );

/** Build the `quest` selection for `getRecruitmentMainMetrics`, using predicates on `questType`. */
export const selectQuestForGetRecruitmentMainMetrics2 = (
  client: Pick<DrizzleClient, "select">,
) =>
  client
    .select({
      id: quest.id,
      name: quest.name,
      description: quest.description,
      tierLevel: quest.tierLevel,
    })
    .from(quest)
    .where(eq(quest.questType, "tier"))
    .orderBy(asc(quest.tierLevel));

/**
 * Build the `questHistory` selection for `getRecruitmentMainMetrics`, including
 * predicates on `isAi`, `tutorialStep`, `createdAt`.
 */
export const selectQuestHistoryForGetRecruitmentMainMetrics2 = (
  client: Pick<DrizzleClient, "select">,
  visitorWhere: import("@/utils/typeutils").QueryCondition[],
  input: {
    includeTierTutorialDisabled?: undefined | false | true;
    utmSource?: undefined | string;
  },
) =>
  client
    .select({
      odUserId: userData.userId,
      questId: questHistory.questId,
    })
    .from(questHistory)
    .innerJoin(userData, eq(userData.userId, questHistory.userId))
    .innerJoin(historicalIp, eq(historicalIp.userId, userData.userId))
    .innerJoin(visitorLog, eq(visitorLog.ipHash, historicalIp.ipHash))
    .innerJoin(referralSource, eq(referralSource.userId, userData.userId))
    .innerJoin(quest, eq(quest.id, questHistory.questId))
    .where(
      and(
        ...(visitorWhere.length > 0 ? visitorWhere : []),
        eq(userData.isAi, false),
        lt(userData.tutorialStep, 100),
        gte(userData.createdAt, visitorLog.createdAt),
        gte(userData.tutorialStep, TUTORIAL_STEPS_COUNT),
        // By default exclude users who disabled the tutorial
        ...(input.includeTierTutorialDisabled ? [] : [ne(userData.tutorialOn, false)]),
        ...(input.utmSource && input.utmSource.length > 0
          ? [eq(referralSource.source, input.utmSource)]
          : []),
        eq(quest.questType, "tier"),
        eq(questHistory.completed, 1),
      ),
    );

/** Build the `referralSource` distinct selection for `getReferralSources`, using predicates on `source`. */
export const selectDistinctReferralSourceForGetReferralSources = (
  client: Pick<DrizzleClient, "selectDistinct">,
) =>
  client
    .selectDistinct({ source: referralSource.source })
    .from(referralSource)
    .where(ne(referralSource.source, ""))
    .orderBy(asc(referralSource.source));

/** Build the `paypalTransaction` selection for `getRevenueByReferralSource`, using the configured predicates. */
export const selectPaypalTransactionForGetRevenueByReferralSource = (
  client: Pick<DrizzleClient, "select">,
  whereConditions: import("@/utils/typeutils").QueryCondition[],
) =>
  client
    .select({
      source: visitorLog.utmSource,
      totalUsd: sql`SUM(${paypalTransaction.amount})`.mapWith(Number),
    })
    .from(paypalTransaction)
    .innerJoin(userData, eq(paypalTransaction.createdById, userData.userId))
    .innerJoin(historicalIp, eq(historicalIp.userId, userData.userId))
    .innerJoin(visitorLog, eq(visitorLog.ipHash, historicalIp.ipHash))
    .where(and(...whereConditions))
    .groupBy(visitorLog.utmSource)
    .orderBy(asc(visitorLog.utmSource));

/** Build the `userData` selection for `getRecruitmentLevelDistribution`, using the configured predicates. */
export const selectUserDataForGetRecruitmentLevelDistribution = (
  client: Pick<DrizzleClient, "select">,
  clampedExpr: SQL<number>,
  realWhere: import("@/utils/typeutils").QueryCondition[],
) =>
  client
    .select({
      source: referralSource.source,
      level: clampedExpr,
      count: sql`COUNT(${userData.userId})`.mapWith(Number),
    })
    .from(userData)
    .innerJoin(referralSource, eq(referralSource.userId, userData.userId))
    .where(and(...realWhere))
    .groupBy(referralSource.source, clampedExpr)
    .orderBy(asc(referralSource.source), asc(clampedExpr));

/** Build the `userData` selection for `getRecruitmentLevelDistribution`, using the configured predicates. */
export const selectUserDataForGetRecruitmentLevelDistribution2 = (
  client: Pick<DrizzleClient, "select">,
  realWhere: import("@/utils/typeutils").QueryCondition[],
) =>
  client
    .select({
      source: referralSource.source,
      level:
        sql<number>`COALESCE(SUM(CASE WHEN ${questHistory.completed} = 1 THEN 1 ELSE 0 END), 0)`.mapWith(
          Number,
        ),
      userId: userData.userId,
    })
    .from(userData)
    .innerJoin(referralSource, eq(referralSource.userId, userData.userId))
    .leftJoin(questHistory, eq(questHistory.userId, userData.userId))
    .where(and(...realWhere))
    .groupBy(referralSource.source, userData.userId);

/** Build the `userData` selection for `getRecruitmentLevelDistribution`, using the configured predicates. */
export const selectUserDataForGetRecruitmentLevelDistribution3 = (
  client: Pick<DrizzleClient, "select">,
  clampedExpr: SQL<number>,
  dynamicWhere: import("@/utils/typeutils").QueryCondition[],
) =>
  client
    .select({
      level: clampedExpr,
      count: sql`COUNT(${userData.userId})`.mapWith(Number),
    })
    .from(userData)
    .where(and(...dynamicWhere))
    .groupBy(clampedExpr)
    .orderBy(asc(clampedExpr));

/** Build the `userData` selection for `getRecruitmentLevelDistribution`, using the configured predicates. */
export const selectUserDataForGetRecruitmentLevelDistribution4 = (
  client: Pick<DrizzleClient, "select">,
  dynamicWhere: import("@/utils/typeutils").QueryCondition[],
) =>
  client
    .select({
      level:
        sql<number>`COALESCE(SUM(CASE WHEN ${questHistory.completed} = 1 THEN 1 ELSE 0 END), 0)`.mapWith(
          Number,
        ),
      userId: userData.userId,
    })
    .from(userData)
    .leftJoin(questHistory, eq(questHistory.userId, userData.userId))
    .where(and(...dynamicWhere))
    .groupBy(userData.userId);

/**
 * Build the `userData` selection for `getRecruitmentDailyLevelStats`, including
 * predicates on `isAi`, `createdAt`, `source`.
 */
export const selectUserDataForGetRecruitmentDailyLevelStats = (
  client: Pick<DrizzleClient, "select">,
  dayExpr: SQL<string>,
  selected: undefined | string[],
  input: { startDate?: undefined | string; endDate?: undefined | string },
  realSources: undefined | string[],
  wantsDynamic: false | true,
  wantsRecruited: false | true,
) =>
  client
    .select({
      day: dayExpr,
      mean: sql`AVG(${userData.level})`.mapWith(Number),
      std: sql`STDDEV_SAMP(${userData.level})`.mapWith(Number),
      count: sql`COUNT(${userData.userId})`.mapWith(Number),
    })
    .from(userData)
    .leftJoin(referralSource, eq(referralSource.userId, userData.userId))
    .where(
      selected
        ? and(
            eq(userData.isAi, false),
            ...(input.startDate
              ? [gte(userData.createdAt, new Date(input.startDate))]
              : []),
            ...(input.endDate
              ? [lte(userData.createdAt, new Date(input.endDate))]
              : []),
            or(
              ...(realSources && realSources.length > 0
                ? [inArray(referralSource.source, realSources)]
                : []),
              ...(wantsDynamic ? [sql`(${referralSource.userId} IS NULL)`] : []),
              ...(wantsRecruited ? [sql`(${userData.recruiterId} IS NOT NULL)`] : []),
            ),
          )
        : and(
            eq(userData.isAi, false),
            ...(input.startDate
              ? [gte(userData.createdAt, new Date(input.startDate))]
              : []),
            ...(input.endDate
              ? [lte(userData.createdAt, new Date(input.endDate))]
              : []),
            sql`${referralSource.userId} IS NOT NULL`,
          ),
    )
    .groupBy(dayExpr)
    .orderBy(asc(dayExpr));

/** Build the `userData` selection for `getRecruitmentDailyCountsBySource`, using the configured predicates. */
export const selectUserDataForGetRecruitmentDailyCountsBySource = (
  client: Pick<DrizzleClient, "select">,
  dayExpr: SQL<string>,
  realWhere: import("@/utils/typeutils").QueryCondition[],
) =>
  client
    .select({
      day: dayExpr,
      source: referralSource.source,
      count: sql`COUNT(${userData.userId})`.mapWith(Number),
    })
    .from(userData)
    .innerJoin(referralSource, eq(referralSource.userId, userData.userId))
    .where(and(...realWhere))
    .groupBy(dayExpr, referralSource.source)
    .orderBy(asc(dayExpr), asc(referralSource.source));

/**
 * Build the `userData` selection for `getRecruitmentDailyCountsBySource`, including
 * predicates on `isAi`, `recruiterId`, `userId`.
 */
export const selectUserDataForGetRecruitmentDailyCountsBySource2 = (
  client: Pick<DrizzleClient, "select">,
  dayExpr: SQL<string>,
  input: { startDate?: undefined | string; endDate?: undefined | string },
) =>
  client
    .select({
      day: dayExpr,
      count: sql`COUNT(${userData.userId})`.mapWith(Number),
    })
    .from(userData)
    .where(
      and(
        eq(userData.isAi, false),
        sql`${userData.recruiterId} IS NULL`,
        sql`NOT EXISTS(SELECT 1 FROM ${referralSource} rs2 WHERE rs2.userId = ${userData.userId})`,
        ...(input.startDate
          ? [gte(userData.createdAt, new Date(input.startDate))]
          : []),
        ...(input.endDate ? [lte(userData.createdAt, new Date(input.endDate))] : []),
      ),
    )
    .groupBy(dayExpr)
    .orderBy(asc(dayExpr));

/**
 * Build the `userData` selection for `getRecruitmentDailyCountsBySource`, using
 * predicates on `isAi`, `recruiterId`, `createdAt`.
 */
export const selectUserDataForGetRecruitmentDailyCountsBySource3 = (
  client: Pick<DrizzleClient, "select">,
  dayExpr: SQL<string>,
  input: { startDate?: undefined | string; endDate?: undefined | string },
) =>
  client
    .select({
      day: dayExpr,
      count: sql`COUNT(${userData.userId})`.mapWith(Number),
    })
    .from(userData)
    .where(
      and(
        eq(userData.isAi, false),
        sql`${userData.recruiterId} IS NOT NULL`,
        ...(input.startDate
          ? [gte(userData.createdAt, new Date(input.startDate))]
          : []),
        ...(input.endDate ? [lte(userData.createdAt, new Date(input.endDate))] : []),
      ),
    )
    .groupBy(dayExpr)
    .orderBy(asc(dayExpr));

/** Build the `dataBattleAction` deletion for `deleteSingleDataBattleAction`, using predicates on `contentId` and `type`. */
export const deleteDataBattleActionForDeleteSingleDataBattleAction = (
  client: Pick<DrizzleClient, "delete">,
  input: { contentId: string; type: "item" | "jutsu" | "bloodline" | "ai" | "basic" },
) =>
  client
    .delete(dataBattleAction)
    .where(
      and(
        eq(dataBattleAction.contentId, input.contentId),
        eq(dataBattleAction.type, input.type),
      ),
    );

/** Build the `actionLog` insert for `deleteSingleDataBattleAction`. */
export const insertActionLogForDeleteSingleDataBattleAction = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { type: "item" | "jutsu" | "bloodline" | "ai" | "basic"; contentId: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "battleAction",
    changes: [`Deleted ${input.type} battle action: ${input.contentId}`],
    relatedId: input.contentId,
    relatedMsg: `Delete: ${input.contentId}`,
    relatedImage: null,
  });

/** Build the `dataBattleAction` deletion for `deleteAllDataBattleAction`, using predicates on `type`. */
export const deleteDataBattleActionForDeleteAllDataBattleAction = (
  client: Pick<DrizzleClient, "delete">,
  input: { type: "item" | "jutsu" | "bloodline" | "ai" | "basic" },
) => client.delete(dataBattleAction).where(eq(dataBattleAction.type, input.type));

/** Build the `actionLog` insert for `deleteAllDataBattleAction`. */
export const insertActionLogForDeleteAllDataBattleAction = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { type: "item" | "jutsu" | "bloodline" | "ai" | "basic" },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "battleAction",
    changes: [`Deleted all ${input.type} battle actions`],
    relatedId: null,
    relatedMsg: `Delete: All ${input.type} battle actions`,
    relatedImage: null,
  });

/** Build the `bloodline` selection for `getBloodlineBalanceStatistics`, using the configured predicates. */
export const selectBloodlineForGetBloodlineBalanceStatistics = (
  client: Pick<DrizzleClient, "select">,
  bloodlineWhereConditions: import("@/utils/typeutils").QueryCondition[],
) =>
  client
    .select({
      id: bloodline.id,
      name: bloodline.name,
    })
    .from(bloodline)
    .where(
      bloodlineWhereConditions.length > 0
        ? and(...bloodlineWhereConditions)
        : undefined,
    );

/** Build the `userData` selection for `getBloodlineBalanceStatistics`. */
export const selectUserDataForGetBloodlineBalanceStatistics = (
  client: Pick<DrizzleClient, "select">,
) =>
  client
    .select({
      bloodlineId: userData.bloodlineId,
      userCount:
        sql<number>`COUNT(CASE WHEN ${userData.bloodlineId} IS NOT NULL THEN 1 END)`.mapWith(
          Number,
        ),
    })
    .from(userData)
    .groupBy(userData.bloodlineId);

/** Build the `dataBattleAction` selection for `getBloodlineBalanceStatistics`, using the configured predicates. */
export const selectDataBattleActionForGetBloodlineBalanceStatistics = (
  client: Pick<DrizzleClient, "select">,
  whereConditions: import("@/utils/typeutils").QueryCondition[],
  input: { minCount: number },
) =>
  client
    .select({
      name: bloodline.name,
      bloodlineId: bloodline.id,
      battleWon: dataBattleAction.battleWon,
      count: sql`SUM(${dataBattleAction.count})`.mapWith(Number),
    })
    .from(dataBattleAction)
    .innerJoin(bloodline, eq(dataBattleAction.contentId, bloodline.id))
    .groupBy(bloodline.name, bloodline.id, dataBattleAction.battleWon)
    .where(and(...whereConditions))
    .having(gte(sql`SUM(${dataBattleAction.count})`, input.minCount));

/** Build the `userJutsu` selection for `getJutsuBalanceStatistics`. */
export const selectUserJutsuForGetJutsuBalanceStatistics = (
  client: Pick<DrizzleClient, "select">,
) =>
  client
    .select({
      jutsuId: userJutsu.jutsuId,
      equippedCount:
        sql<number>`COUNT(CASE WHEN ${userJutsu.equipped} = 1 THEN 1 END)`.mapWith(
          Number,
        ),
    })
    .from(userJutsu)
    .groupBy(userJutsu.jutsuId);

/** Build the `dataBattleAction` selection for `getJutsuBalanceStatistics`, using the configured predicates. */
export const selectDataBattleActionForGetJutsuBalanceStatistics = (
  client: Pick<DrizzleClient, "select">,
  whereConditions: import("@/utils/typeutils").QueryCondition[],
  havingClause: SQL<unknown>,
) =>
  client
    .select({
      name: jutsu.name,
      jutsuId: jutsu.id,
      battleWon: dataBattleAction.battleWon,
      count: sql`SUM(${dataBattleAction.count})`.mapWith(Number),
    })
    .from(dataBattleAction)
    .innerJoin(jutsu, eq(dataBattleAction.contentId, jutsu.id))
    .groupBy(
      jutsu.name,
      jutsu.id,
      dataBattleAction.battleWon,
      dataBattleAction.battleType,
    )
    .where(and(...whereConditions))
    .having(havingClause);

/** Build the `jutsu` listing for `getJutsuEffectsBalanceStatistics`, using the configured predicates. */
export const listJutsuForGetJutsuEffectsBalanceStatistics = (
  client: Pick<DrizzleClient, "query">,
  baseFilters: (undefined | SQL<unknown>)[],
) =>
  client.query.jutsu.findMany({
    where: and(...baseFilters),
    with: {
      bloodline: {
        columns: {
          name: true,
        },
      },
    },
    columns: {
      id: true,
      name: true,
      jutsuType: true,
      cooldown: true,
      requiredRank: true,
      effects: true,
    },
  });

/** Build the `item` listing for `getItemEffectsBalanceStatistics`, using the configured predicates. */
export const listItemForGetItemEffectsBalanceStatistics = (
  client: Pick<DrizzleClient, "query">,
  baseFilters: import("@/utils/typeutils").QueryCondition[],
) =>
  client.query.item.findMany({
    where: and(...baseFilters),
    columns: {
      id: true,
      name: true,
      itemType: true,
      rarity: true,
      slot: true,
      effects: true,
    },
  });

/** Build the `bloodline` listing for `getBloodlineEffectsBalanceStatistics`, using the configured predicates. */
export const listBloodlineForGetBloodlineEffectsBalanceStatistics = (
  client: Pick<DrizzleClient, "query">,
  baseFilters: (undefined | SQL<unknown>)[],
) =>
  client.query.bloodline.findMany({
    where: and(...baseFilters),
    with: {
      village: {
        columns: {
          name: true,
        },
      },
    },
    columns: {
      id: true,
      name: true,
      rank: true,
      statClassification: true,
      effects: true,
    },
  });

/** Build the `userSkill` selection for `getSkillTreeBalanceStatistics`. */
export const selectUserSkillForGetSkillTreeBalanceStatistics = (
  client: Pick<DrizzleClient, "select">,
) =>
  client
    .select({
      skillId: userSkill.skillId,
      userCount: sql`COUNT(${userSkill.userId})`.mapWith(Number),
    })
    .from(userSkill)
    .groupBy(userSkill.skillId);

/** Build the `skillTree` listing for `getSkillTreeBalanceStatistics`, using the configured predicates. */
export const listSkillTreeForGetSkillTreeBalanceStatistics = (
  client: Pick<DrizzleClient, "query">,
  whereConditions: import("@/utils/typeutils").QueryCondition[],
) =>
  client.query.skillTree.findMany({
    where: whereConditions.length > 0 ? and(...whereConditions) : undefined,
    columns: {
      id: true,
      name: true,
      tier: true,
      costSkillPoints: true,
      effects: true,
      hidden: true,
    },
    with: { folder: { columns: { hidden: true } } },
  });

/** Build the `skillTree` listing for `getSkillTreeEffectsBalanceStatistics`, using the configured predicates. */
export const listSkillTreeForGetSkillTreeEffectsBalanceStatistics = (
  client: Pick<DrizzleClient, "query">,
  baseFilters: SQL<unknown>[],
) =>
  client.query.skillTree.findMany({
    where: and(...baseFilters),
    columns: {
      id: true,
      name: true,
      tier: true,
      costSkillPoints: true,
      effects: true,
      hidden: true,
    },
    with: { folder: { columns: { hidden: true } } },
  });

/** Build the `userItem` selection for `getItemBalanceStatistics`. */
export const selectUserItemForGetItemBalanceStatistics = (
  client: Pick<DrizzleClient, "select">,
) =>
  client
    .select({
      itemId: userItem.itemId,
      equippedCount:
        sql<number>`COUNT(CASE WHEN ${ne(userItem.equipped, "NONE")} THEN 1 END)`.mapWith(
          Number,
        ),
    })
    .from(userItem)
    .groupBy(userItem.itemId);

/** Build the `dataBattleAction` selection for `getItemBalanceStatistics`, using the configured predicates. */
export const selectDataBattleActionForGetItemBalanceStatistics = (
  client: Pick<DrizzleClient, "select">,
  whereConditions: import("@/utils/typeutils").QueryCondition[],
  havingClause: SQL<unknown>,
) =>
  client
    .select({
      name: item.name,
      itemId: item.id,
      battleWon: dataBattleAction.battleWon,
      count: sql`SUM(${dataBattleAction.count})`.mapWith(Number),
    })
    .from(dataBattleAction)
    .innerJoin(item, eq(dataBattleAction.contentId, item.id))
    .groupBy(
      item.name,
      item.id,
      dataBattleAction.battleWon,
      dataBattleAction.battleType,
    )
    .where(and(...whereConditions))
    .having(havingClause);

/** Build the `dataBattleAction` selection for `getAiBalanceStatistics`, using the configured predicates. */
export const selectDataBattleActionForGetAiBalanceStatistics = (
  client: Pick<DrizzleClient, "select">,
  whereConditions: import("@/utils/typeutils").QueryCondition[],
  havingClause: SQL<unknown>,
) =>
  client
    .select({
      name: sql<string>`CONCAT(${userData.username}, ' - lvl', ${userData.level})`,
      aiUserId: userData.userId,
      battleWon: dataBattleAction.battleWon,
      count: sql`SUM(${dataBattleAction.count})`.mapWith(Number),
    })
    .from(dataBattleAction)
    .innerJoin(userData, eq(dataBattleAction.contentId, userData.userId))
    .groupBy(userData.userId, dataBattleAction.battleWon, dataBattleAction.battleType)
    .where(and(...whereConditions))
    .having(havingClause);

/** Build the `logBattleLengths` selection for `getBattleLengthStatistics`, using the configured predicates. */
export const selectLogBattleLengthsForGetBattleLengthStatistics = (
  client: Pick<DrizzleClient, "select">,
  whereConditions: import("@/utils/typeutils").QueryCondition[],
  havingClause: SQL<unknown>,
) =>
  client
    .select({
      battleType: logBattleLengths.battleType,
      rounds: logBattleLengths.rounds,
      count: sql`SUM(${logBattleLengths.count})`.mapWith(Number),
    })
    .from(logBattleLengths)
    .groupBy(logBattleLengths.battleType, logBattleLengths.rounds)
    .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
    .having(havingClause)
    .orderBy(asc(logBattleLengths.rounds));

/** Build the `logQueueLengths` selection for `getQueueLengthStatistics`, using the configured predicates. */
export const selectLogQueueLengthsForGetQueueLengthStatistics = (
  client: Pick<DrizzleClient, "select">,
  whereConditions: import("@/utils/typeutils").QueryCondition[],
  havingClause: SQL<unknown>,
) =>
  client
    .select({
      rankedRank: logQueueLengths.rankedRank,
      ceiledMinutes: logQueueLengths.ceiledMinutes,
      count: sql`SUM(${logQueueLengths.count})`.mapWith(Number),
    })
    .from(logQueueLengths)
    .groupBy(logQueueLengths.rankedRank, logQueueLengths.ceiledMinutes)
    .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
    .having(havingClause)
    .orderBy(asc(logQueueLengths.ceiledMinutes));

/** Build the `logBattleLengths` deletion for `clearAllBattleLengths`. */
export const deleteLogBattleLengthsForClearAllBattleLengths = (
  client: Pick<DrizzleClient, "delete">,
) => client.delete(logBattleLengths);

/** Build the `actionLog` insert for `clearAllBattleLengths`. */
export const insertActionLogForClearAllBattleLengths = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "battleLengths",
    changes: ["Cleared all battle length data"],
    relatedId: null,
    relatedMsg: "Clear: All battle length data",
    relatedImage: null,
  });

/** Build the `logQueueLengths` deletion for `clearAllQueueLengths`. */
export const deleteLogQueueLengthsForClearAllQueueLengths = (
  client: Pick<DrizzleClient, "delete">,
) => client.delete(logQueueLengths);

/** Build the `actionLog` insert for `clearAllQueueLengths`. */
export const insertActionLogForClearAllQueueLengths = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "queueLengths",
    changes: ["Cleared all queue length data"],
    relatedId: null,
    relatedMsg: "Clear: All queue length data",
    relatedImage: null,
  });

/** Build the `logRankedPicks` selection for `getRankedLoadoutStatistics`, using predicates on `type` and `name`. */
export const selectLogRankedPicksForGetRankedLoadoutStatistics = (
  client: Pick<DrizzleClient, "select">,
  typeConditions: undefined | SQL<unknown>,
  nameConditions: false | true,
  input: { name?: undefined | string; limit: number },
  havingClause: SQL<unknown>,
) =>
  client
    .select({
      type: logRankedPicks.type,
      contentId: logRankedPicks.contentId,
      battleType: logRankedPicks.battleType,
      count: sql`SUM(${logRankedPicks.count})`.mapWith(Number),
      name: jutsu.name,
    })
    .from(logRankedPicks)
    .innerJoin(jutsu, eq(logRankedPicks.contentId, jutsu.id))
    .where(
      and(
        eq(logRankedPicks.type, "jutsu"),
        typeConditions,
        nameConditions
          ? sql`LOWER(${jutsu.name}) LIKE LOWER(${`%${input.name}%`})`
          : undefined,
      ),
    )
    .groupBy(logRankedPicks.contentId, logRankedPicks.battleType)
    .having(havingClause)
    .orderBy(sql`SUM(${logRankedPicks.count}) DESC`)
    .limit(input.limit);

/** Build the `logRankedPicks` selection for `getRankedLoadoutStatistics`, using predicates on `type` and `name`. */
export const selectLogRankedPicksForGetRankedLoadoutStatistics2 = (
  client: Pick<DrizzleClient, "select">,
  typeConditions: undefined | SQL<unknown>,
  nameConditions: false | true,
  input: { name?: undefined | string; limit: number },
  havingClause: SQL<unknown>,
) =>
  client
    .select({
      type: logRankedPicks.type,
      contentId: logRankedPicks.contentId,
      battleType: logRankedPicks.battleType,
      count: sql`SUM(${logRankedPicks.count})`.mapWith(Number),
      name: item.name,
    })
    .from(logRankedPicks)
    .innerJoin(item, eq(logRankedPicks.contentId, item.id))
    .where(
      and(
        eq(logRankedPicks.type, "item"),
        typeConditions,
        nameConditions
          ? sql`LOWER(${item.name}) LIKE LOWER(${`%${input.name}%`})`
          : undefined,
      ),
    )
    .groupBy(logRankedPicks.contentId, logRankedPicks.battleType)
    .having(havingClause)
    .orderBy(sql`SUM(${logRankedPicks.count}) DESC`)
    .limit(input.limit);

/** Build the `logRankedPicks` selection for `getRankedLoadoutStatistics`, using predicates on `type` and `name`. */
export const selectLogRankedPicksForGetRankedLoadoutStatistics3 = (
  client: Pick<DrizzleClient, "select">,
  typeConditions: undefined | SQL<unknown>,
  nameConditions: false | true,
  input: { name?: undefined | string; limit: number },
  havingClause: SQL<unknown>,
) =>
  client
    .select({
      type: logRankedPicks.type,
      contentId: logRankedPicks.contentId,
      battleType: logRankedPicks.battleType,
      count: sql`SUM(${logRankedPicks.count})`.mapWith(Number),
      name: item.name,
    })
    .from(logRankedPicks)
    .innerJoin(item, eq(logRankedPicks.contentId, item.id))
    .where(
      and(
        eq(logRankedPicks.type, "consumable"),
        typeConditions,
        nameConditions
          ? sql`LOWER(${item.name}) LIKE LOWER(${`%${input.name}%`})`
          : undefined,
      ),
    )
    .groupBy(logRankedPicks.contentId, logRankedPicks.battleType)
    .having(havingClause)
    .orderBy(sql`SUM(${logRankedPicks.count}) DESC`)
    .limit(input.limit);

/** Build the `userData` selection for `getRankedRankDistributionStatistics`, using predicates on `isAi`. */
export const selectUserDataForGetRankedRankDistributionStatistics = (
  client: Pick<DrizzleClient, "select">,
  whereConditions: import("@/utils/typeutils").QueryCondition[],
) =>
  client
    .select({
      userId: userData.userId,
      username: userData.username,
      rankedLp: userData.rankedLp,
      level: userData.level,
      villageId: userData.villageId,
    })
    .from(userData)
    .where(
      and(
        eq(userData.isAi, false),
        whereConditions.length > 0 ? and(...whereConditions) : undefined,
      ),
    );

/** Build the `quest` selection for `getQuestRewardStatistics`, using the configured predicates. */
export const selectQuestForGetQuestRewardStatistics = (
  client: Pick<DrizzleClient, "select">,
  whereConditions: import("@/utils/typeutils").QueryCondition[],
) =>
  client
    .select({
      id: quest.id,
      name: quest.name,
      questRank: quest.questRank,
      questType: quest.questType,
      requiredLevel: quest.requiredLevel,
      content: quest.content,
    })
    .from(quest)
    .where(whereConditions.length > 0 ? and(...whereConditions) : undefined);

/**
 * Build the `dataBattleAction` selection for `getStatistics`, using predicates on
 * `contentId`, `battleType`, `createdAt`.
 */
export const selectDataBattleActionForGetStatistics = (
  client: Pick<DrizzleClient, "select">,
  input: {
    id: string;
    battleType?: BattleType | undefined;
    startDate?: undefined | string;
    endDate?: undefined | string;
  },
) =>
  client
    .select({
      battleWon: dataBattleAction.battleWon,
      battleType: dataBattleAction.battleType,
      count: sql`COUNT(${dataBattleAction.id})`.mapWith(Number),
    })
    .from(dataBattleAction)
    .groupBy(dataBattleAction.battleWon, dataBattleAction.battleType)
    .where(
      and(
        eq(dataBattleAction.contentId, input.id),
        ...(input.battleType
          ? [eq(dataBattleAction.battleType, input.battleType)]
          : []),
        ...(input.startDate
          ? [gte(dataBattleAction.createdAt, new Date(input.startDate))]
          : []),
        ...(input.endDate
          ? [lte(dataBattleAction.createdAt, new Date(input.endDate))]
          : []),
      ),
    );

/** Build the `userJutsu` selection for `getStatistics`, using predicates on `jutsuId`. */
export const selectUserJutsuForGetStatistics = (
  client: Pick<DrizzleClient, "select">,
  input: { id: string },
) =>
  client
    .select({
      level: userJutsu.level,
      count: sql`COUNT(${userJutsu.userId})`.mapWith(Number),
    })
    .from(userJutsu)
    .groupBy(userJutsu.level)
    .where(eq(userJutsu.jutsuId, input.id))
    .orderBy(asc(userJutsu.level));

/** Build the `userJutsu` selection for `getStatistics`, using predicates on `jutsuId`. */
export const selectUserJutsuForGetStatistics2 = (
  client: Pick<DrizzleClient, "select">,
  input: { id: string },
) =>
  client
    .select({ count: sql`count(*)`.mapWith(Number) })
    .from(userJutsu)
    .where(eq(userJutsu.jutsuId, input.id));

/** Build the `userData` selection for `getStatistics`, using predicates on `bloodlineId`. */
export const selectUserDataForGetStatistics = (
  client: Pick<DrizzleClient, "select">,
  input: { id: string },
) =>
  client
    .select({
      level: userData.level,
      count: sql`COUNT(${userData.userId})`.mapWith(Number),
    })
    .from(userData)
    .groupBy(userData.level)
    .where(eq(userData.bloodlineId, input.id))
    .orderBy(asc(userData.level));

/** Build the `userData` selection for `getStatistics`, using predicates on `bloodlineId`. */
export const selectUserDataForGetStatistics2 = (
  client: Pick<DrizzleClient, "select">,
  input: { id: string },
) =>
  client
    .select({ count: sql`count(*)`.mapWith(Number) })
    .from(userData)
    .where(eq(userData.bloodlineId, input.id));

/** Build the distinct owner count of an item for `getStatistics`. */
export const selectUserItemForGetStatistics = (
  client: Pick<DrizzleClient, "select">,
  input: { id: string },
) =>
  client
    .select({ count: countDistinct(userItem.userId) })
    .from(userItem)
    .where(eq(userItem.itemId, input.id));

/** Build the public AI profile lookup for `getStatistics`; player ids yield undefined. */
export const findUserDataForGetStatistics = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.userData.findFirst({
    where: and(eq(userData.userId, input.id), eq(userData.isAi, true)),
    columns: { userId: true, username: true },
  });

/** Build the `visitorLog` deletion for `deleteExpiredVisitorAnalytics`, using predicates on `createdAt`. */
export const deleteVisitorLogForDeleteExpiredVisitorAnalytics = (
  client: Pick<DrizzleClient, "delete">,
  cutoff: Date,
) => client.delete(visitorLog).where(lt(visitorLog.createdAt, cutoff));

/** Build the `abEvent` deletion for `deleteExpiredVisitorAnalytics`, using predicates on `createdAt`. */
export const deleteAbEventForDeleteExpiredVisitorAnalytics = (
  client: Pick<DrizzleClient, "delete">,
  cutoff: Date,
) => client.delete(abEvent).where(lt(abEvent.createdAt, cutoff));
