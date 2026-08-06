import type { Metadata } from "next";

/**
 * Canonical origin for the site. Every absolute URL emitted in metadata, the sitemap
 * and structured data is built from this, so the www/non-www split never produces two
 * indexable copies of the same page.
 */
export const SITE_URL = "https://www.theninja-rpg.com";
export const SITE_NAME = "TheNinja-RPG";

/** Route of the generated 1200x630 social card (app/opengraph-image.tsx). */
export const OG_IMAGE_PATH = "/opengraph-image";

export const SITE_TITLE = "TheNinja-RPG - Online RPG - Free Online Game for Ninjas";
export const SITE_DESCRIPTION =
  "Play TheNinja-RPG free in your browser. Train your ninja, master jutsu, join a village and battle thousands of players in the world of Seichi. No download required.";

/**
 * absoluteUrl
 * - Resolves a site-relative path against the canonical origin
 * @param path - Path beginning with a slash, or an already absolute URL
 */
export const absoluteUrl = (path: string) => {
  if (path.startsWith("http")) return path;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

/**
 * decodeHtmlEntities
 * - Resolves the entities that show up in stored descriptions to their characters
 *
 * Dropping them instead would turn "Don&apos;t" into "Don t", and numeric forms such as
 * "&#39;" would survive verbatim into the search snippet.
 * @param text - Text that may contain HTML entities
 */
const decodeCodePoint = (raw: string, value: number) => {
  // String.fromCodePoint throws a RangeError outside the Unicode scalar range, which
  // would abort the whole description. Lone surrogates are excluded too: they decode
  // without throwing but produce unpaired code units that break downstream encoding.
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) return raw;
  if (value >= 0xd800 && value <= 0xdfff) return raw;
  return String.fromCodePoint(value);
};

const decodeHtmlEntities = (text: string) =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (raw, hex: string) =>
      decodeCodePoint(raw, Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (raw, dec: string) =>
      decodeCodePoint(raw, Number.parseInt(dec, 10)),
    )
    .replace(/&([a-z]+);/gi, (match, name: string) => {
      return NAMED_ENTITIES[name.toLowerCase()] ?? match;
    });

/**
 * metaDescription
 * - Turns stored content descriptions, which may contain HTML and long prose, into a
 *   single-line snippet that fits a search result without being truncated by Google.
 * @param text - Raw description text
 * @param prefix - Optional lead-in placed before the description
 */
export const metaDescription = (text: string, prefix?: string) => {
  const clean = decodeHtmlEntities(text.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  const full = prefix ? `${prefix} ${clean}` : clean;
  return full.length > 160 ? `${full.slice(0, 157).trimEnd()}...` : full;
};

interface BuildMetadataInput {
  /** Page title, without the site-name suffix; the root template appends that. */
  title: string;
  /** Meta description. Aim for 120-160 characters so Google shows it in full. */
  description: string;
  /** Site-relative canonical path, e.g. "/manual/bloodline". */
  path: string;
  /** Absolute image URL for OpenGraph/Twitter cards. Defaults to the site logo. */
  image?: string;
  /** Set for staff tooling and other pages that should never appear in search. */
  noindex?: boolean;
  /** OpenGraph type; articles use "article" so news posts get richer treatment. */
  type?: "website" | "article";
}

/**
 * buildMetadata
 * - Builds a Next.js Metadata object with a self-referencing canonical plus matching
 *   OpenGraph and Twitter tags. Pages that skip this inherit the root metadata, which
 *   makes them look like duplicates of the homepage to search engines.
 * @param input - Page title, description, canonical path and optional overrides
 */
export const buildMetadata = ({
  title,
  description,
  path,
  image,
  noindex,
  type = "website",
}: BuildMetadataInput): Metadata => {
  const url = absoluteUrl(path);
  // Declaring an openGraph object replaces the image Next would otherwise inject from
  // app/opengraph-image.tsx, so the generated card is referenced explicitly here.
  const images = image
    ? [image]
    : [{ url: absoluteUrl(OG_IMAGE_PATH), width: 1200, height: 630, alt: SITE_NAME }];
  // Built with `absolute` rather than relying on the root title.template: a segment
  // layout that sets a plain string title (e.g. /manual) replaces the template for all
  // of its children, which left nested pages without the brand suffix.
  const fullTitle = `${title} | ${SITE_NAME}`;
  return {
    title: { absolute: fullTitle },
    description,
    alternates: { canonical: url },
    ...(noindex ? { robots: { index: false, follow: false } } : {}),
    openGraph: {
      title: fullTitle,
      description,
      url,
      siteName: SITE_NAME,
      ...(images ? { images } : {}),
      locale: "en_US",
      type,
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      ...(images ? { images } : {}),
    },
  };
};

/**
 * noindexMetadata
 * - Convenience wrapper for staff-only and utility routes that must stay out of the
 *   index but still need a sensible title in the browser tab.
 *
 * Uses `absolute` for the same reason buildMetadata does: these are segment layouts, and
 * a plain string title here would replace the root template for every nested route that
 * does not set its own.
 * @param title - Page title
 */
export const noindexMetadata = (title: string): Metadata => ({
  title: { absolute: `${title} | ${SITE_NAME}` },
  robots: { index: false, follow: false },
});
