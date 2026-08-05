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

/**
 * metaDescription
 * - Turns stored content descriptions, which may contain HTML and long prose, into a
 *   single-line snippet that fits a search result without being truncated by Google.
 * @param text - Raw description text
 * @param prefix - Optional lead-in placed before the description
 */
export const metaDescription = (text: string, prefix?: string) => {
  const clean = text
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
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
 * @param title - Page title
 */
export const noindexMetadata = (title: string): Metadata => ({
  title,
  robots: { index: false, follow: false },
});
