import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { bloodline, guideArticle, item } from "@/drizzle/schema";
import { SYSTEM_GUIDE_ARTICLES } from "@/libs/guide/articles";
import { GUIDE_SYSTEM_COVERS } from "@/libs/guide/covers";
import { factCheckGuideProse } from "@/libs/guide/factcheck";
import {
  generateBloodlineGuide,
  generateItemGuide,
  isGuideworthyEntityName,
} from "@/libs/guide/generate";
import { isReservedGuideSlug } from "@/libs/guide/html";
import type { DrizzleClient } from "@/server/db";

const upsertArticle = async (
  client: DrizzleClient,
  article: (typeof SYSTEM_GUIDE_ARTICLES)[number] & {
    relatedBloodlineId?: string | null;
    relatedItemId?: string | null;
    relatedJutsuId?: string | null;
  },
) => {
  if (isReservedGuideSlug(article.slug)) return;
  const issues = factCheckGuideProse(`${article.title} ${article.content}`);
  const reviewNotes = [...(article.reviewNotes ? [article.reviewNotes] : [])];
  if (issues.length > 0) {
    reviewNotes.push(...issues.map((issue) => issue.message));
  }
  const values = {
    slug: article.slug,
    title: article.title,
    subtitle: article.subtitle,
    excerpt: article.excerpt,
    seoTitle: article.seoTitle,
    seoDescription: article.seoDescription,
    category: article.category,
    content: article.content,
    image: GUIDE_SYSTEM_COVERS[article.slug] ?? article.image ?? null,
    faq: article.faq ?? null,
    sortOrder: article.sortOrder,
    published: issues.length > 0 ? false : article.published,
    sourceUrl: article.sourceUrl ?? null,
    reviewNotes: reviewNotes.length > 0 ? reviewNotes.join("\n") : null,
    relatedBloodlineId: article.relatedBloodlineId ?? null,
    relatedItemId: article.relatedItemId ?? null,
    relatedJutsuId: article.relatedJutsuId ?? null,
  };

  const existing = await client.query.guideArticle.findFirst({
    columns: { id: true },
    where: eq(guideArticle.slug, article.slug),
  });
  if (existing) {
    return;
  }
  await client.insert(guideArticle).values({ id: nanoid(), ...values });
};

const SYSTEM_SLUGS = new Set(SYSTEM_GUIDE_ARTICLES.map((article) => article.slug));

export const seedGuides = async (client: DrizzleClient) => {
  console.log("\nSyncing player guide articles...\n");
  for (const article of SYSTEM_GUIDE_ARTICLES) {
    await upsertArticle(client, article);
  }

  const [bloodlines, items] = await Promise.all([
    client.query.bloodline.findMany({
      columns: {
        id: true,
        name: true,
        description: true,
        image: true,
        rank: true,
        hidden: true,
      },
      where: eq(bloodline.hidden, false),
    }),
    client.query.item.findMany({
      columns: {
        id: true,
        name: true,
        description: true,
        image: true,
        itemType: true,
        rarity: true,
        hidden: true,
        isFarmSeed: true,
        farmYieldItemId: true,
      },
      where: eq(item.hidden, false),
    }),
  ]);

  for (const row of bloodlines) {
    if (!isGuideworthyEntityName(row.name)) continue;
    const generated = generateBloodlineGuide(row);
    if (SYSTEM_SLUGS.has(generated.slug)) continue;
    await upsertArticle(client, {
      ...generated,
      relatedBloodlineId: row.id,
    });
  }

  const farmYieldItemIds = new Set(
    items.flatMap((row) =>
      row.isFarmSeed && row.farmYieldItemId ? [row.farmYieldItemId] : [],
    ),
  );
  const herbs = items.filter(
    (row) =>
      isGuideworthyEntityName(row.name) &&
      (row.isFarmSeed || farmYieldItemIds.has(row.id)),
  );
  for (const row of herbs) {
    const generated = generateItemGuide(row);
    if (SYSTEM_SLUGS.has(generated.slug)) continue;
    await upsertArticle(client, {
      ...generated,
      relatedItemId: row.id,
    });
  }

  console.log("Done syncing player guide articles!");
};
