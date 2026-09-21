import type { Metadata } from "next";
import { IMG_LOGO_FULL } from "@/drizzle/constants";
import { htmlToPlainText } from "@/utils/sanitize";

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
 * The site-wide social cards, declared once so a page can replace the image while
 * keeping the rest: Next replaces a parent's whole openGraph or twitter object when a
 * child declares one.
 */
export const SITE_OPEN_GRAPH: NonNullable<Metadata["openGraph"]> = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  url: SITE_URL,
  siteName: SITE_NAME,
  images: [{ url: IMG_LOGO_FULL, width: 512, height: 768, alt: "TheNinja-RPG Logo" }],
  locale: "en_US",
  type: "website",
};

export const SITE_TWITTER: NonNullable<Metadata["twitter"]> = {
  card: "summary_large_image",
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  siteId: "137431404",
  creator: "@RealTheNinjaRPG",
  creatorId: "137431404",
  images: [IMG_LOGO_FULL], // Must be an absolute URL
};

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
 * Brand tokens a title may already carry, and the connectors that can join them to the
 * rest of the title. Only the edges are matched, so a title that merely mentions the
 * game mid-sentence is left alone.
 */
const SITE_NAME_TOKENS = "TheNinja-RPG|The Ninja RPG|The Ninja-RPG|TNR";
const SITE_NAME_JOINERS = "[|:\\-–—]|\\b(?:in|of|for|on|from|to|at|with|about)\\b";
const SITE_NAME_LEADING = new RegExp(
  `^(?:${SITE_NAME_TOKENS})\\b\\s*(?:[|:\\-–—]\\s*)?`,
  "i",
);
const SITE_NAME_TRAILING = new RegExp(
  `\\s*(?:${SITE_NAME_JOINERS})?\\s*\\b(?:${SITE_NAME_TOKENS})$`,
  "i",
);

/**
 * stripSiteName
 * - Removes the brand from the start or end of a page title so buildMetadata can append
 *   it exactly once. Guide articles store an seoTitle written as the whole browser-tab
 *   title ("Aerathiel TheNinja-RPG", "Bloodlines in TheNinja-RPG"), and passing that
 *   through a template that adds the brand again produced
 *   "Aerathiel TheNinja-RPG | TheNinja-RPG" on every guide page. A joining preposition
 *   goes with the brand -- "Bloodlines in TheNinja-RPG" becomes "Bloodlines", which the
 *   suffix then completes -- because "Bloodlines in | TheNinja-RPG" is worse than either.
 * @param title - Page title that may or may not already carry the brand
 */
export const stripSiteName = (title: string) => {
  const stripped = title
    .replace(SITE_NAME_LEADING, "")
    .replace(SITE_NAME_TRAILING, "")
    .trim();
  return stripped.length > 0 ? stripped : title.trim();
};

/**
 * metaDescription
 * - Turns stored content descriptions, which may contain HTML and long prose, into a
 *   single-line snippet that fits a search result without being truncated by Google.
 * @param text - Raw description text
 * @param prefix - Optional lead-in placed before the description
 */
export const metaDescription = (text: string, prefix?: string) => {
  const clean = htmlToPlainText(text);
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
  const fullTitle = `${stripSiteName(title)} | ${SITE_NAME}`;
  return {
    title: { absolute: fullTitle },
    description,
    // A noindex page must not name a canonical: see noindexMetadata below for why.
    alternates: { canonical: noindex ? null : url },
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
  title: { absolute: `${stripSiteName(title)} | ${SITE_NAME}` },
  // index only. These screens link onward to manual and profile URLs that the sitemap
  // does advertise, and `follow: false` would tell Google to ignore those links -- a
  // good way to strand the very pages this metadata exists to help get indexed.
  robots: { index: false },
  // Next resolves each metadata key against the nearest ancestor that declares it, so
  // omitting `alternates` here does not mean "no canonical" -- it means the parent
  // segment's canonical is inherited. That made every staff route under /manual answer
  // `noindex` while naming an indexable page as its canonical (/manual/logs pointed at
  // /manual, /manual/item/balance at /manual/item), which is the one combination Google
  // asks you not to ship: the noindex can be consolidated onto the canonical target.
  // Declaring the key with a null value replaces the inherited one and emits no tag.
  alternates: { canonical: null },
});
