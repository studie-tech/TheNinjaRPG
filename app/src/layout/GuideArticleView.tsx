"use client";

import { ArrowLeft, ArrowRight, BookOpenText, Database, Pencil } from "lucide-react";
import Link from "next/link";
import { GUIDE_CATEGORY_LABELS, type GuideCategory } from "@/drizzle/constants";
import type { GuideArticle } from "@/drizzle/schema";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
import { extractGuideHeadings, withGuideHeadingIds } from "@/libs/guide/html";
import { parseHtml } from "@/utils/parse";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

interface NeighborGuide {
  slug: string;
  title: string;
  excerpt?: string | null;
  image?: string | null;
}

interface GuideArticleViewProps {
  article: GuideArticle;
  previous?: NeighborGuide;
  next?: NeighborGuide;
  related: NeighborGuide[];
}

export const GuideArticleView: React.FC<GuideArticleViewProps> = ({
  article,
  previous,
  next,
  related,
}) => {
  const { data: userData } = useUserData();
  const isStaff = Boolean(userData && canChangeContent(userData.role));
  const html = withGuideHeadingIds(article.content);
  const headings = extractGuideHeadings(html);
  const categoryLabel = GUIDE_CATEGORY_LABELS[article.category as GuideCategory];
  const dataHref = relatedManualHref(article);
  const hasKeepReading = Boolean(previous || next || related.length > 0);

  return (
    <>
      <ContentBox
        title={article.title}
        subtitle={article.subtitle || categoryLabel}
        defaultBackHref="/guide"
        topRightContent={
          isStaff ? (
            <Link
              href={`/guide/edit/${article.id}`}
              className="flex items-center gap-1 font-bold text-orange-500 hover:text-orange-700"
            >
              <Pencil className="h-4 w-4" />
              Edit
            </Link>
          ) : undefined
        }
      >
        {article.image && (
          <Image
            src={article.image}
            alt={article.title}
            width={1280}
            height={640}
            className="mb-4 max-h-72 w-full rounded-md object-cover"
          />
        )}
        {headings.length > 1 && (
          <details className="mb-4 rounded-md border p-3 lg:hidden">
            <summary className="cursor-pointer font-bold">On this page</summary>
            <GuideToc headings={headings} />
          </details>
        )}
        <div className="lg:grid lg:grid-cols-[1fr_14rem] lg:gap-6">
          <article className="min-w-0 space-y-3 [&_a]:font-bold [&_a]:text-orange-500 hover:[&_a]:text-orange-700 [&_h2]:mt-5 [&_h2]:scroll-mt-24 [&_h2]:font-bold [&_h2]:text-xl [&_h3]:mt-4 [&_h3]:scroll-mt-24 [&_h3]:font-semibold [&_h3]:text-lg [&_ul]:ml-5 [&_ul]:list-disc">
            {parseHtml(html)}
          </article>
          {headings.length > 1 && (
            <nav
              className="sticky top-24 hidden h-fit lg:block"
              aria-label="On this page"
            >
              <p className="mb-2 font-bold text-sm">On this page</p>
              <GuideToc headings={headings} />
            </nav>
          )}
        </div>
        {article.faq && article.faq.length > 0 && (
          <section className="mt-6">
            <h2 className="font-bold text-xl">Frequently asked questions</h2>
            <dl className="mt-3 space-y-3">
              {article.faq.map((item) => (
                <div key={item.question}>
                  <dt className="font-bold">{item.question}</dt>
                  <dd className="mt-1">{item.answer}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
        {dataHref && (
          <p className="mt-6">
            <Link
              href={dataHref}
              className="inline-flex items-center gap-1 font-bold text-orange-500 hover:text-orange-700"
            >
              <Database className="h-4 w-4" />
              View in game data
            </Link>
          </p>
        )}
      </ContentBox>

      {hasKeepReading && (
        <ContentBox
          title="Keep reading"
          subtitle={`More ${categoryLabel.toLowerCase()} guides`}
          initialBreak={true}
          alreadyHasH1={true}
        >
          {(previous || next) && (
            <div
              className={`grid grid-cols-1 gap-3 ${
                previous && next ? "sm:grid-cols-2" : ""
              }`}
            >
              {previous && <GuideNavCard article={previous} direction="previous" />}
              {next && <GuideNavCard article={next} direction="next" />}
            </div>
          )}
          {related.length > 0 && (
            <div className={previous || next ? "mt-4" : undefined}>
              <p className="mb-2 font-bold text-sm text-muted-foreground">
                Also in this section
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {related.map((item) => (
                  <GuideRelatedCard key={item.slug} article={item} />
                ))}
              </div>
            </div>
          )}
        </ContentBox>
      )}
    </>
  );
};

const GuideToc: React.FC<{
  headings: { id: string; text: string; level: 2 | 3 }[];
}> = ({ headings }) => (
  <ol className="mt-2 space-y-1 text-sm">
    {headings.map((heading) => (
      <li key={heading.id} className={heading.level === 3 ? "ml-3" : undefined}>
        <a href={`#${heading.id}`} className="text-orange-500 hover:text-orange-700">
          {heading.text}
        </a>
      </li>
    ))}
  </ol>
);

const GuideNavCard: React.FC<{
  article: NeighborGuide;
  direction: "previous" | "next";
}> = ({ article, direction }) => {
  const isNext = direction === "next";
  return (
    <Link
      href={`/guide/${article.slug}`}
      className={`group flex gap-3 rounded-lg border p-3 transition-colors hover:border-orange-500 hover:bg-orange-500/5 ${
        isNext ? "sm:flex-row-reverse sm:text-right" : ""
      }`}
    >
      <GuideThumb src={article.image} alt={article.title} />
      <div className="min-w-0 grow">
        <p className="flex items-center gap-1 font-bold text-muted-foreground text-xs uppercase tracking-wide">
          {isNext ? (
            <>
              Next
              <ArrowRight className="h-3 w-3" />
            </>
          ) : (
            <>
              <ArrowLeft className="h-3 w-3" />
              Previous
            </>
          )}
        </p>
        <p className="mt-1 font-bold leading-tight group-hover:text-orange-600">
          {article.title}
        </p>
        {article.excerpt && (
          <p className="mt-1 line-clamp-2 text-sm">{article.excerpt}</p>
        )}
      </div>
    </Link>
  );
};

const GuideRelatedCard: React.FC<{ article: NeighborGuide }> = ({ article }) => (
  <Link
    href={`/guide/${article.slug}`}
    className="group flex gap-3 rounded-lg border p-3 transition-colors hover:border-orange-500 hover:bg-orange-500/5"
  >
    <GuideThumb src={article.image} alt={article.title} />
    <div className="min-w-0">
      <p className="font-bold leading-tight group-hover:text-orange-600">
        {article.title}
      </p>
      {article.excerpt && (
        <p className="mt-1 line-clamp-2 text-sm">{article.excerpt}</p>
      )}
    </div>
  </Link>
);

const GuideThumb: React.FC<{ src?: string | null; alt: string }> = ({ src, alt }) =>
  src ? (
    <Image
      src={src}
      alt={alt}
      width={256}
      height={128}
      className="h-20 w-32 shrink-0 rounded-md border object-cover"
    />
  ) : (
    <div className="flex h-20 w-32 shrink-0 items-center justify-center rounded-md border bg-muted">
      <BookOpenText className="h-7 w-7 text-orange-500" />
    </div>
  );

const relatedManualHref = (article: GuideArticle) => {
  if (article.relatedBloodlineId) {
    return `/manual/bloodline/${article.relatedBloodlineId}`;
  }
  if (article.relatedItemId) return `/manual/item/${article.relatedItemId}`;
  if (article.relatedJutsuId) return `/manual/jutsu/${article.relatedJutsuId}`;
  return null;
};
