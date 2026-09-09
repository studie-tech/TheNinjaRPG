import { GUIDE_RESERVED_SLUGS } from "@/drizzle/constants";
import { htmlToPlainText } from "@/utils/sanitize";

export interface GuideHeading {
  id: string;
  text: string;
  level: 2 | 3;
}

const HEADING_RE = /<h([23])(\s[^>]*)?>([\s\S]*?)<\/h\1>/gi;

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
const uniqueHeadingId = (text: string, used: Set<string>) => {
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

/** Inject heading ids and collect the TOC in one walk. */
export const prepareGuideHtml = (
  html: string,
): { html: string; headings: GuideHeading[] } => {
  const used = new Set<string>();
  const headings: GuideHeading[] = [];
  const nextHtml = html.replace(
    HEADING_RE,
    (_full, level: string, attrs: string, inner: string) => {
      const text = htmlToPlainText(inner);
      const existingId = attrs?.match(/\sid=["']([^"']+)["']/i)?.[1];
      const id = existingId || uniqueHeadingId(text, used);
      if (existingId) used.add(existingId);
      if (text) {
        headings.push({ id, text, level: Number(level) as 2 | 3 });
      }
      const cleanedAttrs = (attrs ?? "").replace(/\s+id=["'][^"']*["']/i, "");
      return `<h${level} id="${id}"${cleanedAttrs}>${inner}</h${level}>`;
    },
  );
  return { html: nextHtml, headings };
};
