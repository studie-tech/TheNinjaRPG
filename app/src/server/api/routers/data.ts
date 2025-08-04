import { z } from "zod";
import { nanoid } from "nanoid";
import { and, eq, gte, lte, sql, asc, inArray, or } from "drizzle-orm";
import { userJutsu, userItem, userData, bloodline } from "@/drizzle/schema";
import { dataBattleAction, jutsu, item, actionLog } from "@/drizzle/schema";
import { BattleDataEntryType } from "@/drizzle/constants";
import {
  createTRPCRouter,
  publicProcedure,
  protectedProcedure,
  serverError,
  baseServerResponse,
  errorResponse,
} from "../trpc";
import { fetchJutsu } from "./jutsu";
import { fetchBloodline } from "./bloodline";
import { fetchItem } from "./item";
import { fetchUser } from "./profile";
import { BattleTypes } from "@/drizzle/constants";
import type {
  ItemType,
  LetterRank,
  StatType,
  UserRank,
  StarterVillage,
} from "@/drizzle/constants";
import { canChangeContent } from "@/utils/permissions";
import type { QueryCondition } from "@/utils/typeutils";

export const dataRouter = createTRPCRouter({
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
      // Build where conditions
      const whereConditions: QueryCondition[] = [
        eq(dataBattleAction.type, "bloodline"),
      ];

      // Add battle type filter
      if (input.battleTypes && input.battleTypes.length > 0) {
        whereConditions.push(inArray(dataBattleAction.battleType, input.battleTypes));
      }

      // Perform the filter by bloodline ranks and stat classifications directly in the main query
      const havingClause = gte(sql`SUM(${dataBattleAction.count})`, input.minCount);

      // Build bloodline rank filter if needed
      if (input.bloodlineRanks && input.bloodlineRanks.length > 0) {
        whereConditions.push(
          inArray(bloodline.rank, input.bloodlineRanks as LetterRank[]),
        );
      }

      // Build stat classification filter if needed
      if (input.statClassifications && input.statClassifications.length > 0) {
        whereConditions.push(
          inArray(
            bloodline.statClassification,
            input.statClassifications as StatType[],
          ),
        );
      }

      // Run equippedCounts and usage queries in parallel for efficiency
      const [equippedCounts, usage] = await Promise.all([
        ctx.drizzle
          .select({
            bloodlineId: userData.bloodlineId,
            equippedCount:
              sql<number>`COUNT(CASE WHEN ${userData.bloodlineId} IS NOT NULL THEN 1 END)`.mapWith(
                Number,
              ),
          })
          .from(userData)
          .groupBy(userData.bloodlineId),
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
          .having(havingClause),
      ]);

      // Create a map for quick lookup
      const equippedCountMap = new Map(
        equippedCounts.map((item) => [item.bloodlineId, item.equippedCount]),
      );

      // Add equipped count to each result
      return usage.map((item) => ({
        ...item,
        equippedCount: equippedCountMap.get(item.bloodlineId) || 0,
      }));
    }),
  getJutsuBalanceStatistics: publicProcedure
    .input(
      z.object({
        battleTypes: z.array(z.enum(BattleTypes)).optional(),
        minCount: z.number().min(1).default(1),
        jutsuEffects: z.array(z.string()).optional(),
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
  getItemBalanceStatistics: publicProcedure
    .input(
      z.object({
        battleTypes: z.array(z.enum(BattleTypes)).optional(),
        minCount: z.number().min(1).default(1),
        itemTypes: z.array(z.string()).optional(),
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
        whereConditions.push(
          inArray(userData.villageId, input.villages as StarterVillage[]),
        );
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
