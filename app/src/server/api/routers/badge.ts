import { nanoid } from "nanoid";
import { z } from "zod";
import { badge } from "@/drizzle/schema";
import {
  deletedReason,
  editedReason,
  outdateProposalsFor,
} from "@/libs/contentReview/outdate";
import { callDiscordContent } from "@/libs/socials";
import {
  countBadgeAchievers,
  deleteBadgeForDelete,
  deleteUserBadgeForDelete,
  fetchBadge,
  findBadgeForUpdate,
  insertActionLogForDelete,
  insertActionLogForUpdate,
  insertBadgeForCreate,
  listBadgeAchievers,
  listBadgeForGetAll,
  listBadgeForGetAllNames,
  updateBadgeForUpdate,
} from "@/queries/badge";
import { fetchUser } from "@/queries/profile";

import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
  serverError,
} from "@/server/api/trpc";
import { setEmptyStringsToNulls } from "@/server/utils/emptyStrings";
import { offsetPage } from "@/server/utils/pagination";
import { calculateContentDiff } from "@/utils/diff";
import { canChangeContent } from "@/utils/permissions";
import { BadgeValidator } from "@/validators/badge";
import { idSchema } from "@/validators/misc";

export const badgeRouter = createTRPCRouter({
  /** Public, read-only holder pages and totals; independent reads run concurrently. */
  getAchievers: publicProcedure
    .input(
      z.object({
        badgeId: z.string().min(1).max(191),
        page: z.number().int().min(0).max(100_000).default(0),
        limit: z.number().int().min(1).max(50).default(10),
        order: z.enum(["newest", "oldest"]).default("newest"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [users, counts] = await Promise.all([
        listBadgeAchievers(ctx.drizzle, input),
        countBadgeAchievers(ctx.drizzle, input.badgeId),
      ]);
      const total = counts[0]?.total ?? 0;
      return {
        users,
        total,
        hasMore: (input.page + 1) * input.limit < total,
      };
    }),
  getAllNames: publicProcedure
    .meta({ mcp: { description: "Get all badge names and images" } })
    .query(async ({ ctx }) => {
      return await listBadgeForGetAllNames(ctx.drizzle);
    }),
  getAll: publicProcedure
    .meta({ mcp: { description: "Get all badges with pagination" } })
    .input(
      z
        .object({
          cursor: z.number().nullish(),
          limit: z.number().min(1).max(500),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ? input.limit : 100;
      const { skip, cursorAfter } = offsetPage({ cursor: input?.cursor, limit });
      const results = await listBadgeForGetAll(ctx.drizzle, skip, limit);
      const nextCursor = cursorAfter(results);
      return {
        data: results,
        nextCursor: nextCursor,
      };
    }),
  get: publicProcedure
    .meta({ mcp: { description: "Get badge by ID" } })
    .input(idSchema)
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
      setEmptyStringsToNulls(input.data, badge);
      const [user, entry, badgeWithName] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchBadge(ctx.drizzle, input.id),
        findBadgeForUpdate(ctx.drizzle, input),
      ]);
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!entry) return errorResponse("Badge not found");
      if (badgeWithName && badgeWithName.id !== entry.id)
        return errorResponse("Badge name already exists");
      if (!canChangeContent(user.role)) {
        return errorResponse(`Not allowed to edit badge`);
      }
      // Calculate diff
      const diff = calculateContentDiff(entry, {
        id: entry.id,
        createdAt: entry.createdAt,
        ...input.data,
      });
      // Update database
      await Promise.all([
        updateBadgeForUpdate(ctx.drizzle, input, entry),
        insertActionLogForUpdate(ctx.drizzle, ctx, diff, entry),
      ]);
      await outdateProposalsFor(
        ctx.drizzle,
        "BADGE",
        [entry.id],
        editedReason("BADGE", entry.name, user.username),
      );
      await callDiscordContent(user.username, entry.name, diff, entry.image);
      return { success: true, message: `Data updated: ${diff.join(". ")}` };
    }),
  create: protectedProcedure.output(baseServerResponse).mutation(async ({ ctx }) => {
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    if (!canChangeContent(user.role)) {
      return errorResponse(`Not allowed to create badge`);
    }
    const id = nanoid();
    await insertBadgeForCreate(ctx.drizzle, id);
    return { success: true, message: id };
  }),
  delete: protectedProcedure
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, entry] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchBadge(ctx.drizzle, input.id),
      ]);
      if (!entry || !canChangeContent(user.role)) {
        return errorResponse(`Not allowed to delete badge`);
      }
      await Promise.all([
        deleteBadgeForDelete(ctx.drizzle, input),
        deleteUserBadgeForDelete(ctx.drizzle, input),
        insertActionLogForDelete(ctx.drizzle, ctx, entry),
      ]);
      await outdateProposalsFor(
        ctx.drizzle,
        "BADGE",
        [entry.id],
        deletedReason("BADGE", entry.name, user.username),
      );
      return { success: true, message: `Badge deleted` };
    }),
});
