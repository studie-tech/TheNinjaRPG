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
  lastModified: Date;
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
        `<lastmod>${entry.lastModified.toISOString()}</lastmod>\n` +
        `<changefreq>${entry.changeFrequency}</changefreq>\n` +
        `<priority>${entry.priority}</priority>\n` +
        `</url>\n`,
    )
    .join("") +
  `</urlset>\n`;

export const renderSitemapIndex = (sitemaps: { url: string; lastModified: Date }[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  sitemaps
    .map(
      (entry) =>
        `<sitemap>\n` +
        `<loc>${escapeXml(entry.url)}</loc>\n` +
        `<lastmod>${entry.lastModified.toISOString()}</lastmod>\n` +
        `</sitemap>\n`,
    )
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
