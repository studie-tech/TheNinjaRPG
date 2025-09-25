import { z } from "zod";
import { createTRPCRouter, publicProcedure, protectedProcedure } from "../trpc";
import { eq, and, like, inArray, isNotNull } from "drizzle-orm";
import { extractValueFromJson } from "@/utils/regex";
import {
  actionLog,
  village,
  bloodline,
  userData,
  bloodlineRolls,
} from "@/drizzle/schema";
import { actionLogSchema } from "@/validators/logs";
import { fetchUser } from "@/routers/profile";
import { canSeeSecretData } from "@/utils/permissions";

export const logsRouter = createTRPCRouter({
  getContentChanges: publicProcedure
    .input(
      actionLogSchema.extend({
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(100),
        relatedId: z.string().optional(),
        username: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input.cursor ? input.cursor : 0;
      const skip = currentCursor * input.limit;
      // Query
      const [user, target] = await Promise.all([
        ctx.userId ? fetchUser(ctx.drizzle, ctx.userId) : null,
        ctx.userId
          ? await ctx.drizzle.query.userData.findFirst({
              where: like(userData.username, `%${input.username}%`),
            })
          : null,
      ]);
      // Get entries
      const entries = await ctx.drizzle.query.actionLog.findMany({
        where: and(
          eq(actionLog.tableName, input.logtype),
          ...(input.relatedId ? [eq(actionLog.relatedId, input.relatedId)] : []),
          ...(input.search ? [like(actionLog.changes, `%${input.search}%`)] : []),
          // Username filtering if allowed
          ...(input.username && user && target && canSeeSecretData(user.role)
            ? [eq(actionLog.userId, target.userId)]
            : []),
        ),
        columns: {
          userId: true,
          createdAt: true,
          changes: true,
          relatedId: true,
          relatedMsg: true,
          relatedImage: true,
        },
        with: {
          user: {
            columns: {
              username: true,
            },
          },
        },
        offset: skip,
        orderBy: (table, { desc }) => desc(table.createdAt),
        limit: input.limit,
      });
      // Overwrite all villageIds, bloodlineIds, etc. with their names
      const villageIds: string[] = [];
      const bloodlineIds: string[] = [];
      entries.forEach((entry) => {
        (entry.changes as string[]).forEach((change) => {
          const bloodlineId = extractValueFromJson(change, "bloodlineId");
          const villageId = extractValueFromJson(change, "villageId");
          if (bloodlineId) bloodlineIds.push(bloodlineId);
          if (villageId) villageIds.push(villageId);
        });
      });
      const [bloodlines, villages] = await Promise.all([
        ctx.drizzle.query.bloodline.findMany({
          where: inArray(bloodline.id, bloodlineIds),
          columns: { id: true, name: true },
        }),
        ctx.drizzle.query.village.findMany({
          where: inArray(village.id, villageIds),
          columns: { id: true, name: true },
        }),
      ]);
      // If user is not set, or not allowed to see secret data, hide username
      if (!user || !canSeeSecretData(user.role)) {
        entries.forEach((entry) => {
          entry.userId = "staff";
          if (entry.user) {
            entry.user.username = "staff";
          }
        });
      }

      // Return
      const nextCursor = entries.length < input.limit ? null : currentCursor + 1;
      return {
        data: entries.map((entry) => ({
          ...entry,
          changes: (entry.changes as string[])?.map((change) => {
            bloodlines.forEach((b) => {
              change = change.replace(b.id, `${b.id} - ${b.name}`);
            });
            villages.forEach((v) => {
              change = change.replace(v.id, `${v.id} - ${v.name}`);
            });
            return change;
          }),
        })),
        nextCursor: nextCursor,
      };
    }),
  getBloodlineHistory: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!user || !canSeeSecretData(user.role)) {
        return [];
      }
      // Get bloodline history
      const userRolls = await ctx.drizzle.query.bloodlineRolls.findMany({
        where: and(
          eq(bloodlineRolls.userId, input.userId),
          isNotNull(bloodlineRolls.bloodlineId),
        ),
        with: { bloodline: true },
        orderBy: (table, { desc }) => desc(table.createdAt),
      });

      return userRolls
        .map((roll) => {
          if (!roll.bloodline) return null;
          return {
            ...roll.bloodline,
            type: roll.type,
            createdAt: roll.createdAt,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
    }),
});
