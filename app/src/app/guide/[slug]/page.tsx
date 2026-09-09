import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { GUIDE_CATEGORY_LABELS } from "@/drizzle/constants";
import { GuideArticleView } from "@/layout/GuideArticleView";
import { GuideStructuredData } from "@/layout/GuideStructuredData";
import { buildMetadata, metaDescription } from "@/libs/seo";
import {
  fetchGuideBySlug,
  fetchNeighborGuides,
  fetchPublishedGuides,
} from "@/server/api/routers/guide";
import { drizzleDB } from "@/server/db";

type Props = { params: Promise<{ slug: string }> };

const getPublishedGuide = cache(async (slug: string) => {
  const article = await fetchGuideBySlug(drizzleDB, slug);
  return article && article.published ? article : undefined;
});

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { slug } = await props.params;
  const article = await getPublishedGuide(slug);
  if (!article) return { title: "Guide Not Found" };
  const categoryLabel = GUIDE_CATEGORY_LABELS[article.category];
  return buildMetadata({
    title: article.seoTitle || article.title,
    description: metaDescription(
      article.seoDescription || article.excerpt || article.content,
      `${article.title} is a ${categoryLabel.toLowerCase()} guide for TheNinja-RPG.`,
    ),
    path: `/guide/${article.slug}`,
    image: article.image || undefined,
    type: "article",
  });
}

export default async function GuideArticlePage(props: Props) {
  const { slug } = await props.params;
  const article = await getPublishedGuide(slug);
  if (!article) notFound();

  const [neighbors, catalog] = await Promise.all([
    fetchNeighborGuides(drizzleDB, article.category, article.slug),
    fetchPublishedGuides(drizzleDB),
  ]);
  const neighborSlugs = new Set(
    [neighbors.previous?.slug, neighbors.next?.slug].filter(Boolean),
  );
  const related = catalog
    .filter(
      (row) =>
        row.category === article.category &&
        row.slug !== article.slug &&
        !neighborSlugs.has(row.slug),
    )
    .slice(0, 4)
    .map((row) => ({
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt,
      image: row.image,
    }));

  const description = metaDescription(
    article.seoDescription || article.excerpt || article.content,
  );

  return (
    <>
      <GuideStructuredData
        title={article.seoTitle || article.title}
        description={description}
        slug={article.slug}
        category={article.category}
        updatedAt={article.updatedAt}
        image={article.image}
        faq={article.faq}
      />
      <GuideArticleView
        article={article}
        previous={neighbors.previous}
        next={neighbors.next}
        related={related}
      />
    </>
  );
}
