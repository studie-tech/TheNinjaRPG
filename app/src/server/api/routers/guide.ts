import { and, asc, eq, inArray, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { GuideCategory } from "@/drizzle/constants";
import { actionLog, bloodline, guideArticle, item, userData } from "@/drizzle/schema";
import { isGuideworthyEntityName } from "@/libs/guide/generate";
import { fetchUser } from "@/routers/profile";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
  serverError,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { calculateContentDiff } from "@/utils/diff";
import { canChangeContent } from "@/utils/permissions";
import { moderateUserText } from "@/utils/profanity";
import { setEmptyStringsToNulls } from "@/utils/typeutils";
import { GuideArticleValidator, GuideListFilterSchema } from "@/validators/guide";
import { idSchema } from "@/validators/misc";

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
    .input(idSchema)
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

/**
 * Every farmable seed with the herb it grows into, for the farming hub's catalog.
 *
 * This is what replaced the per-item guide pages: one table sourced from live item data
 * ranks for "farming" queries where twenty-eight templated stubs ranked for nothing,
 * and it cannot go stale the way seeded prose does.
 */
export const fetchFarmCatalog = async (client: DrizzleClient) => {
  const seeds = await client.query.item.findMany({
    columns: {
      id: true,
      name: true,
      rarity: true,
      cost: true,
      farmMinLevel: true,
      farmGrowTimeSeconds: true,
      farmPlantExperience: true,
      farmYieldItemId: true,
    },
    where: and(eq(item.isFarmSeed, true), eq(item.hidden, false)),
    orderBy: [asc(item.farmMinLevel), asc(item.name)],
  });
  const yieldIds = seeds.flatMap((row) =>
    row.farmYieldItemId ? [row.farmYieldItemId] : [],
  );
  const yields = yieldIds.length
    ? await client.query.item.findMany({
        columns: { id: true, name: true },
        where: and(inArray(item.id, yieldIds), eq(item.hidden, false)),
      })
    : [];
  // Same visibility rules as the seeds themselves: a visible seed can still point at a
  // hidden or QA yield, and this table must not be the place that discloses it. A
  // filtered yield leaves its row's "grows into" cell blank rather than dropping the seed.
  const yieldById = new Map(
    yields
      .filter((row) => isGuideworthyEntityName(row.name))
      .map((row) => [row.id, row]),
  );
  return seeds
    .filter((row) => isGuideworthyEntityName(row.name))
    .map((row) => ({
      ...row,
      yield: row.farmYieldItemId ? (yieldById.get(row.farmYieldItemId) ?? null) : null,
    }));
};

/**
 * Every visible bloodline with its published guide, when one exists, for the bloodlines
 * hub. The join is what lets the hub, the encyclopedia and the guide all point at one
 * another without any of them hard-coding a slug.
 */
export const fetchBloodlineCatalog = async (client: DrizzleClient) => {
  const [rows, guides] = await Promise.all([
    client.query.bloodline.findMany({
      columns: { id: true, name: true, rank: true, image: true },
      where: eq(bloodline.hidden, false),
      orderBy: [asc(bloodline.rank), asc(bloodline.name)],
    }),
    client.query.guideArticle.findMany({
      columns: { slug: true, relatedBloodlineId: true },
      where: and(
        eq(guideArticle.published, true),
        or(eq(guideArticle.category, "bloodlines"), eq(guideArticle.category, "world")),
      ),
    }),
  ]);
  const guideByBloodline = new Map(
    guides.flatMap((g) =>
      g.relatedBloodlineId ? [[g.relatedBloodlineId, g.slug]] : [],
    ),
  );
  return rows
    .filter((row) => isGuideworthyEntityName(row.name))
    .map((row) => ({ ...row, guideSlug: guideByBloodline.get(row.id) ?? null }));
};

/** The published guide written for one bloodline, if any, for the encyclopedia page. */
export const fetchGuideForBloodline = async (
  client: DrizzleClient,
  bloodlineId: string,
) => {
  return await client.query.guideArticle.findFirst({
    columns: { slug: true, title: true },
    where: and(
      eq(guideArticle.published, true),
      eq(guideArticle.relatedBloodlineId, bloodlineId),
    ),
  });
};
