import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { baseServerResponse, errorResponse, serverError } from "@/api/trpc";
import type { GuideCategory } from "@/drizzle/constants";
import { actionLog, guideArticle, userData } from "@/drizzle/schema";
import { fetchUser } from "@/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { calculateContentDiff } from "@/utils/diff";
import { canChangeContent } from "@/utils/permissions";
import { moderateUserText } from "@/utils/profanity";
import { setEmptyStringsToNulls } from "@/utils/typeutils";
import { GuideArticleValidator, GuideListFilterSchema } from "@/validators/guide";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";

export const guideRouter = createTRPCRouter({
  getAll: publicProcedure
    .meta({ mcp: { enabled: true, description: "List player guide articles" } })
    .input(GuideListFilterSchema.optional())
    .query(async ({ ctx, input }) => {
      const viewer = ctx.userId
        ? await ctx.drizzle.query.userData.findFirst({
            columns: { role: true },
            where: eq(userData.userId, ctx.userId),
          })
        : null;
      const canSeeDrafts = Boolean(viewer && canChangeContent(viewer.role));
      const includeDrafts = Boolean(input?.includeDrafts && canSeeDrafts);
      if (!includeDrafts) {
        return await fetchPublishedGuides(ctx.drizzle);
      }
      return await ctx.drizzle.query.guideArticle.findMany({
        orderBy: [asc(guideArticle.sortOrder), asc(guideArticle.title)],
      });
    }),
  get: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get a guide article by ID" } })
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const article = await fetchGuide(ctx.drizzle, input.id);
      if (!article) throw serverError("NOT_FOUND", "Guide not found");
      if (!article.published) {
        const viewer = ctx.userId
          ? await ctx.drizzle.query.userData.findFirst({
              columns: { role: true },
              where: eq(userData.userId, ctx.userId),
            })
          : null;
        if (!viewer || !canChangeContent(viewer.role)) {
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
    await ctx.drizzle.insert(guideArticle).values({
      id,
      slug,
      title: "New guide article",
      subtitle: "",
      excerpt: "",
      seoTitle: "",
      seoDescription: "",
      category: "reference",
      content: "<p>Write the guide here.</p>",
      published: false,
      sortOrder: 100,
      updatedByUserId: ctx.userId,
    });
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
        ctx.drizzle.query.guideArticle.findFirst({
          columns: { id: true, slug: true },
          where: eq(guideArticle.slug, input.data.slug),
        }),
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
        ctx.drizzle.update(guideArticle).set(next).where(eq(guideArticle.id, entry.id)),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "guide",
          changes: diff,
          relatedId: entry.id,
          relatedMsg: `Update: ${next.title}`.slice(0, 191),
          relatedImage: next.image ?? entry.image,
        }),
      ]);
      return { success: true, message: `Guide updated: ${diff.join(". ")}` };
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
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
        ctx.drizzle.delete(guideArticle).where(eq(guideArticle.id, input.id)),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "guide",
          changes: [`Deleted: ${entry.title}`],
          relatedId: entry.id,
          relatedMsg: `Delete: ${entry.title}`.slice(0, 191),
          relatedImage: entry.image,
        }),
      ]);
      return { success: true, message: "Guide deleted" };
    }),
});

export const fetchGuide = async (client: DrizzleClient, id: string) => {
  return await client.query.guideArticle.findFirst({
    where: eq(guideArticle.id, id),
  });
};

export const fetchGuideBySlug = async (client: DrizzleClient, slug: string) => {
  return await client.query.guideArticle.findFirst({
    where: eq(guideArticle.slug, slug),
  });
};

export const fetchPublishedGuides = async (client: DrizzleClient) => {
  return await client.query.guideArticle.findMany({
    where: eq(guideArticle.published, true),
    orderBy: [asc(guideArticle.sortOrder), asc(guideArticle.title)],
  });
};

export const fetchNeighborGuides = async (
  client: DrizzleClient,
  category: GuideCategory,
  slug: string,
) => {
  const siblings = await client.query.guideArticle.findMany({
    where: and(eq(guideArticle.published, true), eq(guideArticle.category, category)),
    columns: {
      slug: true,
      title: true,
      excerpt: true,
      image: true,
    },
    orderBy: [asc(guideArticle.sortOrder), asc(guideArticle.title)],
  });
  const index = siblings.findIndex((row) => row.slug === slug);
  const previous = index > 0 ? siblings[index - 1] : undefined;
  const next =
    index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : undefined;
  const neighborSlugs = new Set([slug, previous?.slug, next?.slug]);
  return {
    previous,
    next,
    related: siblings.filter((row) => !neighborSlugs.has(row.slug)).slice(0, 4),
  };
};
