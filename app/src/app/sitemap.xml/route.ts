import {
  renderSitemapIndex,
  SITEMAP_SECTIONS,
  sitemapSectionUrl,
  xmlResponse,
} from "@/libs/sitemapXml";

// The index itself needs no database, but the children it points at are per-request, so
// it is served dynamically alongside them rather than baked at build time.
export const dynamic = "force-dynamic";

export function GET() {
  const now = new Date();
  return xmlResponse(
    renderSitemapIndex(
      SITEMAP_SECTIONS.map((section) => ({
        url: sitemapSectionUrl(section),
        lastModified: now,
      })),
    ),
  );
}
