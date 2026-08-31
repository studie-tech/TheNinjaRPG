import { absoluteUrl } from "@/libs/seo";

/**
 * Serialization for the split sitemap, kept free of database imports so the index route
 * and the tests can use it without pulling in a client (and its env validation).
 *
 * Next's own `generateSitemaps` is not used: its serializer only emits `<urlset>` and
 * never writes a `<sitemapindex>`, so adopting it would have retired the /sitemap.xml
 * that Google already has on file.
 */

export type SitemapChangeFrequency =
  | "always"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "never";

export interface SitemapEntry {
  url: string;
  /**
   * Omitted where there is no real modification time to report. Google only honours
   * lastmod when it is verifiably accurate, and a request-time stamp on a page that has
   * not changed teaches it to disregard the field for the whole submission.
   */
  lastModified?: Date;
  changeFrequency: SitemapChangeFrequency;
  priority: number;
}

/** Child sitemaps listed by the index, in the order they are advertised. */
export const SITEMAP_SECTIONS = ["pages", "manual", "forum", "profiles"] as const;

export type SitemapSection = (typeof SITEMAP_SECTIONS)[number];

export const sitemapSectionUrl = (section: SitemapSection) =>
  absoluteUrl(`/sitemap-${section}.xml`);

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export const renderUrlset = (entries: SitemapEntry[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  entries
    .map(
      (entry) =>
        `<url>\n` +
        `<loc>${escapeXml(entry.url)}</loc>\n` +
        (entry.lastModified
          ? `<lastmod>${entry.lastModified.toISOString()}</lastmod>\n`
          : "") +
        `<changefreq>${entry.changeFrequency}</changefreq>\n` +
        `<priority>${entry.priority}</priority>\n` +
        `</url>\n`,
    )
    .join("") +
  `</urlset>\n`;

/**
 * `<lastmod>` is deliberately omitted from the index entries.
 *
 * It is optional there, and it means "when this child sitemap last changed", which the
 * index has no cheap way to know: the children are generated per request, so any value
 * available here is the request time. Stamping that would tell Google every child changed
 * on every fetch, which invites exactly the wasted crawling this split exists to reduce.
 * The per-URL `<lastmod>` inside each child is the accurate signal and is still emitted.
 */
export const renderSitemapIndex = (sitemaps: { url: string }[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  sitemaps
    .map((entry) => `<sitemap>\n<loc>${escapeXml(entry.url)}</loc>\n</sitemap>\n`)
    .join("") +
  `</sitemapindex>\n`;

/**
 * Shared response shape. Edge caching for every sitemap file is configured in one place,
 * against the sitemap paths in next.config.mjs, so it is not repeated here.
 */
export const xmlResponse = (body: string) =>
  new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
