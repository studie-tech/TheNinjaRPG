import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";
import { GUIDE_CATEGORY_LABELS } from "@/drizzle/constants";
import { GuideArticleView } from "@/layout/GuideArticleView";
import { BloodlineCatalog, FarmCatalog } from "@/layout/GuideCatalog";
import { GuideStructuredData } from "@/layout/GuideStructuredData";
import { buildMetadata, metaDescription, stripSiteName } from "@/libs/seo";
import {
  fetchBloodlineCatalog,
  fetchFarmCatalog,
  fetchGuideBySlug,
  fetchNeighborGuides,
} from "@/server/api/routers/guide";
import { drizzleDB } from "@/server/db";

type Props = { params: Promise<{ slug: string }> };

const getGuide = cache(async (slug: string) => await fetchGuideBySlug(drizzleDB, slug));

/**
 * Where a retired generated stub sends its visitors. The per-entity pages were seeded
 * from item and bloodline rows and later unpublished as too thin to index; anyone still
 * holding one of those URLs -- a crawler included -- lands on the hub that replaced it
 * rather than a 404.
 */
const retiredStubTarget = (article: {
  relatedItemId: string | null;
  relatedBloodlineId: string | null;
}) => {
  if (article.relatedItemId) return "/guide/farming";
  if (article.relatedBloodlineId) return "/guide/bloodlines";
  return null;
};

/**
 * Hubs whose category used to be split across many thin pages get a table from live
 * game data instead. Keyed by slug so adding one is a single entry here.
 */
const HUB_CATALOGS: Record<string, () => Promise<React.ReactNode>> = {
  farming: async () => <FarmCatalog rows={await fetchFarmCatalog(drizzleDB)} />,
  bloodlines: async () => (
    <BloodlineCatalog rows={await fetchBloodlineCatalog(drizzleDB)} />
  ),
};

/**
 * The stored seoDescription is written as the whole snippet. The templated lead-in only
 * belongs on the fallback, where the excerpt or body opening needs the framing; on top
 * of a hand-written description it repeated the title and the brand back to back.
 */
const guideDescription = (article: {
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
  if (!article?.published) return { title: "Guide Not Found" };
  return buildMetadata({
    title: article.seoTitle || article.title,
    description: guideDescription(article),
    path: `/guide/${article.slug}`,
    image: article.image || undefined,
    type: "article",
  });
}

export default async function GuideArticlePage(props: Props) {
  const { slug } = await props.params;
  const article = await getGuide(slug);
  if (!article) notFound();
  if (!article.published) {
    const target = retiredStubTarget(article);
    if (target) permanentRedirect(target);
    notFound();
  }

  const [neighbors, catalog] = await Promise.all([
    fetchNeighborGuides(drizzleDB, article.category, article.slug),
    HUB_CATALOGS[article.slug]?.() ?? null,
  ]);

  return (
    <>
      <GuideStructuredData
        title={stripSiteName(article.seoTitle || article.title)}
        description={guideDescription(article)}
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
        related={neighbors.related}
        catalog={catalog}
      />
    </>
  );
}
