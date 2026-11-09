import { and, eq, gte, inArray, isNotNull, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { BattleType, RankedRank } from "@/drizzle/constants";
import {
  BattleDataEntryType,
  BattleTypes,
  ItemTypes,
  LetterRanks,
  MAX_PLAYER_LEVEL,
  QuestRewardMetrics,
  QuestTypes,
  RANKED_RANKS,
  RecruitmentMetricMax,
  RecruitmentMetrics,
  StatTypes,
  UserRanks,
} from "@/drizzle/constants";
import {
  abEvent,
  bloodline,
  dataBattleAction,
  item,
  jutsu,
  logBattleLengths,
  logQueueLengths,
  logRankedPicks,
  paypalTransaction,
  quest,
  skillTree,
  userData,
  visitorLog,
} from "@/drizzle/schema";
import { aggregateExperiments } from "@/libs/experimentAnalytics";
import { getRankedRank } from "@/libs/ranked_pvp";
import { collapseRewards } from "@/libs/rewards";
import { isSkillVisible } from "@/libs/skillRequirements";
import { summarizeBattleOutcomes } from "@/libs/statistics";
import { fetchBloodline } from "@/queries/bloodline";
import {
  dateRangeConditions,
  deleteDataBattleActionForDeleteAllDataBattleAction,
  deleteDataBattleActionForDeleteSingleDataBattleAction,
  deleteLogBattleLengthsForClearAllBattleLengths,
  deleteLogQueueLengthsForClearAllQueueLengths,
  findUserDataForGetStatistics,
  insertActionLogForClearAllBattleLengths,
  insertActionLogForClearAllQueueLengths,
  insertActionLogForDeleteAllDataBattleAction,
  insertActionLogForDeleteSingleDataBattleAction,
  isDynamicSignup,
  isReferralChannelSignup,
  listBloodlineForGetBloodlineEffectsBalanceStatistics,
  listItemForGetItemEffectsBalanceStatistics,
  listJutsuForGetJutsuEffectsBalanceStatistics,
  listSkillTreeForGetSkillTreeBalanceStatistics,
  listSkillTreeForGetSkillTreeEffectsBalanceStatistics,
  recruitmentUserConditions,
  selectAbEventForGetAbTests,
  selectBloodlineForGetBloodlineBalanceStatistics,
  selectDataBattleActionForGetAiBalanceStatistics,
  selectDataBattleActionForGetBloodlineBalanceStatistics,
  selectDataBattleActionForGetItemBalanceStatistics,
  selectDataBattleActionForGetJutsuBalanceStatistics,
  selectDataBattleActionForGetStatistics,
  selectDistinctAbEventForGetAbTests,
  selectDistinctReferralSourceForGetReferralSources,
  selectDistinctVisitorLogForGetVisitorUtmSources,
  selectLogBattleLengthsForGetBattleLengthStatistics,
  selectLogQueueLengthsForGetQueueLengthStatistics,
  selectLogRankedPicksForGetRankedLoadoutStatistics,
  selectPaypalTransactionForGetRecruitmentMainMetrics,
  selectPaypalTransactionForGetRevenueByReferralSource,
  selectQuestForGetQuestRewardStatistics,
  selectQuestForGetRecruitmentMainMetrics2,
  selectQuestHistoryForGetRecruitmentMainMetrics2,
  selectUserDataForGetBloodlineBalanceStatistics,
  selectUserDataForGetRankedRankDistributionStatistics,
  selectUserDataForGetRecruitmentDailyCountsBySource,
  selectUserDataForGetRecruitmentDailyCountsBySource2,
  selectUserDataForGetRecruitmentDailyCountsBySource3,
  selectUserDataForGetRecruitmentDailyLevelStats,
  selectUserDataForGetRecruitmentLevelDistribution,
  selectUserDataForGetRecruitmentLevelDistribution2,
  selectUserDataForGetRecruitmentLevelDistribution3,
  selectUserDataForGetRecruitmentLevelDistribution4,
  selectUserDataForGetStatistics,
  selectUserItemForGetItemBalanceStatistics,
  selectUserItemForGetStatistics,
  selectUserJutsuForGetJutsuBalanceStatistics,
  selectUserJutsuForGetStatistics,
  selectUserSkillForGetSkillTreeBalanceStatistics,
  selectVisitorLogForGetRecruitmentMainMetrics,
  selectVisitorLogForGetRecruitmentMainMetrics2,
  selectVisitorLogForGetRecruitmentMainMetrics3,
  selectVisitorLogForGetRecruitmentMainMetrics4,
  selectVisitorLogForGetRecruitmentMainMetrics5,
  selectVisitorLogForGetRecruitmentMainMetrics6,
  selectVisitorLogForGetRecruitmentMainMetrics7,
} from "@/queries/data";
import { fetchItem } from "@/queries/item";
import { fetchJutsu } from "@/queries/jutsu";
import { fetchUser, fetchViewerRole } from "@/queries/profile";

import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
  serverError,
} from "@/server/api/trpc";
import { fetchPublicUsers } from "@/server/utils/profile";
import { fetchSanninRankedPlayers } from "@/server/utils/ranked";
import { type DeviceType, getDeviceType } from "@/utils/hardware";
import {
  canAccessHiddenSkillTree,
  canChangeContent,
  canViewRecruitmentAnalytics,
  canViewRevenueAnalytics,
} from "@/utils/permissions";
import type { QueryCondition } from "@/utils/typeutils";
import { bloodlineFilteringSchema } from "@/validators/bloodline";
import { itemFilteringSchema } from "@/validators/item";
import { jutsuFilteringSchema } from "@/validators/jutsu";
import { rewardPayloads } from "@/validators/rewardPackages";
import { skillTreeFilteringSchema } from "@/validators/skillTree";
import { getPublicUsersSchema } from "@/validators/user";
import { bloodlineDatabaseFilter } from "./bloodline";
import { itemDatabaseFilter } from "./item";
import { jutsuDatabaseFilter } from "./jutsu";
import { skillTreeDatabaseFilter } from "./skillTree";

