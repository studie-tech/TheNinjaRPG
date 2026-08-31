import { SITEMAP_SECTION_LOADERS } from "@/libs/sitemap";
import { renderUrlset, xmlResponse } from "@/libs/sitemapXml";

// Reads the database, and the build runs without one.
export const dynamic = "force-dynamic";

export async function GET() {
  return xmlResponse(renderUrlset(await SITEMAP_SECTION_LOADERS.pages()));
}
