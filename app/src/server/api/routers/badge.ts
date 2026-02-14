import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { baseServerResponse, errorResponse, serverError } from "@/api/trpc";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import { actionLog, badge, userBadge } from "@/drizzle/schema";
import { callDiscordContent } from "@/libs/socials";
import { fetchUser } from "@/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { calculateContentDiff } from "@/utils/diff";
import { canChangeContent } from "@/utils/permissions";
import { setEmptyStringsToNulls } from "@/utils/typeutils";
import { BadgeValidator } from "@/validators/badge";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";

export const badgeRouter = createTRPCRouter({
  getAllNames: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get all badge names and images" } })
    .query(async ({ ctx }) => {
      return await ctx.drizzle.query.badge.findMany({
        columns: { id: true, name: true, image: true },
        orderBy: (table, { asc }) => [asc(table.name)],
      });
    }),
  getAll: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get all badges with pagination" } })
    .input(
      z
        .object({
          cursor: z.number().nullish(),
          limit: z.number().min(1).max(500),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input?.cursor ? input.cursor : 0;
      const limit = input?.limit ? input.limit : 100;
      const skip = currentCursor * limit;
      const results = await ctx.drizzle.query.badge.findMany({
        offset: skip,
        limit: limit,
        orderBy: asc(badge.name),
      });
      const nextCursor = results.length < limit ? null : currentCursor + 1;
      return {
        data: results,
        nextCursor: nextCursor,
      };
    }),
  get: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get badge by ID" } })
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await fetchBadge(ctx.drizzle, input.id);
      if (!result) {
        throw serverError("NOT_FOUND", "Badge not found");
      }
      return result;
    }),
  update: protectedProcedure
    .input(z.object({ id: z.string(), data: BadgeValidator }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      setEmptyStringsToNulls(input.data);
      const [user, entry, badgeWithName] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchBadge(ctx.drizzle, input.id),
        ctx.drizzle.query.badge.findFirst({
          columns: { name: true, id: true },
          where: eq(badge.name, input.data.name),
        }),
      ]);
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!entry) return errorResponse("Badge not found");
      if (badgeWithName && badgeWithName.id !== entry.id)
        return errorResponse("Badge name already exists");
      if (canChangeContent(user.role)) {
        // Calculate diff
        const diff = calculateContentDiff(entry, {
          id: entry.id,
          createdAt: entry.createdAt,
          ...input.data,
        });
        // Update database
        await Promise.all([
          ctx.drizzle.update(badge).set(input.data).where(eq(badge.id, entry.id)),
          ctx.drizzle.insert(actionLog).values({
            id: nanoid(),
            userId: ctx.userId,
            tableName: "badge",
            changes: diff,
            relatedId: entry.id,
            relatedMsg: `Update: ${entry.name}`,
            relatedImage: entry.image,
          }),
        ]);
        if (process.env.NODE_ENV !== "development") {
          await callDiscordContent(user.username, entry.name, diff, entry.image);
        }
        return { success: true, message: `Data updated: ${diff.join(". ")}` };
      } else {
        return { success: false, message: `Not allowed to edit badge` };
      }
    }),
  create: protectedProcedure.output(baseServerResponse).mutation(async ({ ctx }) => {
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    if (canChangeContent(user.role)) {
      const id = nanoid();
      await ctx.drizzle.insert(badge).values({
        id: id,
        name: `New Badge - ${id}`,
        image: IMG_AVATAR_DEFAULT,
        description: "",
      });
      return { success: true, message: id };
    } else {
      return { success: false, message: `Not allowed to create badge` };
    }
  }),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      const entry = await fetchBadge(ctx.drizzle, input.id);
      if (entry && canChangeContent(user.role)) {
        await Promise.all([
          ctx.drizzle.delete(badge).where(eq(badge.id, input.id)),
          ctx.drizzle.delete(userBadge).where(eq(userBadge.badgeId, input.id)),
          ctx.drizzle.insert(actionLog).values({
            id: nanoid(),
            userId: ctx.userId,
            tableName: "badge",
            changes: [`Deleted: ${entry.name}`],
            relatedId: entry.id,
            relatedMsg: `Delete: ${entry.name}`,
            relatedImage: entry.image,
          }),
        ]);
        return { success: true, message: `Badge deleted` };
      } else {
        return { success: false, message: `Not allowed to delete badge` };
      }
    }),
});

/**
 * COMMON QUERIES WHICH ARE REUSED
 */

export const fetchBadge = async (client: DrizzleClient, id: string) => {
  return await client.query.badge.findFirst({
    where: eq(badge.id, id),
  });
};
