/**
 * Database access for guide; authorization and transaction scopes stay in callers.
 */
import { and, asc, eq, inArray, or } from "drizzle-orm";
import type { GuideCategory } from "@/drizzle/constants";
import { bloodline, guideArticle, item } from "@/drizzle/schema";
import { isGuideworthyEntityName } from "@/libs/guide/generate";
import type { DrizzleClient } from "@/server/db";

/** Load a guide by ID without applying publication visibility; the caller owns access checks. */
export const fetchGuide = async (client: DrizzleClient, id: string) => {
  return await client.query.guideArticle.findFirst({
    where: eq(guideArticle.id, id),
  });
};

/** Load a guide by slug without applying publication visibility; the caller owns access checks. */
export const fetchGuideBySlug = async (client: DrizzleClient, slug: string) => {
  return await client.query.guideArticle.findFirst({
    where: eq(guideArticle.slug, slug),
  });
};

/** Load published guides in stable sortOrder/title order. */
export const fetchPublishedGuides = async (client: DrizzleClient) => {
  return await client.query.guideArticle.findMany({
    where: eq(guideArticle.published, true),
    orderBy: [asc(guideArticle.sortOrder), asc(guideArticle.title)],
  });
};

/** Load published guides in one category and return adjacent guides plus up to four other related guides. */
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
 * Read seed and yield names from visible item definitions so the catalogue follows
 * published game data without exposing hidden or QA-only content.
 */
export const fetchFarmCatalog = async (client: DrizzleClient) => {
  const seeds = await client.query.item.findMany({
    columns: {
      id: true,
      name: true,
      rarity: true,
      cost: true,
      isFarmSeed: true,
      inShop: true,
      hidden: true,
      farmSellValue: true,
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

import { nanoid } from "nanoid";
import { actionLog } from "@/drizzle/schema";

/** Build the `guideArticle` listing for `getAll`. */
export const listGuideArticleForGetAll = (client: Pick<DrizzleClient, "query">) =>
  client.query.guideArticle.findMany({
    orderBy: [asc(guideArticle.sortOrder), asc(guideArticle.title)],
  });

/** Build the `guideArticle` insert for `create`. */
export const insertGuideArticleForCreate = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
  slug: string,
  ctx: { userId: string },
) =>
  client.insert(guideArticle).values({
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

/** Build the `guideArticle` lookup for `update`, selecting only `id` and `slug`, using predicates on `slug`. */
export const findGuideArticleForUpdate = (
  client: Pick<DrizzleClient, "query">,
  input: { data: { slug: string } },
) =>
  client.query.guideArticle.findFirst({
    columns: { id: true, slug: true },
    where: eq(guideArticle.slug, input.data.slug),
  });

/** Build the `guideArticle` update for `update`, using predicates on `id`. */
export const updateGuideArticleForUpdate = (
  client: Pick<DrizzleClient, "update">,
  next: Pick<
    import("@/drizzle/schema").GuideArticleInsert,
    | "content"
    | "title"
    | "category"
    | "slug"
    | "image"
    | "subtitle"
    | "excerpt"
    | "seoTitle"
    | "seoDescription"
    | "relatedBloodlineId"
    | "relatedItemId"
    | "relatedJutsuId"
    | "sourceUrl"
    | "reviewNotes"
  > & {
    faq: null | import("@/validators/guide").GuideFaqItem[];
    updatedAt: Date;
    updatedByUserId: string;
    sortOrder: number;
    published: false | true;
  },
  entry: { id: string },
) => client.update(guideArticle).set(next).where(eq(guideArticle.id, entry.id));

/** Build the `actionLog` insert for `update`. */
export const insertActionLogForUpdate = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  diff: string[],
  entry: { id: string; image: null | string },
  next: { title: string; image?: undefined | null | string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "guide",
    changes: diff,
    relatedId: entry.id,
    relatedMsg: `Update: ${next.title}`.slice(0, 191),
    relatedImage: next.image ?? entry.image,
  });

/** Build the `guideArticle` deletion for `delete`, using predicates on `id`. */
export const deleteGuideArticleForDelete = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(guideArticle).where(eq(guideArticle.id, input.id));

/** Build the `actionLog` insert for `delete`. */
export const insertActionLogForDelete = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  entry: { title: string; id: string; image: null | string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "guide",
    changes: [`Deleted: ${entry.title}`],
    relatedId: entry.id,
    relatedMsg: `Delete: ${entry.title}`.slice(0, 191),
    relatedImage: entry.image,
  });
