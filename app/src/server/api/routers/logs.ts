import { z } from "zod";
import {
  findUserDataForGetContentChanges,
  listActionLogForGetContentChanges,
  listBloodlineForGetContentChanges,
  listBloodlineRollsForGetBloodlineHistory,
  listVillageForGetContentChanges,
} from "@/queries/logs";
import { fetchUser } from "@/queries/profile";

import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "@/server/api/trpc";
import { offsetPage } from "@/server/utils/pagination";
import { canSeeSecretData } from "@/utils/permissions";
import { extractValueFromJson } from "@/utils/regex";
import { actionLogSchema } from "@/validators/logs";

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
      const { skip, cursorAfter } = offsetPage(input);
      // Query
      const [user, target] = await Promise.all([
        ctx.userId ? fetchUser(ctx.drizzle, ctx.userId) : null,
        ctx.userId && input.username
          ? findUserDataForGetContentChanges(ctx.drizzle, { username: input.username })
          : null,
      ]);
      // Get entries
      const entries = await listActionLogForGetContentChanges(
        ctx.drizzle,
        input,
        user,
        target,
        skip,
      );
      // Overwrite all villageIds, bloodlineIds, etc. with their names
      const villageIds = new Set<string>();
      const bloodlineIds = new Set<string>();
      entries.forEach((entry) => {
        (entry.changes as string[]).forEach((change) => {
          const bloodlineId = extractValueFromJson(change, "bloodlineId");
          const villageId = extractValueFromJson(change, "villageId");
          if (bloodlineId) bloodlineIds.add(bloodlineId);
          if (villageId) villageIds.add(villageId);
        });
      });
      const [bloodlines, villages] = await Promise.all([
        bloodlineIds.size > 0
          ? listBloodlineForGetContentChanges(ctx.drizzle, bloodlineIds)
          : [],
        villageIds.size > 0
          ? listVillageForGetContentChanges(ctx.drizzle, villageIds)
          : [],
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
      const nextCursor = cursorAfter(entries);
      return {
        data: entries.map((entry) => ({
          ...entry,
          changes: (entry.changes as string[]).map((change) => {
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
      if (!canSeeSecretData(user.role)) {
        return [];
      }
      // Get bloodline history
      const userRolls = await listBloodlineRollsForGetBloodlineHistory(
        ctx.drizzle,
        input,
      );

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
