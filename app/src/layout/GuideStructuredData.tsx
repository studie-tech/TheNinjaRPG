import { GUIDE_CATEGORY_LABELS, type GuideCategory } from "@/drizzle/constants";
import { absoluteUrl, SITE_NAME, SITE_URL } from "@/libs/seo";
import type { GuideFaqItem } from "@/validators/guide";

interface GuideStructuredDataProps {
  title: string;
  description: string;
  slug: string;
  category: GuideCategory;
  updatedAt: Date;
  image?: string | null;
  faq?: GuideFaqItem[] | null;
}

/**
 * Per-article JSON-LD: Article + BreadcrumbList, plus FAQPage when the
 * article has Q&A. Kept as a server component so crawlers see it in the
 * initial HTML.
 */
export const GuideStructuredData: React.FC<GuideStructuredDataProps> = ({
  title,
  description,
  slug,
  category,
  updatedAt,
  image,
  faq,
}) => {
  const url = absoluteUrl(`/guide/${slug}`);
  const categoryLabel = GUIDE_CATEGORY_LABELS[category];
  const graph: Record<string, unknown>[] = [
    {
      "@type": "Article",
      "@id": `${url}#article`,
      headline: title,
      description,
      dateModified: updatedAt.toISOString(),
      inLanguage: "en",
      author: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
      publisher: { "@id": `${SITE_URL}/#organization` },
      mainEntityOfPage: url,
      isPartOf: { "@id": `${SITE_URL}/#website` },
      about: { "@id": `${SITE_URL}/#game` },
      ...(image ? { image } : {}),
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Guide",
          item: absoluteUrl("/guide"),
        },
        {
          "@type": "ListItem",
          position: 2,
          name: categoryLabel,
          item: `${absoluteUrl("/guide")}#${category}`,
        },
        {
          "@type": "ListItem",
          position: 3,
          name: title,
          item: url,
        },
      ],
    },
  ];
  if (faq && faq.length > 0) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: faq.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: { "@type": "Answer", text: item.answer },
      })),
    });
  }
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD is built from staff-sanitized guide fields, not raw request input.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({ "@context": "https://schema.org", "@graph": graph }),
      }}
    />
  );
};
