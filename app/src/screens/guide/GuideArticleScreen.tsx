import { notFound, redirect } from "next/navigation";
import { GuideArticleView } from "@/layout/GuideArticleView";
import { BloodlineCatalog, FarmCatalog } from "@/layout/GuideCatalog";
import { GuideStructuredData } from "@/layout/GuideStructuredData";
import { stripSiteName } from "@/libs/seo";
import {
  fetchBloodlineCatalog,
  fetchFarmCatalog,
  fetchNeighborGuides,
} from "@/queries/guide";
import {
  getGuide,
  guideDescription,
} from "@/screens/guide/GuideArticleScreen.metadata";
import { drizzleDB } from "@/server/db";

/** Render the guide screen independently of its route adapter. */
export async function GuideArticleScreen(props: Props) {
  const { slug } = props.params;
  const article = await getGuide(slug);
  if (!article) notFound();
  if (!article.published) {
    const target = draftStubTarget(article);
    if (target) redirect(target);
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

type Props = { params: { slug: string } };

/**
 * Where an unpublished generated stub (item- or bloodline-linked) sends its visitors:
 * its hub, so anyone still holding one of those URLs -- a crawler included -- lands on
 * content instead of a 404.
 *
 * The redirect is temporary (307) on purpose. It lasts exactly as long as the row stays
 * unpublished: generated stubs start as drafts, and a draft that staff later
 * write and publish must serve at its own slug again. A 308 would be cached by browsers
 * and read by Google as permanent, and would keep sending that page's visitors to the
 * hub after it went live.
 */
const draftStubTarget = (article: {
  relatedItemId: string | null;
  relatedBloodlineId: string | null;
}) => {
  if (article.relatedItemId) return "/guide/farming";
  if (article.relatedBloodlineId) return "/guide/bloodlines";
  return null;
};

/**
 * Hubs that render a catalog table from live game data. Keyed by slug so adding one is
 * a single entry here.
 */
const HUB_CATALOGS: Record<string, () => Promise<React.ReactNode>> = {
  farming: async () => <FarmCatalog rows={await fetchFarmCatalog(drizzleDB)} />,
  bloodlines: async () => (
    <BloodlineCatalog rows={await fetchBloodlineCatalog(drizzleDB)} />
  ),
};
