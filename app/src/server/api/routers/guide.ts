import { nanoid } from "nanoid";
import { z } from "zod";
import { guideArticle } from "@/drizzle/schema";
import {
  deleteGuideArticleForDelete,
  fetchGuide,
  fetchPublishedGuides,
  findGuideArticleForUpdate,
  insertActionLogForDelete,
  insertActionLogForUpdate,
  insertGuideArticleForCreate,
  listGuideArticleForGetAll,
  updateGuideArticleForUpdate,
} from "@/queries/guide";
import { fetchUser, fetchViewerRole } from "@/queries/profile";

import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
  serverError,
} from "@/server/api/trpc";
import { setEmptyStringsToNulls } from "@/server/utils/emptyStrings";
import { calculateContentDiff } from "@/utils/diff";
import { canChangeContent } from "@/utils/permissions";
import { moderateUserText } from "@/utils/profanity";
import { GuideArticleValidator } from "@/validators/guide";
import { idSchema } from "@/validators/misc";

const GuideListFilterSchema = z.object({
  includeDrafts: z.boolean().optional(),
});

export const guideRouter = createTRPCRouter({
  getAll: publicProcedure
    .meta({ mcp: { description: "List player guide articles" } })
    .input(GuideListFilterSchema.optional())
    .query(async ({ ctx, input }) => {
      const viewerRole = await fetchViewerRole(ctx.drizzle, ctx.userId);
      const includeDrafts = Boolean(
        input?.includeDrafts && canChangeContent(viewerRole),
      );
      if (!includeDrafts) {
        return await fetchPublishedGuides(ctx.drizzle);
      }
      return await listGuideArticleForGetAll(ctx.drizzle);
    }),
  get: publicProcedure
    .meta({ mcp: { description: "Get a guide article by ID" } })
    .input(idSchema)
    .query(async ({ ctx, input }) => {
      const article = await fetchGuide(ctx.drizzle, input.id);
      if (!article) throw serverError("NOT_FOUND", "Guide not found");
      if (!article.published) {
        const viewerRole = await fetchViewerRole(ctx.drizzle, ctx.userId);
        if (!canChangeContent(viewerRole)) {
          throw serverError("NOT_FOUND", "Guide not found");
        }
      }
      return article;
    }),
  create: protectedProcedure.output(baseServerResponse).mutation(async ({ ctx }) => {
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    if (user.isBanned)
      return errorResponse("You are banned and cannot perform this action");
    if (!canChangeContent(user.role)) {
      return errorResponse("Not allowed to create guide articles");
    }
    const id = nanoid();
    const slug = `new-guide-${id.slice(0, 8)}`;
    await insertGuideArticleForCreate(ctx.drizzle, id, slug, ctx);
    return { success: true, message: id };
  }),
  update: protectedProcedure
    .input(z.object({ id: z.string(), data: GuideArticleValidator }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      setEmptyStringsToNulls(input.data, guideArticle);
      const [user, entry, slugOwner] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchGuide(ctx.drizzle, input.id),
        findGuideArticleForUpdate(ctx.drizzle, input),
      ]);
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!entry) return errorResponse("Guide not found");
      if (!canChangeContent(user.role))
        return errorResponse("Not allowed to edit guides");
      if (slugOwner && slugOwner.id !== entry.id) {
        return errorResponse("Another guide already uses that slug");
      }

      const moderated = await moderateUserText(input.data.content);
      if (!moderated.success) return errorResponse(moderated.message);

      const next = {
        ...input.data,
        content: moderated.sanitized,
        faq: input.data.faq?.length ? input.data.faq : null,
        updatedAt: new Date(),
        updatedByUserId: ctx.userId,
      };
      const diff = calculateContentDiff(entry, { ...entry, ...next });
      await Promise.all([
        updateGuideArticleForUpdate(ctx.drizzle, next, entry),
        insertActionLogForUpdate(ctx.drizzle, ctx, diff, entry, next),
      ]);
      return { success: true, message: `Guide updated: ${diff.join(". ")}` };
    }),
  delete: protectedProcedure
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, entry] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchGuide(ctx.drizzle, input.id),
      ]);
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!entry || !canChangeContent(user.role)) {
        return errorResponse("Not allowed to delete this guide");
      }
      await Promise.all([
        deleteGuideArticleForDelete(ctx.drizzle, input),
        insertActionLogForDelete(ctx.drizzle, ctx, entry),
      ]);
      return { success: true, message: "Guide deleted" };
    }),
});
