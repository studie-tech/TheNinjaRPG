import { z } from "zod";
import { nanoid } from "nanoid";
import { and, eq, gte, lte, sql, asc, inArray, or, ne, gt } from "drizzle-orm";
import {
  userJutsu,
  userItem,
  userData,
  bloodline,
  skillTree,
  userSkill,
  referralSource,
  paypalTransaction,
  abEvent,
  visitorLog,
  historicalIp,
  questHistory,
} from "@/drizzle/schema";
import {
  dataBattleAction,
  jutsu,
  item,
  actionLog,
  logBattleLengths,
  logRankedPicks,
} from "@/drizzle/schema";
import {
  BattleDataEntryType,
  RecruitmentMetrics,
  RecruitmentMetricMax,
  RECRUITMENT_CTR,
  TUTORIAL_STEPS_COUNT,
} from "@/drizzle/constants";
import {
  createTRPCRouter,
  publicProcedure,
  protectedProcedure,
  serverError,
  baseServerResponse,
  errorResponse,
} from "../trpc";
import { fetchJutsu, jutsuDatabaseFilter } from "./jutsu";
import { fetchBloodline, bloodlineDatabaseFilter } from "./bloodline";
import { fetchItem, itemDatabaseFilter } from "./item";
import { fetchUser } from "./profile";
import { BattleTypes } from "@/drizzle/constants";
import { jutsuFilteringSchema } from "@/validators/jutsu";
import { itemFilteringSchema } from "@/validators/item";
import { bloodlineFilteringSchema } from "@/validators/bloodline";
import { skillTreeFilteringSchema } from "@/validators/skillTree";
import { fetchPublicUsers } from "@/routers/profile";
import { getPublicUsersSchema } from "@/validators/user";
import { skillTreeDatabaseFilter } from "./skillTree";
import type {
  ItemType,
  LetterRank,
  StatType,
  UserRank,
  RankedRank,
} from "@/drizzle/constants";
import {
  canChangeContent,
  canViewRecruitmentAnalytics,
  canViewRevenueAnalytics,
} from "@/utils/permissions";
import type { QueryCondition } from "@/utils/typeutils";
import { RANKED_RANKS } from "@/drizzle/constants";
import { logQueueLengths } from "@/drizzle/schema";
import { getRankedRank } from "@/libs/ranked_pvp";
import { fetchSanninRankedPlayers } from "@/server/api/routers/pvprank";
import { quest } from "@/drizzle/schema";
import { QuestTypes, QuestRewardMetrics } from "@/drizzle/constants";

