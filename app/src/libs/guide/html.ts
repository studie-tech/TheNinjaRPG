import { GUIDE_RESERVED_SLUGS } from "@/drizzle/constants";

export interface GuideHeading {
  id: string;
  text: string;
  level: 2 | 3;
}

const HEADING_RE = /<h([23])(\s[^>]*)?>([\s\S]*?)<\/h\1>/gi;

/** Strip tags from a heading so the TOC shows readable text. */
export const headingPlainText = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

export const slugifyGuideTitle = (title: string) => {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug;
};

export const isReservedGuideSlug = (slug: string) =>
  (GUIDE_RESERVED_SLUGS as readonly string[]).includes(slug);

/**
 * Turn a heading into a URL-safe id. Collisions get a numeric suffix so two
 * "How to obtain" sections on the same page still get unique anchors.
 */
export const uniqueHeadingId = (text: string, used: Set<string>) => {
  const base = slugifyGuideTitle(text) || "section";
  let id = base;
  let n = 2;
  while (used.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  used.add(id);
  return id;
};

export const extractGuideHeadings = (html: string): GuideHeading[] => {
  const used = new Set<string>();
  const headings: GuideHeading[] = [];
  for (const match of html.matchAll(HEADING_RE)) {
    const level = Number(match[1]) as 2 | 3;
    const text = headingPlainText(match[3] ?? "");
    if (!text) continue;
    headings.push({ id: uniqueHeadingId(text, used), text, level });
  }
  return headings;
};

/** Inject id attributes onto h2/h3 so in-page TOC links resolve. */
export const withGuideHeadingIds = (html: string) => {
  const used = new Set<string>();
  return html.replace(
    HEADING_RE,
    (_full, level: string, attrs: string, inner: string) => {
      const existingId = attrs?.match(/\sid=["']([^"']+)["']/i)?.[1];
      const text = headingPlainText(inner);
      const id = existingId || uniqueHeadingId(text, used);
      if (existingId) used.add(existingId);
      const cleanedAttrs = (attrs ?? "").replace(/\s+id=["'][^"']*["']/i, "");
      return `<h${level} id="${id}"${cleanedAttrs}>${inner}</h${level}>`;
    },
  );
};
