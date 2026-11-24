import type { Metadata } from "next";
import { cache } from "react";
import { GUIDE_CATEGORY_LABELS } from "@/drizzle/constants";
import { buildMetadata, metaDescription, noindexMetadata } from "@/libs/seo";
import { fetchGuideBySlug } from "@/queries/guide";
import { drizzleDB } from "@/server/db";

type Props = { params: Promise<{ slug: string }> };

export const getGuide = cache(
  async (slug: string) => await fetchGuideBySlug(drizzleDB, slug),
);

/**
 * The stored seoDescription is written as the whole snippet. The templated lead-in only
 * belongs on the fallback, where the excerpt or body opening needs the framing; on top
 * of a hand-written description it would repeat the title and the brand back to back.
 */
export const guideDescription = (article: {
  title: string;
  category: keyof typeof GUIDE_CATEGORY_LABELS;
  seoDescription: string | null;
  excerpt: string | null;
  content: string;
}) =>
  article.seoDescription
    ? metaDescription(article.seoDescription)
    : metaDescription(
        article.excerpt || article.content,
        `${article.title} is a ${GUIDE_CATEGORY_LABELS[article.category].toLowerCase()} guide for TheNinja-RPG.`,
      );

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { slug } = await props.params;
  const article = await getGuide(slug);
  if (!article?.published) return noindexMetadata("Guide Not Found");
  return buildMetadata({
    title: article.seoTitle || article.title,
    description: guideDescription(article),
    path: `/guide/${article.slug}`,
    image: article.image || undefined,
    type: "article",
  });
}