export const dataRouter = createTRPCRouter({
  // AB tests summaries (protected)
  getAbTests: protectedProcedure
    .input(
      z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        utmSource: z.string().optional(),
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
      const whereConds: QueryCondition[] = [];
      if (input?.startDate)
        whereConds.push(gte(abEvent.createdAt, new Date(input.startDate)));
      if (input?.endDate)
        whereConds.push(lte(abEvent.createdAt, new Date(input.endDate)));
      if (input?.utmSource && input.utmSource.length > 0)
        whereConds.push(eq(abEvent.source, input.utmSource));
      const rows = await ctx.drizzle
        .select({
          experiment: abEvent.experiment,
          variant: abEvent.variant,
          event: abEvent.event,
          count: sql<number>`COUNT(${abEvent.id})`.mapWith(Number),
        })
        .from(abEvent)
        .where(whereConds.length > 0 ? and(...whereConds) : undefined)
        .groupBy(abEvent.experiment, abEvent.variant, abEvent.event)
        .orderBy(asc(abEvent.experiment), asc(abEvent.variant));

      const experiments = new Map<
        string,
        Record<string, { loaded: number; register: number }>
      >();
      rows.forEach((r) => {
        const exp = r.experiment ?? "";
        const variant = r.variant ?? "";
        const event = r.event ?? "";
        const count = Number(r.count ?? 0);
        if (!experiments.has(exp)) experiments.set(exp, {});
        const map = experiments.get(exp)!;
        if (!map[variant]) map[variant] = { loaded: 0, register: 0 };
        if (event === "loaded") map[variant].loaded += count;
        if (event === "register") map[variant].register += count;
      });

      return Array.from(experiments.entries()).map(([experiment, variants]) => ({
        experiment,
        variants: Object.entries(variants).map(([variant, vals]) => ({
          variant,
          loaded: vals.loaded,
          register: vals.register,
        })),
      }));
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
    const rows = await ctx.drizzle
      .selectDistinct({ utmSource: visitorLog.utmSource })
      .from(visitorLog)
      .where(
        and(sql`${visitorLog.utmSource} IS NOT NULL`, ne(visitorLog.utmSource, "")),
      )
      .orderBy(asc(visitorLog.utmSource));
    return rows.map((r) => r.utmSource!).filter((v) => typeof v === "string");
  }),
  getRecruitmentMainMetrics: protectedProcedure
    .input(
      z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        utmSource: z.string().optional(),
        questFunnels: z.array(z.string()).optional(),
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
      const visitorWhere: QueryCondition[] = [];
      if (input.startDate)
        visitorWhere.push(gte(visitorLog.createdAt, new Date(input.startDate)));
      if (input.endDate)
        visitorWhere.push(lte(visitorLog.createdAt, new Date(input.endDate)));
      if (input.utmSource && input.utmSource.length > 0) {
        visitorWhere.push(eq(visitorLog.utmSource, input.utmSource));
      } else {
        visitorWhere.push(ne(visitorLog.utmSource, ""));
      }

      const [
        visitorsRow,
        signupsRow,
        characterCreationsRow,
        leveledSignupsRow,
        nonStudentSignupsRow,
        pvpSignupsRow,
        tutorialFinishedSignupsRow,
        totalRevenueRow,
      ] = await Promise.all([
        ctx.drizzle
          .select({
            count: sql<number>`COUNT(${visitorLog.id})`.mapWith(Number),
          })
          .from(visitorLog)
          .where(visitorWhere.length > 0 ? and(...visitorWhere) : undefined),
        // Signups: users with an entry in ReferralSource (mapped via historical IP to the visit)
        ctx.drizzle
          .select({ questData: userData.questData, questHistory: questHistory })
          .from(visitorLog)
          .innerJoin(historicalIp, eq(historicalIp.ip, visitorLog.ip))
          .innerJoin(userData, eq(userData.userId, historicalIp.userId))
          .innerJoin(referralSource, eq(referralSource.userId, userData.userId))
          .leftJoin(questHistory, eq(questHistory.userId, userData.userId))
          .where(
            and(
              ...(visitorWhere.length > 0 ? visitorWhere : []),
              eq(userData.isAi, false),
              gte(userData.createdAt, visitorLog.createdAt),
              ...(input.questFunnels && input.questFunnels.length > 0
                ? [inArray(questHistory.questId, input.questFunnels)]
                : []),
              // If utmSource filter provided, also match referralSource.source to it
              ...(input.utmSource && input.utmSource.length > 0
                ? [eq(referralSource.source, input.utmSource)]
                : []),
            ),
          ),
        ctx.drizzle
          .select({
            // Character creations: users who have a UserData row (mapped via historical IP to the visit)
            count: sql<number>`COUNT(DISTINCT ${visitorLog.ip})`.mapWith(Number),
          })
          .from(visitorLog)
          .innerJoin(historicalIp, eq(historicalIp.ip, visitorLog.ip))
          .innerJoin(userData, eq(userData.userId, historicalIp.userId))
          .where(
            and(
              ...(visitorWhere.length > 0 ? visitorWhere : []),
              eq(userData.isAi, false),
              gte(userData.createdAt, visitorLog.createdAt),
            ),
          ),
        ctx.drizzle
          .select({
            count: sql<number>`COUNT(DISTINCT ${visitorLog.ip})`.mapWith(Number),
          })
          .from(visitorLog)
          .innerJoin(historicalIp, eq(historicalIp.ip, visitorLog.ip))
          .innerJoin(userData, eq(userData.userId, historicalIp.userId))
          .where(
            and(
              ...(visitorWhere.length > 0 ? visitorWhere : []),
              eq(userData.isAi, false),
              gte(userData.createdAt, visitorLog.createdAt),
              gt(userData.level, 1),
            ),
          ),
        ctx.drizzle
          .select({
            count: sql<number>`COUNT(DISTINCT ${visitorLog.ip})`.mapWith(Number),
          })
          .from(visitorLog)
          .innerJoin(historicalIp, eq(historicalIp.ip, visitorLog.ip))
          .innerJoin(userData, eq(userData.userId, historicalIp.userId))
          .where(
            and(
              ...(visitorWhere.length > 0 ? visitorWhere : []),
              eq(userData.isAi, false),
              gte(userData.createdAt, visitorLog.createdAt),
              ne(userData.rank, "STUDENT"),
            ),
          ),
        ctx.drizzle
          .select({
            count: sql<number>`COUNT(DISTINCT ${visitorLog.ip})`.mapWith(Number),
          })
          .from(visitorLog)
          .innerJoin(historicalIp, eq(historicalIp.ip, visitorLog.ip))
          .innerJoin(userData, eq(userData.userId, historicalIp.userId))
          .where(
            and(
              ...(visitorWhere.length > 0 ? visitorWhere : []),
              eq(userData.isAi, false),
              gte(userData.createdAt, visitorLog.createdAt),
              gt(userData.pvpFights, 0),
            ),
          ),
        ctx.drizzle
          .select({
            count: sql<number>`COUNT(DISTINCT ${visitorLog.ip})`.mapWith(Number),
          })
          .from(visitorLog)
          .innerJoin(historicalIp, eq(historicalIp.ip, visitorLog.ip))
          .innerJoin(userData, eq(userData.userId, historicalIp.userId))
          .where(
            and(
              ...(visitorWhere.length > 0 ? visitorWhere : []),
              eq(userData.isAi, false),
              gte(userData.createdAt, visitorLog.createdAt),
              // Consider tutorial finished when tutorialStep is set to the last index (skipped) or beyond the last step
              gte(userData.tutorialStep, TUTORIAL_STEPS_COUNT),
            ),
          ),
        ctx.drizzle
          .select({
            totalUsd: sql<number>`SUM(${paypalTransaction.amount})`.mapWith(Number),
          })
          .from(paypalTransaction)
          .innerJoin(
            userData,
            or(
              eq(paypalTransaction.affectedUserId, userData.userId),
              eq(paypalTransaction.createdById, userData.userId),
            ),
          )
          .innerJoin(historicalIp, eq(historicalIp.userId, userData.userId))
          .innerJoin(visitorLog, eq(visitorLog.ip, historicalIp.ip))
          .where(
            and(
              ...(visitorWhere.length > 0 ? visitorWhere : []),
              eq(userData.isAi, false),
              gte(userData.createdAt, visitorLog.createdAt),
            ),
          ),
      ]);

      const clicks = visitorsRow?.[0]?.count ?? 0;
      const signups = signupsRow?.length ?? 0;
      const characterCreations = characterCreationsRow?.[0]?.count ?? 0;
      const signupRate = clicks > 0 ? signups / clicks : 0;
      const characterCreationRate = clicks > 0 ? characterCreations / clicks : 0;
      const leveledSignups = leveledSignupsRow?.[0]?.count ?? 0;
      const nonStudentSignups = nonStudentSignupsRow?.[0]?.count ?? 0;
      const pvpSignups = pvpSignupsRow?.[0]?.count ?? 0;
      const tutorialFinishedSignups = tutorialFinishedSignupsRow?.[0]?.count ?? 0;
      const totalRevenueUsd = totalRevenueRow?.[0]?.totalUsd ?? 0;
      const clickValueUsd = clicks > 0 ? totalRevenueUsd / clicks : 0;

      // Extract quest funnels for each requested quest
      const questFunnels: Record<string, number[]> = {};
      if (input.questFunnels) {
        for (const questId of input.questFunnels) {
          questFunnels[questId] = signupsRow.map((r) => {
            const quest = r.questData?.find((q) => q.id === questId);
            if (quest && Array.isArray(quest.goals)) {
              return quest.goals.filter((g) => g.done).length;
            }
            return 0;
          });
        }
      }

      return {
        ctr: RECRUITMENT_CTR,
        signupRate,
        visitors: clicks,
        signups,
        characterCreations,
        characterCreationRate,
        leveledBeyond1: leveledSignups,
        nonStudentSignups,
        pvpSignups,
        tutorialFinishedSignups,
        clickValueUsd,
        questFunnels,
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
    const rows = await ctx.drizzle
      .selectDistinct({ source: referralSource.source })
      .from(referralSource)
      .where(ne(referralSource.source, ""))
      .orderBy(asc(referralSource.source));
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
      // Filtering
      const baseWhere: QueryCondition[] = [ne(referralSource.source, "")];
      const dateWhere: QueryCondition[] = [];
      if (input.startDate)
        dateWhere.push(gte(paypalTransaction.createdAt, new Date(input.startDate)));
      if (input.endDate)
        dateWhere.push(lte(paypalTransaction.createdAt, new Date(input.endDate)));

      // Avoid OR on large paypalTransaction by running two index-friendly joins in parallel
      // and subtracting the double-counted self-purchases (createdById === affectedUserId).
      const [byCreator, byAffected, bySelf] = await Promise.all([
        ctx.drizzle
          .select({
            source: referralSource.source,
            totalUsd: sql<number>`SUM(${paypalTransaction.amount})`.mapWith(Number),
          })
          .from(referralSource)
          .innerJoin(
            paypalTransaction,
            eq(paypalTransaction.createdById, referralSource.userId),
          )
          .where(and(...baseWhere, ...(dateWhere.length > 0 ? dateWhere : [])))
          .groupBy(referralSource.source),
        ctx.drizzle
          .select({
            source: referralSource.source,
            totalUsd: sql<number>`SUM(${paypalTransaction.amount})`.mapWith(Number),
          })
          .from(referralSource)
          .innerJoin(
            paypalTransaction,
            eq(paypalTransaction.affectedUserId, referralSource.userId),
          )
          .where(and(...baseWhere, ...(dateWhere.length > 0 ? dateWhere : [])))
          .groupBy(referralSource.source),
        ctx.drizzle
          .select({
            source: referralSource.source,
            totalUsd: sql<number>`SUM(${paypalTransaction.amount})`.mapWith(Number),
          })
          .from(referralSource)
          .innerJoin(
            paypalTransaction,
            and(
              eq(paypalTransaction.createdById, referralSource.userId),
              eq(paypalTransaction.affectedUserId, referralSource.userId),
            ),
          )
          .where(and(...baseWhere, ...(dateWhere.length > 0 ? dateWhere : [])))
          .groupBy(referralSource.source),
      ]);

      const totalsBySource = new Map<string, number>();
      const add = (rows: { source: string | null; totalUsd: number | null }[]) => {
        rows.forEach((r) => {
          const src = r.source ?? "";
          const prev = totalsBySource.get(src) ?? 0;
          totalsBySource.set(src, prev + Number(r.totalUsd ?? 0));
        });
      };
      add(byCreator);
      add(byAffected);
      // subtract self-purchases counted in both creator and affected queries
      bySelf.forEach((r) => {
        const src = r.source ?? "";
        const prev = totalsBySource.get(src) ?? 0;
        totalsBySource.set(src, prev - Number(r.totalUsd ?? 0));
      });

      const rows = Array.from(totalsBySource.entries())
        .map(([source, totalUsd]) => ({ source, totalUsd }))
        .sort((a, b) => a.source.localeCompare(b.source));

      return rows;
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
      const selected = input.sources?.length ? input.sources : undefined;
      const wantsDynamic = selected?.includes("Dynamic") ?? false;
      const wantsRecruited = selected?.includes("Recruited") ?? false;
      const realSources = selected?.filter((s) => s !== "Dynamic" && s !== "Recruited");
      const metric = input.metric ?? "level";
      // Build referred and dynamic queries and run in parallel when applicable
      const wantReal = !selected || (realSources && realSources.length > 0);

      // Base where clauses shared by all branches
      const baseUserWhere: QueryCondition[] = [eq(userData.isAi, false)];
      if (input.startDate)
        baseUserWhere.push(gte(userData.createdAt, new Date(input.startDate)));
      if (input.endDate)
        baseUserWhere.push(lte(userData.createdAt, new Date(input.endDate)));

      // Referrals-specific where
      const realWhere: QueryCondition[] = [...baseUserWhere];
      if (!selected) {
        // all referred via inner join
      } else if (realSources && realSources.length > 0) {
        realWhere.push(inArray(referralSource.source, realSources));
      }
      // Dynamic and Recruited specifics
      const dynamicWhere: QueryCondition[] = [
        ...baseUserWhere,
        sql`NOT EXISTS(SELECT 1 FROM ${referralSource} rs2 WHERE rs2.userId = ${userData.userId})`,
      ];
      const recruitedWhere: QueryCondition[] = [
        ...baseUserWhere,
        sql`${userData.recruiterId} IS NOT NULL`,
      ];

      const metricColumn = (() => {
        switch (metric) {
          case "level":
            return userData.level;
          case "pveFights":
            return userData.pveFights;
          case "pvpFights":
            return userData.pvpFights;
          case "missionsD":
            return userData.missionsD;
          case "missionsC":
            return userData.missionsC;
          case "missionsB":
            return userData.missionsB;
          case "missionsA":
            return userData.missionsA;
          case "crimesD":
            return userData.crimesD;
          case "crimesC":
            return userData.crimesC;
          case "crimesB":
            return userData.crimesB;
          case "crimesA":
            return userData.crimesA;
          default:
            return userData.level;
        }
      })();

      const clampMax = RecruitmentMetricMax[metric] ?? 1000;
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
          const inner = bySource.get(r.source)!;
          inner.set(r.level, (inner.get(r.level) ?? 0) + 1);
        });
        const out: { source: string; level: number; count: number }[] = [];
        bySource.forEach((lvlMap, src) =>
          lvlMap.forEach((cnt, lvl) =>
            out.push({ source: src, level: lvl, count: cnt }),
          ),
        );
        return out;
      };

      // Referred users from various sources
      const realPromise = wantReal
        ? metric !== "completedQuests"
          ? ctx.drizzle
              .select({
                source: referralSource.source,
                level: clampedExpr,
                count: sql<number>`COUNT(${userData.userId})`.mapWith(Number),
              })
              .from(userData)
              .innerJoin(referralSource, eq(referralSource.userId, userData.userId))
              .where(and(...realWhere))
              .groupBy(referralSource.source, clampedExpr)
              .orderBy(asc(referralSource.source), asc(clampedExpr))
          : ctx.drizzle
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
              .groupBy(referralSource.source, userData.userId)
              .then((rows) =>
                aggregateCountsBySource(
                  rows as { source: string; level: number; userId: string }[],
                ),
              )
        : Promise.resolve([] as { source: string; level: number; count: number }[]);

      // Dynamic signups (non recruited or from referral sources)
      const dynPromise =
        !selected || wantsDynamic
          ? metric !== "completedQuests"
            ? ctx.drizzle
                .select({
                  level: clampedExpr,
                  count: sql<number>`COUNT(${userData.userId})`.mapWith(Number),
                })
                .from(userData)
                .where(and(...dynamicWhere))
                .groupBy(clampedExpr)
                .orderBy(asc(clampedExpr))
            : ctx.drizzle
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
                .groupBy(userData.userId)
                .then((rows) =>
                  aggregateCounts(rows as { level: number; userId: string }[]),
                )
          : Promise.resolve([] as { level: number; count: number }[]);

      // Recruited users
      const recruitedPromise =
        !selected || wantsRecruited
          ? metric !== "completedQuests"
            ? ctx.drizzle
                .select({
                  level: clampedExpr,
                  count: sql<number>`COUNT(${userData.userId})`.mapWith(Number),
                })
                .from(userData)
                .where(and(...recruitedWhere))
                .groupBy(clampedExpr)
                .orderBy(asc(clampedExpr))
            : ctx.drizzle
                .select({
                  level:
                    sql<number>`COALESCE(SUM(CASE WHEN ${questHistory.completed} = 1 THEN 1 ELSE 0 END), 0)`.mapWith(
                      Number,
                    ),
                  userId: userData.userId,
                })
                .from(userData)
                .leftJoin(questHistory, eq(questHistory.userId, userData.userId))
                .where(and(...recruitedWhere))
                .groupBy(userData.userId)
                .then((rows) =>
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
          bySource.get(r.source)!.push({ level: r.level, count: r.count });
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
      const selected = input.sources?.length ? input.sources : undefined;
      const wantsDynamic = selected?.includes("Dynamic") ?? false;
      const wantsRecruited = selected?.includes("Recruited") ?? false;
      const realSources = selected?.filter((s) => s !== "Dynamic" && s !== "Recruited");
      const dayExpr = sql<string>`CAST(${userData.createdAt} AS DATE)`;

      // No selection: only users with any referral source (historical behavior)
      const rows = await ctx.drizzle
        .select({
          day: dayExpr,
          mean: sql<number>`AVG(${userData.level})`.mapWith(Number),
          std: sql<number>`STDDEV_SAMP(${userData.level})`.mapWith(Number),
          count: sql<number>`COUNT(${userData.userId})`.mapWith(Number),
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
                  ...(wantsRecruited
                    ? [sql`(${userData.recruiterId} IS NOT NULL)`]
                    : []),
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
      const selected = input.sources?.length ? input.sources : undefined;
      const wantsDynamic = selected?.includes("Dynamic") ?? false;
      const wantsRecruited = selected?.includes("Recruited") ?? false;
      const realSources = selected?.filter((s) => s !== "Dynamic" && s !== "Recruited");
      const wantReal = !selected || (realSources && realSources.length > 0);

      const dayExpr = sql<string>`CAST(${userData.createdAt} AS DATE)`;

      // Referred series
      const realWhere: QueryCondition[] = [eq(userData.isAi, false)];
      if (input.startDate)
        realWhere.push(gte(userData.createdAt, new Date(input.startDate)));
      if (input.endDate)
        realWhere.push(lte(userData.createdAt, new Date(input.endDate)));
      if (!selected) {
        // all referred
      } else if (realSources && realSources.length > 0) {
        realWhere.push(inArray(referralSource.source, realSources));
      }

      const realPromise = wantReal
        ? ctx.drizzle
            .select({
              day: dayExpr,
              source: referralSource.source,
              count: sql<number>`COUNT(${userData.userId})`.mapWith(Number),
            })
            .from(userData)
            .innerJoin(referralSource, eq(referralSource.userId, userData.userId))
            .where(and(...realWhere))
            .groupBy(dayExpr, referralSource.source)
            .orderBy(asc(dayExpr), asc(referralSource.source))
        : Promise.resolve(
            [] as { day: Date | string; source: string; count: number }[],
          );

      // Dynamic series
      const dynPromise =
        !selected || wantsDynamic
          ? ctx.drizzle
              .select({
                day: dayExpr,
                count: sql<number>`COUNT(${userData.userId})`.mapWith(Number),
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
                  ...(input.endDate
                    ? [lte(userData.createdAt, new Date(input.endDate))]
                    : []),
                ),
              )
              .groupBy(dayExpr)
              .orderBy(asc(dayExpr))
          : Promise.resolve([] as { day: Date | string; count: number }[]);

      const recPromise =
        !selected || wantsRecruited
          ? ctx.drizzle
              .select({
                day: dayExpr,
                count: sql<number>`COUNT(${userData.userId})`.mapWith(Number),
              })
              .from(userData)
              .where(
                and(
                  eq(userData.isAi, false),
                  sql`${userData.recruiterId} IS NOT NULL`,
                  ...(input.startDate
                    ? [gte(userData.createdAt, new Date(input.startDate))]
                    : []),
                  ...(input.endDate
                    ? [lte(userData.createdAt, new Date(input.endDate))]
                    : []),
                ),
              )
              .groupBy(dayExpr)
              .orderBy(asc(dayExpr))
          : Promise.resolve([] as { day: Date | string; count: number }[]);

      const [rows, dynamicRows, recruitedRows] = await Promise.all([
        realPromise,
        dynPromise,
        recPromise,
      ]);

      const bySource = new Map<string, { date: string; count: number }[]>();
      (rows as { day: Date | string; source: string; count: number }[]).forEach((r) => {
        const d = (r.day as unknown as string) ?? String(r.day);
        if (!bySource.has(r.source)) bySource.set(r.source, []);
        bySource.get(r.source)!.push({ date: d, count: r.count });
      });
      if (dynamicRows.length > 0) {
        bySource.set(
          "Dynamic",
          (dynamicRows as { day: Date | string; count: number }[]).map((r) => ({
            date: (r.day as unknown as string) ?? String(r.day),
            count: r.count,
          })),
        );
      }
      if (recruitedRows.length > 0) {
        bySource.set(
          "Recruited",
          (recruitedRows as { day: Date | string; count: number }[]).map((r) => ({
            date: (r.day as unknown as string) ?? String(r.day),
            count: r.count,
          })),
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
        ctx.drizzle
          .delete(dataBattleAction)
          .where(
            and(
              eq(dataBattleAction.contentId, input.contentId),
              eq(dataBattleAction.type, input.type),
            ),
          ),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "battleAction",
          changes: [`Deleted ${input.type} battle action: ${input.contentId}`],
          relatedId: input.contentId,
          relatedMsg: `Delete: ${input.contentId}`,
          relatedImage: null,
        }),
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
        ctx.drizzle
          .delete(dataBattleAction)
          .where(eq(dataBattleAction.type, input.type)),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "battleAction",
          changes: [`Deleted all ${input.type} battle actions`],
          relatedId: null,
          relatedMsg: `Delete: All ${input.type} battle actions`,
          relatedImage: null,
        }),
      ]);
      return { success: true, message: "Data battle action deleted" };
    }),
  getBloodlineBalanceStatistics: publicProcedure
    .input(
      z.object({
        battleTypes: z.array(z.enum(BattleTypes)).optional(),
        minCount: z.number().min(1).default(1),
        bloodlineRanks: z.array(z.string()).optional(),
        statClassifications: z.array(z.string()).optional(),
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
        bloodlineWhereConditions.push(
          inArray(bloodline.rank, input.bloodlineRanks as LetterRank[]),
        );
      }

      // Build stat classification filter if needed
      if (input.statClassifications && input.statClassifications.length > 0) {
        bloodlineWhereConditions.push(
          inArray(
            bloodline.statClassification,
            input.statClassifications as StatType[],
          ),
        );
      }

      // Run all queries in parallel for efficiency
      const [allBloodlines, userCounts, battleStats] = await Promise.all([
        // Get all bloodlines (filtered by rank/classification if specified)
        ctx.drizzle
          .select({
            id: bloodline.id,
            name: bloodline.name,
          })
          .from(bloodline)
          .where(
            bloodlineWhereConditions.length > 0
              ? and(...bloodlineWhereConditions)
              : undefined,
          ),

        // Get user counts per bloodline
        ctx.drizzle
          .select({
            bloodlineId: userData.bloodlineId,
            userCount:
              sql<number>`COUNT(CASE WHEN ${userData.bloodlineId} IS NOT NULL THEN 1 END)`.mapWith(
                Number,
              ),
          })
          .from(userData)
          .groupBy(userData.bloodlineId),

        // Get battle statistics
        ctx.drizzle
          .select({
            name: bloodline.name,
            bloodlineId: bloodline.id,
            battleWon: dataBattleAction.battleWon,
            count: sql<number>`SUM(${dataBattleAction.count})`.mapWith(Number),
          })
          .from(dataBattleAction)
          .innerJoin(bloodline, eq(dataBattleAction.contentId, bloodline.id))
          .groupBy(
            bloodline.name,
            bloodline.id,
            dataBattleAction.battleWon,
            dataBattleAction.battleType,
          )
          .where(and(...whereConditions))
          .having(gte(sql`SUM(${dataBattleAction.count})`, input.minCount)),
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
        battleStatsMap.get(stat.bloodlineId)!.push({
          battleWon: stat.battleWon,
          count: stat.count,
        });
      });

      // Create result for each bloodline
      return allBloodlines.map((bloodline) => {
        const userCount = userCountMap.get(bloodline.id) || 0;
        const battleData = battleStatsMap.get(bloodline.id) || [];

        // Calculate battle statistics
        const wins = battleData
          .filter((entry) => entry.battleWon === 1)
          .reduce((acc, curr) => acc + curr.count, 0);

        const flees = battleData
          .filter((entry) => entry.battleWon === 2)
          .reduce((acc, curr) => acc + curr.count, 0);

        const losses = battleData
          .filter((entry) => entry.battleWon === 0)
          .reduce((acc, curr) => acc + curr.count, 0);

        const totalUsage = wins + flees + losses;
        const winRate = totalUsage > 0 ? (wins / totalUsage) * 100 : 0;

        return {
          name: bloodline.name,
          bloodlineId: bloodline.id,
          userCount,
          totalUsage,
          wins,
          flees,
          losses,
          winRate: `${winRate.toFixed(1)}%`,
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
      const whereConditions: QueryCondition[] = [eq(dataBattleAction.type, "jutsu")];

      // Add battle type filter
      if (input.battleTypes && input.battleTypes.length > 0) {
        whereConditions.push(inArray(dataBattleAction.battleType, input.battleTypes));
      }

      // Perform the filter by jutsu effects directly in the main query using JSON_SEARCH in the WHERE clause if needed
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

      // Build bloodline filter if needed
      if (input.bloodlineIds && input.bloodlineIds.length > 0) {
        whereConditions.push(
          inArray(dataBattleAction.relatedBloodlineId, input.bloodlineIds),
        );
      }

      // Run equippedCounts and usage queries in parallel for efficiency
      const [equippedCounts, usage] = await Promise.all([
        ctx.drizzle
          .select({
            jutsuId: userJutsu.jutsuId,
            equippedCount:
              sql<number>`COUNT(CASE WHEN ${userJutsu.equipped} = 1 THEN 1 END)`.mapWith(
                Number,
              ),
          })
          .from(userJutsu)
          .groupBy(userJutsu.jutsuId),
        ctx.drizzle
          .select({
            name: jutsu.name,
            jutsuId: jutsu.id,
            battleWon: dataBattleAction.battleWon,
            count: sql<number>`SUM(${dataBattleAction.count})`.mapWith(Number),
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
          .having(havingClause),
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
      const results = await ctx.drizzle.query.jutsu.findMany({
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
      const results = await ctx.drizzle.query.item.findMany({
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
      const results = await ctx.drizzle.query.bloodline.findMany({
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
      const results = aiUsers.data
        .map((ai) => {
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
        })
        .flat();

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
      const [userCounts, skills] = await Promise.all([
        // Get user counts per skill
        ctx.drizzle
          .select({
            skillId: userSkill.skillId,
            userCount: sql<number>`COUNT(${userSkill.userId})`.mapWith(Number),
          })
          .from(userSkill)
          .groupBy(userSkill.skillId),

        // Get all skills (filtered by effects/tiers if specified)
        ctx.drizzle
          .select({
            id: skillTree.id,
            name: skillTree.name,
            tier: skillTree.tier,
            costSkillPoints: skillTree.costSkillPoints,
            effects: skillTree.effects,
          })
          .from(skillTree)
          .where(whereConditions.length > 0 ? and(...whereConditions) : undefined),
      ]);

      // Create a map for quick lookup
      const userCountMap = new Map(
        userCounts.map((item) => [item.skillId, item.userCount]),
      );

      // Create result for each skill
      return skills
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
      const results = await ctx.drizzle.query.skillTree.findMany({
        where: and(...baseFilters),
        columns: {
          id: true,
          name: true,
          tier: true,
          costSkillPoints: true,
          effects: true,
        },
      });
      return results;
    }),
  getItemBalanceStatistics: publicProcedure
    .input(
      z.object({
        battleTypes: z.array(z.enum(BattleTypes)).optional(),
        minCount: z.number().min(1).default(1),
        itemTypes: z.array(z.string()).optional(),
        bloodlineIds: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Build where conditions
      const whereConditions: QueryCondition[] = [eq(dataBattleAction.type, "item")];

      // Add battle type filter
      if (input.battleTypes && input.battleTypes.length > 0) {
        whereConditions.push(inArray(dataBattleAction.battleType, input.battleTypes));
      }

      // Perform the filter by item types directly in the main query
      const havingClause = gte(sql`SUM(${dataBattleAction.count})`, input.minCount);

      // Build item type filter if needed
      if (input.itemTypes && input.itemTypes.length > 0) {
        whereConditions.push(inArray(item.itemType, input.itemTypes as ItemType[]));
      }

      // Build bloodline filter if needed
      if (input.bloodlineIds && input.bloodlineIds.length > 0) {
        whereConditions.push(
          inArray(dataBattleAction.relatedBloodlineId, input.bloodlineIds),
        );
      }

      // Run equippedCounts and usage queries in parallel for efficiency
      const [equippedCounts, usage] = await Promise.all([
        ctx.drizzle
          .select({
            itemId: userItem.itemId,
            equippedCount:
              sql<number>`COUNT(CASE WHEN ${userItem.equipped} = 1 THEN 1 END)`.mapWith(
                Number,
              ),
          })
          .from(userItem)
          .groupBy(userItem.itemId),
        ctx.drizzle
          .select({
            name: item.name,
            itemId: item.id,
            battleWon: dataBattleAction.battleWon,
            count: sql<number>`SUM(${dataBattleAction.count})`.mapWith(Number),
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
          .having(havingClause),
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
        userRanks: z.array(z.string()).optional(),
        villages: z.array(z.string()).optional(),
        minLevel: z.number().min(1).default(1),
        maxLevel: z.number().max(100).default(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Build where conditions
      const whereConditions: QueryCondition[] = [eq(dataBattleAction.type, "ai")];

      // Add battle type filter
      if (input.battleTypes && input.battleTypes.length > 0) {
        whereConditions.push(inArray(dataBattleAction.battleType, input.battleTypes));
      }

      // Perform the filter by user ranks, villages, and level range directly in the main query
      const havingClause = gte(sql`SUM(${dataBattleAction.count})`, input.minCount);

      // Build user rank filter if needed
      if (input.userRanks && input.userRanks.length > 0) {
        whereConditions.push(inArray(userData.rank, input.userRanks as UserRank[]));
      }

      // Build village filter if needed
      if (input.villages && input.villages.length > 0) {
        whereConditions.push(inArray(userData.villageId, input.villages));
      }

      // Build level range filter
      whereConditions.push(
        and(gte(userData.level, input.minLevel), lte(userData.level, input.maxLevel)),
      );

      // Run battleCounts and usage queries in parallel for efficiency
      const [usage] = await Promise.all([
        ctx.drizzle
          .select({
            name: sql<string>`CONCAT(${userData.username}, ' - lvl', ${userData.level})`,
            aiUserId: userData.userId,
            battleWon: dataBattleAction.battleWon,
            count: sql<number>`SUM(${dataBattleAction.count})`.mapWith(Number),
          })
          .from(dataBattleAction)
          .innerJoin(userData, eq(dataBattleAction.contentId, userData.userId))
          .groupBy(
            userData.userId,
            dataBattleAction.battleWon,
            dataBattleAction.battleType,
          )
          .where(and(...whereConditions))
          .having(havingClause),
      ]);

      // Add battle count to each result
      return usage;
    }),
  getBattleLengthStatistics: publicProcedure
    .input(
      z.object({
        battleTypes: z.array(z.enum(BattleTypes)).optional(),
        minCount: z.number().min(1).default(1),
        minWinnerLevel: z.number().min(1).max(100).optional(),
        maxWinnerLevel: z.number().min(1).max(100).optional(),
        minLoserLevel: z.number().min(1).max(100).optional(),
        maxLoserLevel: z.number().min(1).max(100).optional(),
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
      const battleLengthsRaw = await ctx.drizzle
        .select({
          battleType: logBattleLengths.battleType,
          rounds: logBattleLengths.rounds,
          count: sql<number>`SUM(${logBattleLengths.count})`.mapWith(Number),
        })
        .from(logBattleLengths)
        .groupBy(logBattleLengths.battleType, logBattleLengths.rounds)
        .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
        .having(havingClause)
        .orderBy(asc(logBattleLengths.rounds));

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
      const queueLengths = await ctx.drizzle
        .select({
          rankedRank: logQueueLengths.rankedRank,
          ceiledMinutes: logQueueLengths.ceiledMinutes,
          count: sql<number>`SUM(${logQueueLengths.count})`.mapWith(Number),
        })
        .from(logQueueLengths)
        .groupBy(logQueueLengths.rankedRank, logQueueLengths.ceiledMinutes)
        .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
        .having(havingClause)
        .orderBy(asc(logQueueLengths.ceiledMinutes));

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
        ctx.drizzle.delete(logBattleLengths),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "battleLengths",
          changes: ["Cleared all battle length data"],
          relatedId: null,
          relatedMsg: "Clear: All battle length data",
          relatedImage: null,
        }),
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
        ctx.drizzle.delete(logQueueLengths),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "queueLengths",
          changes: ["Cleared all queue length data"],
          relatedId: null,
          relatedMsg: "Clear: All queue length data",
          relatedImage: null,
        }),
      ]);
      return { success: true, message: "All queue length data cleared" };
    }),
  getRankedLoadoutStatistics: publicProcedure
    .input(
      z.object({
        minCount: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(50),
        types: z.array(z.string()).optional(),
        name: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Perform the filter by minimum count
      const havingClause = gte(sql`SUM(${logRankedPicks.count})`, input.minCount);

      // Build where conditions for type filtering
      const typeConditions =
        input.types && input.types.length > 0
          ? inArray(logRankedPicks.type, input.types as ["jutsu", "item", "consumable"])
          : undefined;

      // Build name filtering conditions
      const nameConditions = input.name && input.name.length > 0 ? true : false;

      // Fetch ranked loadout data with content names
      const [jutsuPicks, itemPicks, consumablePicks] = await Promise.all([
        ctx.drizzle
          .select({
            type: logRankedPicks.type,
            contentId: logRankedPicks.contentId,
            battleType: logRankedPicks.battleType,
            count: sql<number>`SUM(${logRankedPicks.count})`.mapWith(Number),
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
          .limit(input.limit),
        ctx.drizzle
          .select({
            type: logRankedPicks.type,
            contentId: logRankedPicks.contentId,
            battleType: logRankedPicks.battleType,
            count: sql<number>`SUM(${logRankedPicks.count})`.mapWith(Number),
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
          .limit(input.limit),
        ctx.drizzle
          .select({
            type: logRankedPicks.type,
            contentId: logRankedPicks.contentId,
            battleType: logRankedPicks.battleType,
            count: sql<number>`SUM(${logRankedPicks.count})`.mapWith(Number),
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
          .limit(input.limit),
      ]);

      // Combine all results and sort by count
      const allPicks = [...jutsuPicks, ...itemPicks, ...consumablePicks];
      return allPicks.sort((a, b) => b.count - a.count).slice(0, input.limit);
    }),
  getRankedRankDistributionStatistics: publicProcedure
    .input(
      z.object({
        minCount: z.number().min(1).default(1),
        minLevel: z.number().min(1).max(100).optional(),
        maxLevel: z.number().min(1).max(100).optional(),
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
        ctx.drizzle
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
          ),
      ]);

      // Calculate ranks for each user and ignore Unranked players
      const rankCounts = new Map<string, number>();

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
          const rankOrder =
            RANKED_RANKS.indexOf(a.rank as RankedRank) -
            RANKED_RANKS.indexOf(b.rank as RankedRank);
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

      const rows = await ctx.drizzle
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

      const metric = input.reward;
      return rows.map((q) => {
        const content = q.content;
        const base = Number(content?.reward?.[metric] ?? 0);
        const objectiveSum = (content?.objectives ?? []).reduce((acc, obj) => {
          const v = Number(obj?.[metric] ?? 0);
          return acc + (Number.isFinite(v) ? v : 0);
        }, 0);
        const total = base + objectiveSum;
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
        type: z.enum(["jutsu", "item", "bloodline", "basic", "ai"]),
        battleType: z.enum(BattleTypes).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // General User Statistics
      const usage = await ctx.drizzle
        .select({
          battleWon: dataBattleAction.battleWon,
          battleType: dataBattleAction.battleType,
          count: sql<number>`COUNT(${dataBattleAction.id})`.mapWith(Number),
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
      // Process different inputs
      if (input.type === "jutsu") {
        // Jutsu Statistics
        const info = await fetchJutsu(ctx.drizzle, input.id);
        const levelDistribution = await ctx.drizzle
          .select({
            level: userJutsu.level,
            count: sql<number>`COUNT(${userJutsu.userId})`.mapWith(Number),
          })
          .from(userJutsu)
          .groupBy(userJutsu.level)
          .where(eq(userJutsu.jutsuId, input.id))
          .orderBy(asc(userJutsu.level));
        const total = await ctx.drizzle
          .select({ count: sql<number>`count(*)`.mapWith(Number) })
          .from(userJutsu)
          .where(eq(userJutsu.jutsuId, input.id));
        const totalUsers = total?.[0]?.count || 0;
        return { info, usage, totalUsers, levelDistribution };
      } else if (input.type === "bloodline") {
        // Bloodline Statistics
        const info = await fetchBloodline(ctx.drizzle, input.id);
        const levelDistribution = await ctx.drizzle
          .select({
            level: userData.level,
            count: sql<number>`COUNT(${userData.userId})`.mapWith(Number),
          })
          .from(userData)
          .groupBy(userData.level)
          .where(eq(userData.bloodlineId, input.id))
          .orderBy(asc(userData.level));
        const total = await ctx.drizzle
          .select({ count: sql<number>`count(*)`.mapWith(Number) })
          .from(userData)
          .where(eq(userData.bloodlineId, input.id));
        const totalUsers = total?.[0]?.count || 0;
        return { info, usage, totalUsers, levelDistribution };
      } else if (input.type === "item") {
        // Item Statistics
        const info = await fetchItem(ctx.drizzle, input.id);
        const total = await ctx.drizzle
          .select({ count: sql<number>`count(*)`.mapWith(Number) })
          .from(userItem)
          .where(eq(userItem.id, input.id));
        const totalUsers = total?.[0]?.count || 0;
        return { info, usage, totalUsers, levelDistribution: null };
      } else if (input.type === "ai") {
        // AI Statistics
        const info = await fetchUser(ctx.drizzle, input.id);
        return { info, usage, totalUsers: null, levelDistribution: null };
      } else {
        throw serverError("BAD_REQUEST", `Invalid input type: ${input.type}`);
      }
    }),
});