export const dataRouter = createTRPCRouter({
  /** Return full-history variant counts for tests with an event in the last week. */
  getAbTests: protectedProcedure
    .input(
      z.object({
        utmSource: z.string().max(191).optional(),
        deviceType: z.array(z.enum(["mobile", "desktop", "unknown"])).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!canViewRecruitmentAnalytics(user.role)) {
        throw serverError("UNAUTHORIZED", "Insufficient permissions to get AB tests");
      }
      // Query
      // Recent activity selects experiments; their cohorts include all history.
      const activeExperiments = selectDistinctAbEventForGetAbTests(ctx.drizzle);
      const whereConds: QueryCondition[] = [
        inArray(abEvent.experiment, activeExperiments),
      ];
      if (input.utmSource) whereConds.push(eq(abEvent.source, input.utmSource));

      // Join completions to filtered exposures: a later completion belongs to the
      // first-visit cohort, without loading successes from unrelated experiments.
      // The unique experiment/event/IP key prevents non-null IPs from fanning out.
      // Aggregate exposure user-agent cohorts before transferring retained history.

      const rows = await selectAbEventForGetAbTests(ctx.drizzle, whereConds);

      return aggregateExperiments(rows, input.deviceType);
    }),
  // Visitor analytics
  getVisitorUtmSources: protectedProcedure.query(async ({ ctx }) => {
    // Query
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    // Guard
    if (!canViewRecruitmentAnalytics(user.role)) {
      return [];
    }
    // Query
    const rows = await selectDistinctVisitorLogForGetVisitorUtmSources(ctx.drizzle);
    return rows
      .map((r) => r.utmSource)
      .filter((v): v is string => typeof v === "string");
  }),
  getRecruitmentMainMetrics: protectedProcedure
    .input(
      z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        utmSource: z.string().optional(),
        deviceType: z.array(z.enum(["mobile", "desktop", "unknown"])).optional(),
        includeTutorialDisabled: z.boolean().optional(),
        includeTierTutorialDisabled: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!canViewRecruitmentAnalytics(user.role)) {
        throw serverError(
          "UNAUTHORIZED",
          "Insufficient permissions to get recruitment main metrics",
        );
      }
      // Filtering
      const visitorWhere = dateRangeConditions(visitorLog.createdAt, input);
      if (input.utmSource) {
        visitorWhere.push(eq(visitorLog.utmSource, input.utmSource));
      } else {
        visitorWhere.push(ne(visitorLog.utmSource, ""));
      }

      const [
        allVisitorsRowRaw,
        signupsRowRaw,
        nonStudentSignupsRowRaw,
        nonStudentGeninSignupsRowRaw,
        pvpSignupsRowRaw,
        tutorialFinishedSignupsRowRaw,
        totalRevenueRowRaw,
        allTimeSignupsForValueRaw,
        tierQuests,
        completedTierQuestsRaw,
      ] = await Promise.all([
        // allVisitorsRow (with userAgent for device splitting)
        selectVisitorLogForGetRecruitmentMainMetrics(ctx.drizzle, visitorWhere),
        // signupsRow: users with an entry in ReferralSource (mapped via historical IP to the visit)
        selectVisitorLogForGetRecruitmentMainMetrics2(ctx.drizzle, visitorWhere, input),
        // nonStudentSignupsRow: fetch individual users beyond STUDENT rank
        selectVisitorLogForGetRecruitmentMainMetrics3(ctx.drizzle, visitorWhere),
        // nonStudentGeninSignupsRow: fetch individual users with userAgent for device splitting
        selectVisitorLogForGetRecruitmentMainMetrics4(ctx.drizzle, visitorWhere),
        // pvpSignupsRow: fetch individual users with userAgent for device splitting
        selectVisitorLogForGetRecruitmentMainMetrics5(ctx.drizzle, visitorWhere),
        // tutorialFinishedSignupsRow: fetch individual users with userAgent for device splitting
        selectVisitorLogForGetRecruitmentMainMetrics6(ctx.drizzle, visitorWhere),
        // totalRevenueRow: fetch individual transactions with userAgent for device splitting
        selectPaypalTransactionForGetRecruitmentMainMetrics(ctx.drizzle, input),
        // allTimeSignupsForValue: all-time signups count for signupValueUsd (no time filter, only utmSource)
        selectVisitorLogForGetRecruitmentMainMetrics7(ctx.drizzle, input),
        // tierQuests: Fetch all tier quests ordered by tierLevel
        selectQuestForGetRecruitmentMainMetrics2(ctx.drizzle),
        // completedTierQuests: Fetch completed tier quests for users who finished tutorial
        selectQuestHistoryForGetRecruitmentMainMetrics2(
          ctx.drizzle,
          visitorWhere,
          input,
        ),
      ]);

      // Filter the different rows by device type if specified
      const inDevices = (row: { userAgent: string | null }) =>
        matchesDevice(row, input.deviceType);
      const allVisitorsRow = allVisitorsRowRaw.filter(inDevices);
      const signupsRow = signupsRowRaw.filter(inDevices);
      // The referral join requires an account, so every signup has created a character.
      const characterCreationsRow = signupsRow;
      const nonStudentSignupsRow = nonStudentSignupsRowRaw.filter(inDevices);
      const nonStudentGeninSignupsRow = nonStudentGeninSignupsRowRaw.filter(inDevices);
      const pvpSignupsRow = pvpSignupsRowRaw.filter(inDevices);
      const tutorialFinishedSignupsRow =
        tutorialFinishedSignupsRowRaw.filter(inDevices);

      // Calculate device-split metrics
      const visitorsByDevice = countByDevice(allVisitorsRow);
      const signupsByDevice = countByDevice(signupsRow);
      const characterCreationsByDevice = countByDevice(characterCreationsRow);
      const tutorialFinishedByDevice = countByDevice(tutorialFinishedSignupsRow);

      const clicks = allVisitorsRow.length;
      const signups = signupsRow.length;
      const characterCreations = characterCreationsRow.length;
      const signupRate = clicks > 0 ? signups / clicks : 0;
      const characterCreationRate = clicks > 0 ? characterCreations / clicks : 0;
      const pvpSignups = pvpSignupsRow.length;
      const tutorialFinishedSignups = tutorialFinishedSignupsRow.length;
      // Calculate all-time revenue and signup value (no time/device filters, only utmSource)
      const totalRevenueUsd = totalRevenueRowRaw.reduce(
        (acc, row) => acc + (row.amount ?? 0),
        0,
      );
      const allTimeSignupsForValue = new Set(
        allTimeSignupsForValueRaw.map((r) => r.userId),
      ).size;
      const signupValueUsd =
        allTimeSignupsForValue > 0 ? totalRevenueUsd / allTimeSignupsForValue : 0;

      // Extract tutorial steps for each signup with device type and username
      // By default, exclude users who have disabled the tutorial (tutorialOn = false)
      const tutorialFilteredSignups = input.includeTutorialDisabled
        ? signupsRow
        : signupsRow.filter((r) => r.tutorialOn !== false);
      const tutorialSteps = tutorialFilteredSignups.map((r) => ({
        steps: r.tutorialStep ?? 0,
        deviceType: getDeviceType(r.userAgent ?? undefined),
        username: r.username ?? "",
      }));

      // Rank progression metrics
      const nonStudentSignups = nonStudentSignupsRow.length;
      const nonStudentGeninSignups = nonStudentGeninSignupsRow.length;

      // Create a map of userId -> Set of completed tier quest IDs
      const completedTierQuestsMap = new Map<string, Set<string>>();
      completedTierQuestsRaw.forEach((cq) => {
        if (!completedTierQuestsMap.has(cq.userId)) {
          completedTierQuestsMap.set(cq.userId, new Set());
        }
        completedTierQuestsMap.get(cq.userId)?.add(cq.questId);
      });

      // Get set of users who finished the tutorial
      const tierEligibleUserIds = new Set(
        tutorialFinishedSignupsRow.map((r) => r.userId),
      );

      // For each eligible user, count how many tier quests they've completed
      const tierQuestCompletions = signupsRow
        .filter((r) => r.userId && tierEligibleUserIds.has(r.userId))
        .map((r) => {
          const userId = r.userId ?? "";
          const completedTierQuestIds = completedTierQuestsMap.get(userId) ?? new Set();
          return {
            completedTiers: completedTierQuestIds.size,
            deviceType: getDeviceType(r.userAgent ?? undefined),
            username: r.username ?? "",
          };
        });

      // Get tier quest info for descriptions (name + description)
      const tierQuestDescriptions = tierQuests.map(
        (tq) => `${tq.name}: ${tq.description}`,
      );

      return {
        signupRate,
        visitors: clicks,
        visitorsByDevice,
        signups,
        signupsByDevice,
        characterCreations,
        characterCreationRate,
        characterCreationsByDevice,
        pvpSignups,
        tutorialFinishedSignups,
        tutorialFinishedByDevice,
        signupValueUsd,
        totalRevenueUsd,
        tutorialSteps,
        nonStudentSignups,
        nonStudentGeninSignups,
        tierQuestCompletions,
        tierQuestDescriptions,
      };
    }),
  // Recruitment analytics
  getReferralSources: protectedProcedure.query(async ({ ctx }) => {
    // Query
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    // Guard
    if (!canViewRecruitmentAnalytics(user.role)) {
      return [];
    }
    // Query
    const rows = await selectDistinctReferralSourceForGetReferralSources(ctx.drizzle);
    const base = rows.map((r) => r.source);
    const set = new Set(base);
    set.add("Dynamic");
    set.add("Recruited");
    return Array.from(set.values());
  }),
  getRevenueByReferralSource: protectedProcedure
    .input(
      z.object({ startDate: z.string().optional(), endDate: z.string().optional() }),
    )
    .query(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!canViewRevenueAnalytics(user.role)) {
        throw serverError(
          "UNAUTHORIZED",
          "Insufficient permissions to get revenue by referral source",
        );
      }
      // Filtering - uses visitorLog approach to match totalRevenueUsd logic
      const whereConditions: QueryCondition[] = [
        isNotNull(visitorLog.utmSource),
        ne(visitorLog.utmSource, ""),
        eq(userData.isAi, false),
        gte(userData.createdAt, visitorLog.createdAt),
      ];
      whereConditions.push(
        inArray(paypalTransaction.status, ["COMPLETED", "REVIEW_REQUIRED"]),
        ...dateRangeConditions(paypalTransaction.createdAt, input),
      );

      // Query revenue grouped by utmSource using visitorLog tracking
      const rows = await selectPaypalTransactionForGetRevenueByReferralSource(
        ctx.drizzle,
        whereConditions,
      );

      return rows.map((r) => ({
        source: r.source ?? "",
        totalUsd: r.totalUsd ?? 0,
      }));
    }),
  getRecruitmentLevelDistribution: protectedProcedure
    .input(
      z.object({
        sources: z.array(z.string()).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        metric: z.enum(RecruitmentMetrics).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!canViewRecruitmentAnalytics(user.role)) {
        throw serverError(
          "UNAUTHORIZED",
          "Insufficient permissions to get recruitment level distribution",
        );
      }
      // Filtering
      const { selected, realSources, wantsDynamic, wantsRecruited, wantReal } =
        parseRecruitmentSources(input.sources);
      const metric = input.metric ?? "level";

      // Base where clauses shared by all branches
      const baseUserWhere = recruitmentUserConditions(input);

      // Referrals-specific where
      const realWhere: QueryCondition[] = [
        ...baseUserWhere,
        isReferralChannelSignup(realSources),
      ];
      // Dynamic and Recruited specifics
      const dynamicWhere: QueryCondition[] = [
        ...baseUserWhere,
        isDynamicSignup(ctx.drizzle),
      ];
      const recruitedWhere: QueryCondition[] = [
        ...baseUserWhere,
        isNotNull(userData.recruiterId),
      ];

      // Quest counts come from QuestHistory, so clampedExpr goes unused for that metric
      const metricColumn =
        metric === "completedQuests" ? userData.level : userData[metric];

      const clampMax = RecruitmentMetricMax[metric];
      const clampedExpr = sql<number>`LEAST(GREATEST(${metricColumn}, 0), ${clampMax})`;

      // Small helpers to aggregate per-user rows into level counts
      const aggregateCounts = (rows: { level: number; userId: string }[]) => {
        const counts = new Map<number, number>();
        rows.forEach((r) => {
          counts.set(r.level, (counts.get(r.level) ?? 0) + 1);
        });
        return Array.from(counts.entries()).map(([level, count]) => ({ level, count }));
      };
      const aggregateCountsBySource = (
        rows: { source: string; level: number; userId: string }[],
      ) => {
        const bySource = new Map<string, Map<number, number>>();
        rows.forEach((r) => {
          if (!bySource.has(r.source)) bySource.set(r.source, new Map());
          const inner = bySource.get(r.source);
          if (!inner) return;
          inner.set(r.level, (inner.get(r.level) ?? 0) + 1);
        });
        const out: { source: string; level: number; count: number }[] = [];
        bySource.forEach((lvlMap, src) => {
          lvlMap.forEach((cnt, lvl) => {
            out.push({ source: src, level: lvl, count: cnt });
          });
        });
        return out;
      };

      // Referred users from various sources
      const realPromise = wantReal
        ? metric !== "completedQuests"
          ? selectUserDataForGetRecruitmentLevelDistribution(
              ctx.drizzle,
              clampedExpr,
              realWhere,
            )
          : selectUserDataForGetRecruitmentLevelDistribution2(
              ctx.drizzle,
              realWhere,
            ).then((rows) =>
              aggregateCountsBySource(
                rows as { source: string; level: number; userId: string }[],
              ),
            )
        : Promise.resolve([] as { source: string; level: number; count: number }[]);

      // Dynamic signups (non recruited or from referral sources)
      const dynPromise =
        !selected || wantsDynamic
          ? metric !== "completedQuests"
            ? selectUserDataForGetRecruitmentLevelDistribution3(
                ctx.drizzle,
                clampedExpr,
                dynamicWhere,
              )
            : selectUserDataForGetRecruitmentLevelDistribution4(
                ctx.drizzle,
                dynamicWhere,
              ).then((rows) =>
                aggregateCounts(rows as { level: number; userId: string }[]),
              )
          : Promise.resolve([] as { level: number; count: number }[]);

      // Recruited users
      const recruitedPromise =
        !selected || wantsRecruited
          ? metric !== "completedQuests"
            ? selectUserDataForGetRecruitmentLevelDistribution3(
                ctx.drizzle,
                clampedExpr,
                recruitedWhere,
              )
            : selectUserDataForGetRecruitmentLevelDistribution4(
                ctx.drizzle,
                recruitedWhere,
              ).then((rows) =>
                aggregateCounts(rows as { level: number; userId: string }[]),
              )
          : Promise.resolve([] as { level: number; count: number }[]);

      const [rows, dynamicRows, recruitedRows] = await Promise.all([
        realPromise,
        dynPromise,
        recruitedPromise,
      ]);

      // Group result by source for frontend
      const bySource = new Map<string, { level: number; count: number }[]>();
      if (rows.length > 0) {
        rows.forEach((r) => {
          if (!bySource.has(r.source)) bySource.set(r.source, []);
          bySource.get(r.source)?.push({ level: r.level, count: r.count });
        });
      }
      if (dynamicRows.length > 0) {
        bySource.set("Dynamic", dynamicRows);
      }
      if (recruitedRows.length > 0) {
        bySource.set("Recruited", recruitedRows);
      }
      return Array.from(bySource.entries()).map(([source, levelDistribution]) => ({
        source,
        levelDistribution,
      }));
    }),
  getRecruitmentDailyLevelStats: protectedProcedure
    .input(
      z.object({
        sources: z.array(z.string()).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!canViewRecruitmentAnalytics(user.role)) {
        throw serverError(
          "UNAUTHORIZED",
          "Insufficient permissions to get recruitment daily level stats",
        );
      }
      // Filtering
      const { selected, realSources, wantsDynamic, wantsRecruited } =
        parseRecruitmentSources(input.sources);
      const dayExpr = sql<string>`CAST(${userData.createdAt} AS DATE)`;

      // No selection: only users with a referral source
      const rows = await selectUserDataForGetRecruitmentDailyLevelStats(
        ctx.drizzle,
        dayExpr,
        selected,
        input,
        realSources,
        wantsDynamic,
        wantsRecruited,
      );
      return rows.map((r) => ({
        date: r.day as unknown as string,
        mean: Number(r.mean ?? 0),
        std: Number(r.std ?? 0),
        count: Number(r.count ?? 0),
      }));
    }),
  getRecruitmentDailyCountsBySource: protectedProcedure
    .input(
      z.object({
        sources: z.array(z.string()).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!canViewRecruitmentAnalytics(user.role)) {
        throw serverError(
          "UNAUTHORIZED",
          "Insufficient permissions to get recruitment daily counts by source",
        );
      }
      // Filtering
      const { selected, realSources, wantsDynamic, wantsRecruited, wantReal } =
        parseRecruitmentSources(input.sources);

      const dayExpr = sql<string>`CAST(${userData.createdAt} AS DATE)`;

      // Referred series
      const realWhere = [
        ...recruitmentUserConditions(input),
        isReferralChannelSignup(realSources),
      ];

      const realPromise = wantReal
        ? selectUserDataForGetRecruitmentDailyCountsBySource(
            ctx.drizzle,
            dayExpr,
            realWhere,
          )
        : Promise.resolve([] as { day: string; source: string; count: number }[]);

      // Dynamic series
      const dynPromise =
        !selected || wantsDynamic
          ? selectUserDataForGetRecruitmentDailyCountsBySource2(
              ctx.drizzle,
              dayExpr,
              input,
            )
          : Promise.resolve([] as { day: string; count: number }[]);

      const recPromise =
        !selected || wantsRecruited
          ? selectUserDataForGetRecruitmentDailyCountsBySource3(
              ctx.drizzle,
              dayExpr,
              input,
            )
          : Promise.resolve([] as { day: string; count: number }[]);

      const [rows, dynamicRows, recruitedRows] = await Promise.all([
        realPromise,
        dynPromise,
        recPromise,
      ]);

      const bySource = new Map<string, { date: string; count: number }[]>();
      rows.forEach((r) => {
        if (!bySource.has(r.source)) bySource.set(r.source, []);
        bySource.get(r.source)?.push({ date: r.day, count: r.count });
      });
      if (dynamicRows.length > 0) {
        bySource.set(
          "Dynamic",
          dynamicRows.map((r) => ({ date: r.day, count: r.count })),
        );
      }
      if (recruitedRows.length > 0) {
        bySource.set(
          "Recruited",
          recruitedRows.map((r) => ({ date: r.day, count: r.count })),
        );
      }

      return Array.from(bySource.entries()).map(([source, series]) => ({
        source,
        series,
      }));
    }),
  deleteSingleDataBattleAction: protectedProcedure
    .input(
      z.object({
        contentId: z.string(),
        type: z.enum(BattleDataEntryType),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!canChangeContent(user.role)) {
        return errorResponse("You are not allowed to delete data battle actions");
      }
      // Delete
      await Promise.all([
        deleteDataBattleActionForDeleteSingleDataBattleAction(ctx.drizzle, input),
        insertActionLogForDeleteSingleDataBattleAction(ctx.drizzle, ctx, input),
      ]);
      return { success: true, message: "Data battle action deleted" };
    }),
  deleteAllDataBattleAction: protectedProcedure
    .input(z.object({ type: z.enum(BattleDataEntryType) }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!canChangeContent(user.role)) {
        return errorResponse("You are not allowed to delete data battle actions");
      }
      // Delete
      await Promise.all([
        deleteDataBattleActionForDeleteAllDataBattleAction(ctx.drizzle, input),
        insertActionLogForDeleteAllDataBattleAction(ctx.drizzle, ctx, input),
      ]);
      return { success: true, message: "Data battle action deleted" };
    }),
  getBloodlineBalanceStatistics: publicProcedure
    .input(
      z.object({
        battleTypes: z.array(z.enum(BattleTypes)).optional(),
        minCount: z.number().min(1).default(1),
        bloodlineRanks: z.array(z.enum(LetterRanks)).optional(),
        statClassifications: z.array(z.enum(StatTypes)).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Build where conditions for battle data
      const whereConditions: QueryCondition[] = [
        eq(dataBattleAction.type, "bloodline"),
      ];

      // Add battle type filter
      if (input.battleTypes && input.battleTypes.length > 0) {
        whereConditions.push(inArray(dataBattleAction.battleType, input.battleTypes));
      }

      // Build bloodline rank filter if needed
      const bloodlineWhereConditions: QueryCondition[] = [];
      if (input.bloodlineRanks && input.bloodlineRanks.length > 0) {
        bloodlineWhereConditions.push(inArray(bloodline.rank, input.bloodlineRanks));
      }

      // Build stat classification filter if needed
      if (input.statClassifications && input.statClassifications.length > 0) {
        bloodlineWhereConditions.push(
          inArray(bloodline.statClassification, input.statClassifications),
        );
      }

      // Run all queries in parallel for efficiency
      const [allBloodlines, userCounts, battleStats] = await Promise.all([
        // Get all bloodlines (filtered by rank/classification if specified)
        selectBloodlineForGetBloodlineBalanceStatistics(
          ctx.drizzle,
          bloodlineWhereConditions,
        ),

        // Get user counts per bloodline
        selectUserDataForGetBloodlineBalanceStatistics(ctx.drizzle),

        // Get battle statistics
        selectDataBattleActionForGetBloodlineBalanceStatistics(
          ctx.drizzle,
          whereConditions,
          input,
        ),
      ]);

      // Create maps for quick lookup
      const userCountMap = new Map(
        userCounts.map((item) => [item.bloodlineId, item.userCount]),
      );

      // Group battle stats by bloodline
      const battleStatsMap = new Map<
        string,
        Array<{ battleWon: number; count: number }>
      >();
      battleStats.forEach((stat) => {
        if (!battleStatsMap.has(stat.bloodlineId)) {
          battleStatsMap.set(stat.bloodlineId, []);
        }
        battleStatsMap.get(stat.bloodlineId)?.push({
          battleWon: stat.battleWon,
          count: stat.count,
        });
      });

      // Create result for each bloodline
      return allBloodlines.map((bloodline) => {
        const userCount = userCountMap.get(bloodline.id) || 0;
        const battleData = battleStatsMap.get(bloodline.id) || [];

        return {
          name: bloodline.name,
          bloodlineId: bloodline.id,
          userCount,
          ...summarizeBattleOutcomes(battleData),
        };
      });
    }),
  getJutsuBalanceStatistics: publicProcedure
    .input(
      z.object({
        battleTypes: z.array(z.enum(BattleTypes)).optional(),
        minCount: z.number().min(1).default(1),
        jutsuEffects: z.array(z.string()).optional(),
        bloodlineIds: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Build where conditions
      const whereConditions = contentBalanceConditions("jutsu", input);

      // Keep only actions used at least minCount times
      const havingClause = gte(sql`SUM(${dataBattleAction.count})`, input.minCount);

      // Build effect filter if needed
      if (input.jutsuEffects && input.jutsuEffects.length > 0) {
        whereConditions.push(
          or(
            ...input.jutsuEffects.map(
              (effect) =>
                sql`JSON_SEARCH(${jutsu.effects}, 'one', ${effect}, NULL, '$[*].type') IS NOT NULL`,
            ),
          ),
        );
      }

      // Run equippedCounts and usage queries in parallel for efficiency
      const [equippedCounts, usage] = await Promise.all([
        selectUserJutsuForGetJutsuBalanceStatistics(ctx.drizzle),
        selectDataBattleActionForGetJutsuBalanceStatistics(
          ctx.drizzle,
          whereConditions,
          havingClause,
        ),
      ]);

      // Create a map for quick lookup
      const equippedCountMap = new Map(
        equippedCounts.map((item) => [item.jutsuId, item.equippedCount]),
      );

      // Add equipped count to each result
      return usage.map((item) => ({
        ...item,
        equippedCount: equippedCountMap.get(item.jutsuId) || 0,
      }));
    }),
  getJutsuEffectsBalanceStatistics: publicProcedure
    .input(jutsuFilteringSchema)
    .query(async ({ ctx, input }) => {
      // Guard
      const effects = input.effect;
      if (!effects || effects.length === 0) {
        return [];
      }
      // Build where conditions
      const baseFilters = jutsuDatabaseFilter(input);
      // Fetch results
      const results = await listJutsuForGetJutsuEffectsBalanceStatistics(
        ctx.drizzle,
        baseFilters,
      );
      return results.map((jutsu) => ({
        ...jutsu,
        effects: jutsu.effects.filter((effect) => effects.includes(effect.type)),
      }));
    }),
  getItemEffectsBalanceStatistics: publicProcedure
    .input(itemFilteringSchema.omit({ limit: true }))
    .query(async ({ ctx, input }) => {
      // Guard
      const effects = input.effect;
      if (!effects || effects.length === 0) {
        return [];
      }
      // Build where conditions
      const baseFilters = itemDatabaseFilter(input);
      // Fetch results
      const results = await listItemForGetItemEffectsBalanceStatistics(
        ctx.drizzle,
        baseFilters,
      );
      return results.map((item) => ({
        ...item,
        effects: item.effects.filter((effect) => effects.includes(effect.type)),
      }));
    }),
  getBloodlineEffectsBalanceStatistics: publicProcedure
    .input(bloodlineFilteringSchema)
    .query(async ({ ctx, input }) => {
      // Guard
      const effects = input.effect;
      if (!effects || effects.length === 0) {
        return [];
      }
      // Build where conditions
      const baseFilters = bloodlineDatabaseFilter(input);
      // Fetch results
      const results = await listBloodlineForGetBloodlineEffectsBalanceStatistics(
        ctx.drizzle,
        baseFilters,
      );
      return results.map((bloodline) => ({
        ...bloodline,
        effects: bloodline.effects.filter((effect) => effects.includes(effect.type)),
      }));
    }),
  getAiEffectsBalanceStatistics: publicProcedure
    .input(getPublicUsersSchema.extend({ effect: z.array(z.string()) }))
    .query(async ({ ctx, input }) => {
      // Use the existing fetchPublicUsers function with AI-specific modifications
      const aiUsers = await fetchPublicUsers({
        client: ctx.drizzle,
        input,
        includeEffects: true,
      });

      // Process results to extract effects
      const results = aiUsers.data.flatMap((ai) => {
        const aiEffects = "effects" in ai && ai.effects ? ai.effects : [];
        const jutsuEffects =
          "jutsus" in ai && ai.jutsus
            ? ai.jutsus.flatMap((uj) =>
                "jutsu" in uj ? (uj.jutsu?.effects ?? []) : [],
              )
            : [];
        const itemEffects =
          "items" in ai && ai.items
            ? ai.items.flatMap((ui) => ("item" in ui ? (ui.item?.effects ?? []) : []))
            : [];
        const effects = [
          ...aiEffects.map((e) => ({ ...e, origin: "ai" })),
          ...jutsuEffects.map((e) => ({ ...e, origin: "jutsu" })),
          ...itemEffects.map((e) => ({ ...e, origin: "item" })),
        ];
        return effects
          .filter((effect) => input.effect.includes(effect.type))
          .map((effect) => ({
            id: ai.userId,
            name: ai.username,
            rank: ai.rank,
            level: ai.level,
            origin: effect.origin,
            villageId: ai.villageId,
            effect: effect.type,
            power: effect.power,
            rounds: effect.rounds,
            powerPerLevel: effect.powerPerLevel,
          }));
      });

      return results;
    }),
  getSkillTreeBalanceStatistics: publicProcedure
    .input(
      z.object({
        minCount: z.number().min(1).default(1),
        skillEffects: z.array(z.string()).optional(),
        tiers: z.array(z.number()).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Build where conditions for skill tree data
      const whereConditions: QueryCondition[] = [];

      // Build skill effect filter if needed
      if (input.skillEffects && input.skillEffects.length > 0) {
        whereConditions.push(
          or(
            ...input.skillEffects.map(
              (effect) =>
                sql`JSON_SEARCH(${skillTree.effects}, 'one', ${effect}, NULL, '$[*].type') IS NOT NULL`,
            ),
          ),
        );
      }

      // Build tier filter if needed
      if (input.tiers && input.tiers.length > 0) {
        whereConditions.push(inArray(skillTree.tier, input.tiers));
      }

      // Run userCounts and skill queries in parallel for efficiency
      const [viewerRole, userCounts, skills] = await Promise.all([
        fetchViewerRole(ctx.drizzle, ctx.userId),
        // Get user counts per skill
        selectUserSkillForGetSkillTreeBalanceStatistics(ctx.drizzle),

        // Get all skills (filtered by effects/tiers if specified)
        listSkillTreeForGetSkillTreeBalanceStatistics(ctx.drizzle, whereConditions),
      ]);
      const includeHidden = canAccessHiddenSkillTree(viewerRole);

      // Create a map for quick lookup
      const userCountMap = new Map(
        userCounts.map((item) => [item.skillId, item.userCount]),
      );

      // Create result for each skill
      return skills
        .filter((skill) => isSkillVisible(skill, includeHidden))
        .map((skill) => {
          const userCount = userCountMap.get(skill.id) || 0;

          return {
            name: skill.name,
            skillId: skill.id,
            tier: skill.tier,
            costSkillPoints: skill.costSkillPoints,
            userCount,
            effects: skill.effects,
          };
        })
        .filter((skill) => skill.userCount >= input.minCount)
        .sort((a, b) => b.userCount - a.userCount);
    }),
  getSkillTreeEffectsBalanceStatistics: publicProcedure
    .input(skillTreeFilteringSchema)
    .query(async ({ ctx, input }) => {
      // Build where conditions
      const baseFilters = skillTreeDatabaseFilter(input);
      // Fetch results
      const [viewerRole, results] = await Promise.all([
        fetchViewerRole(ctx.drizzle, ctx.userId),
        listSkillTreeForGetSkillTreeEffectsBalanceStatistics(ctx.drizzle, baseFilters),
      ]);
      return results
        .filter((skill) => isSkillVisible(skill, canAccessHiddenSkillTree(viewerRole)))
        .map(({ id, name, tier, costSkillPoints, effects }) => ({
          id,
          name,
          tier,
          costSkillPoints,
          effects,
        }));
    }),
  getItemBalanceStatistics: publicProcedure
    .input(
      z.object({
        battleTypes: z.array(z.enum(BattleTypes)).optional(),
        minCount: z.number().min(1).default(1),
        itemTypes: z.array(z.enum(ItemTypes)).optional(),
        bloodlineIds: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Build where conditions
      const whereConditions = contentBalanceConditions("item", input);

      // Keep only actions used at least minCount times
      const havingClause = gte(sql`SUM(${dataBattleAction.count})`, input.minCount);

      // Build item type filter if needed
      if (input.itemTypes && input.itemTypes.length > 0) {
        whereConditions.push(inArray(item.itemType, input.itemTypes));
      }

      // Run equippedCounts and usage queries in parallel for efficiency
      const [equippedCounts, usage] = await Promise.all([
        selectUserItemForGetItemBalanceStatistics(ctx.drizzle),
        selectDataBattleActionForGetItemBalanceStatistics(
          ctx.drizzle,
          whereConditions,
          havingClause,
        ),
      ]);

      // Create a map for quick lookup
      const equippedCountMap = new Map(
        equippedCounts.map((item) => [item.itemId, item.equippedCount]),
      );

      // Add equipped count to each result
      return usage.map((item) => ({
        ...item,
        equippedCount: equippedCountMap.get(item.itemId) || 0,
      }));
    }),
  getAiBalanceStatistics: publicProcedure
    .input(
      z.object({
        battleTypes: z.array(z.enum(BattleTypes)).optional(),
        minCount: z.number().min(1).default(1),
        userRanks: z.array(z.enum(UserRanks)).optional(),
        villages: z.array(z.string()).optional(),
        minLevel: z.number().min(1).default(1),
        maxLevel: z.number().max(MAX_PLAYER_LEVEL).default(MAX_PLAYER_LEVEL),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Build where conditions
      const whereConditions: QueryCondition[] = [eq(dataBattleAction.type, "ai")];

      // Add battle type filter
      if (input.battleTypes && input.battleTypes.length > 0) {
        whereConditions.push(inArray(dataBattleAction.battleType, input.battleTypes));
      }

      // Keep only actions used at least minCount times
      const havingClause = gte(sql`SUM(${dataBattleAction.count})`, input.minCount);

      // Build user rank filter if needed
      if (input.userRanks && input.userRanks.length > 0) {
        whereConditions.push(inArray(userData.rank, input.userRanks));
      }

      // Build village filter if needed
      if (input.villages && input.villages.length > 0) {
        whereConditions.push(inArray(userData.villageId, input.villages));
      }

      // Build level range filter
      whereConditions.push(
        and(gte(userData.level, input.minLevel), lte(userData.level, input.maxLevel)),
      );

      const [usage] = await Promise.all([
        selectDataBattleActionForGetAiBalanceStatistics(
          ctx.drizzle,
          whereConditions,
          havingClause,
        ),
      ]);

      return usage;
    }),
  getBattleLengthStatistics: publicProcedure
    .meta({
      mcp: { description: "Get battle length distribution data" },
    })
    .input(
      z.object({
        battleTypes: z.array(z.enum(BattleTypes)).optional(),
        minCount: z.number().min(1).default(1),
        minWinnerLevel: z.number().min(1).max(MAX_PLAYER_LEVEL).optional(),
        maxWinnerLevel: z.number().min(1).max(MAX_PLAYER_LEVEL).optional(),
        minLoserLevel: z.number().min(1).max(MAX_PLAYER_LEVEL).optional(),
        maxLoserLevel: z.number().min(1).max(MAX_PLAYER_LEVEL).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Build where conditions
      const whereConditions: QueryCondition[] = [];

      // Add battle type filter
      if (input.battleTypes && input.battleTypes.length > 0) {
        whereConditions.push(inArray(logBattleLengths.battleType, input.battleTypes));
      }

      // Add winner level filters
      if (input.minWinnerLevel) {
        whereConditions.push(gte(logBattleLengths.winnerLevel, input.minWinnerLevel));
      }
      if (input.maxWinnerLevel) {
        whereConditions.push(lte(logBattleLengths.winnerLevel, input.maxWinnerLevel));
      }

      // Add loser level filters
      if (input.minLoserLevel) {
        whereConditions.push(gte(logBattleLengths.loserLevel, input.minLoserLevel));
      }
      if (input.maxLoserLevel) {
        whereConditions.push(lte(logBattleLengths.loserLevel, input.maxLoserLevel));
      }

      // Perform the filter by minimum count
      const havingClause = gte(sql`SUM(${logBattleLengths.count})`, input.minCount);

      // Fetch battle length data
      const battleLengthsRaw = await selectLogBattleLengthsForGetBattleLengthStatistics(
        ctx.drizzle,
        whereConditions,
        havingClause,
      );

      // Normalize counts per battleType
      const totalCountsByType = battleLengthsRaw.reduce<Record<string, number>>(
        (acc, entry) => {
          acc[entry.battleType] = (acc[entry.battleType] ?? 0) + (entry.count ?? 0);
          return acc;
        },
        {},
      );

      const battleLengths = battleLengthsRaw.map((entry) => ({
        ...entry,
        normalized:
          (totalCountsByType[entry.battleType] ?? 0) > 0
            ? (entry.count ?? 0) / (totalCountsByType?.[entry.battleType] ?? 0)
            : 0,
      }));

      return battleLengths;
    }),
  getQueueLengthStatistics: publicProcedure
    .input(
      z.object({
        rankedRanks: z.array(z.enum(RANKED_RANKS)).optional(),
        minCount: z.number().min(1).default(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Build where conditions
      const whereConditions: QueryCondition[] = [];

      // Add ranked rank filter
      if (input.rankedRanks && input.rankedRanks.length > 0) {
        whereConditions.push(inArray(logQueueLengths.rankedRank, input.rankedRanks));
      }

      // Perform the filter by minimum count
      const havingClause = gte(sql`SUM(${logQueueLengths.count})`, input.minCount);

      // Fetch queue length data
      const queueLengths = await selectLogQueueLengthsForGetQueueLengthStatistics(
        ctx.drizzle,
        whereConditions,
        havingClause,
      );

      return queueLengths;
    }),
  clearAllBattleLengths: protectedProcedure
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!canChangeContent(user.role)) {
        return errorResponse("You are not allowed to clear battle length data");
      }
      // Delete
      await Promise.all([
        deleteLogBattleLengthsForClearAllBattleLengths(ctx.drizzle),
        insertActionLogForClearAllBattleLengths(ctx.drizzle, ctx),
      ]);
      return { success: true, message: "All battle length data cleared" };
    }),
  clearAllQueueLengths: protectedProcedure
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!canChangeContent(user.role)) {
        return errorResponse("You are not allowed to clear queue length data");
      }
      // Delete
      await Promise.all([
        deleteLogQueueLengthsForClearAllQueueLengths(ctx.drizzle),
        insertActionLogForClearAllQueueLengths(ctx.drizzle, ctx),
      ]);
      return { success: true, message: "All queue length data cleared" };
    }),
  getRankedLoadoutStatistics: publicProcedure
    .input(
      z.object({
        minCount: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(50),
        types: z.array(z.enum(logRankedPicks.type.enumValues)).optional(),
        name: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Fetch ranked loadout data with content names; each type has its own limit
      const picks = await Promise.all(
        (["jutsu", "item", "consumable"] as const).map((type) =>
          !input.types?.length || input.types.includes(type)
            ? selectLogRankedPicksForGetRankedLoadoutStatistics(
                ctx.drizzle,
                type,
                input,
              )
            : [],
        ),
      );

      // Combine all results and sort by count
      return picks
        .flat()
        .sort((a, b) => b.count - a.count)
        .slice(0, input.limit);
    }),
  getRankedRankDistributionStatistics: publicProcedure
    .input(
      z.object({
        minCount: z.number().min(1).default(1),
        minLevel: z.number().min(1).max(MAX_PLAYER_LEVEL).optional(),
        maxLevel: z.number().min(1).max(MAX_PLAYER_LEVEL).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Build where conditions
      const whereConditions: QueryCondition[] = [];

      // Add level range filter
      if (input.minLevel) {
        whereConditions.push(gte(userData.level, input.minLevel));
      }
      if (input.maxLevel) {
        whereConditions.push(lte(userData.level, input.maxLevel));
      }

      // Get top players LP for rank calculation
      const [topPlayersLPArray, users] = await Promise.all([
        fetchSanninRankedPlayers(ctx.drizzle),
        selectUserDataForGetRankedRankDistributionStatistics(
          ctx.drizzle,
          whereConditions,
        ),
      ]);

      // Calculate ranks for each user and ignore Unranked players
      const rankCounts = new Map<RankedRank, number>();

      users.forEach((user) => {
        const rank = getRankedRank(user.rankedLp, topPlayersLPArray);
        // Skip Unranked players
        if (rank !== "Unranked") {
          rankCounts.set(rank, (rankCounts.get(rank) || 0) + 1);
        }
      });

      // Convert to array format and filter by minimum count
      const distribution = Array.from(rankCounts.entries())
        .map(([rank, count]) => ({ rank, count }))
        .filter((item) => item.count >= input.minCount)
        .sort((a, b) => {
          // Sort by rank order (Wood, Adept, Master, Legend, Sannin)
          const rankOrder = RANKED_RANKS.indexOf(a.rank) - RANKED_RANKS.indexOf(b.rank);
          return rankOrder !== 0 ? rankOrder : b.count - a.count;
        });

      return distribution;
    }),
  // Quest reward statistics per quest (quest reward + sum of all objective rewards)
  getQuestRewardStatistics: publicProcedure
    .input(
      z.object({
        reward: z.enum(QuestRewardMetrics).default("reward_money"),
        questTypes: z.array(z.enum(QuestTypes)).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const whereConditions: QueryCondition[] = [];
      if (input.questTypes && input.questTypes.length > 0)
        whereConditions.push(inArray(quest.questType, input.questTypes));

      const rows = await selectQuestForGetQuestRewardStatistics(
        ctx.drizzle,
        whereConditions,
      );

      const metric = input.reward;
      return rows.map((q) => {
        const content = q.content;
        const rewards = [
          ...(content?.reward ? [content.reward] : []),
          ...(content?.objectives ?? []),
        ].flatMap((reward) => rewardPayloads(reward));
        const total = collapseRewards(rewards)[metric];
        return {
          id: q.id,
          name: q.name,
          questRank: q.questRank,
          questType: q.questType,
          requiredLevel: q.requiredLevel,
          value: total,
        };
      });
    }),
  getStatistics: publicProcedure
    .input(
      z.object({
        id: z.string(),
        type: z.enum(["jutsu", "item", "bloodline", "ai"]),
        battleType: z.enum(BattleTypes).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // General user statistics load with the type-specific queries
      const usage = selectDataBattleActionForGetStatistics(ctx.drizzle, input);
      switch (input.type) {
        case "jutsu": {
          const [info, levelDistribution, usageRows] = await Promise.all([
            fetchJutsu(ctx.drizzle, input.id),
            selectUserJutsuForGetStatistics(ctx.drizzle, input),
            usage,
          ]);
          const totalUsers = levelDistribution.reduce((sum, row) => sum + row.count, 0);
          return { info, usage: usageRows, totalUsers, levelDistribution };
        }
        case "bloodline": {
          const [info, levelDistribution, usageRows] = await Promise.all([
            fetchBloodline(ctx.drizzle, input.id),
            selectUserDataForGetStatistics(ctx.drizzle, input),
            usage,
          ]);
          const totalUsers = levelDistribution.reduce((sum, row) => sum + row.count, 0);
          return { info, usage: usageRows, totalUsers, levelDistribution };
        }
        case "item": {
          const [info, total, usageRows] = await Promise.all([
            fetchItem(ctx.drizzle, input.id),
            selectUserItemForGetStatistics(ctx.drizzle, input),
            usage,
          ]);
          const totalUsers = total?.[0]?.count || 0;
          return { info, usage: usageRows, totalUsers, levelDistribution: null };
        }
        case "ai": {
          const [info, usageRows] = await Promise.all([
            findUserDataForGetStatistics(ctx.drizzle, input),
            usage,
          ]);
          return { info, usage: usageRows, totalUsers: null, levelDistribution: null };
        }
      }
    }),
});

/** Battle-action filters shared by the jutsu and item balance tables. */
const contentBalanceConditions = (
  type: "jutsu" | "item",
  input: { battleTypes?: BattleType[]; bloodlineIds?: string[] },
): QueryCondition[] => [
  eq(dataBattleAction.type, type),
  ...(input.battleTypes?.length
    ? [inArray(dataBattleAction.battleType, input.battleTypes)]
    : []),
  ...(input.bloodlineIds?.length
    ? [inArray(dataBattleAction.relatedBloodlineId, input.bloodlineIds)]
    : []),
];

/** Splits the requested series; Dynamic and Recruited are cohorts, not referral sources. */
const parseRecruitmentSources = (sources: string[] | undefined) => {
  const selected = sources?.length ? sources : undefined;
  const realSources = selected?.filter((s) => s !== "Dynamic" && s !== "Recruited");
  return {
    selected,
    realSources,
    wantsDynamic: selected?.includes("Dynamic") ?? false,
    wantsRecruited: selected?.includes("Recruited") ?? false,
    wantReal: !selected || !!realSources?.length,
  };
};

/** Whether a row's user agent is on the requested devices; no devices means any device. */
const matchesDevice = (row: { userAgent: string | null }, devices?: DeviceType[]) =>
  !devices?.length || devices.includes(getDeviceType(row.userAgent ?? undefined));

/** Tally rows by the device their user agent resolves to. */
const countByDevice = (rows: { userAgent: string | null }[]) => {
  const counts: Record<DeviceType, number> = { mobile: 0, desktop: 0, unknown: 0 };
  for (const row of rows) counts[getDeviceType(row.userAgent ?? undefined)]++;
  return counts;
};
