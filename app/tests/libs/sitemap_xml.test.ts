import { describe, expect, it } from "vitest";
import { SITE_URL } from "@/libs/seo";
import {
  SITEMAP_SECTIONS,
  type SitemapEntry,
  renderSitemapIndex,
  renderUrlset,
  sitemapSectionUrl,
  xmlResponse,
} from "@/libs/sitemapXml";

const entry = (url: string): SitemapEntry => ({
  url,
  lastModified: new Date("2026-08-30T12:00:00.000Z"),
  changeFrequency: "weekly",
  priority: 0.5,
});

describe("renderUrlset", () => {
  it("wraps entries in a urlset with the sitemap namespace", () => {
    const xml = renderUrlset([entry(`${SITE_URL}/manual`)]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect(xml).toContain(`<loc>${SITE_URL}/manual</loc>`);
    expect(xml).toContain("<lastmod>2026-08-30T12:00:00.000Z</lastmod>");
    expect(xml).toContain("<changefreq>weekly</changefreq>");
    expect(xml).toContain("<priority>0.5</priority>");
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
  });

  it("still closes the document when a section has no rows", () => {
    // The sitemap XSD requires at least one <url>, so an empty section is technically
    // schema-invalid; what matters here is that it cannot emit a truncated document.
    const xml = renderUrlset([]);
    expect(xml).toContain("<urlset");
    expect(xml).toContain("</urlset>");
    expect(xml).not.toContain("<url>");
  });

  it("omits lastmod when an entry has no real modification time", () => {
    const xml = renderUrlset([
      { url: `${SITE_URL}/manual`, changeFrequency: "weekly", priority: 0.9 },
    ]);
    expect(xml).not.toContain("<lastmod>");
    expect(xml).toContain("<changefreq>weekly</changefreq>");
  });

  it("escapes characters that would otherwise break the document", () => {
    // encodeURIComponent leaves the apostrophe raw and escapes the rest, but the
    // serializer takes arbitrary strings, so it has to handle all five itself: one
    // unescaped ampersand makes the whole file unparseable.
    const xml = renderUrlset([entry(`${SITE_URL}/username/a&b<c>"d'`)]);
    expect(xml).toContain("a&amp;b&lt;c&gt;&quot;d&apos;");
    // No bare "&" survives: every one is the start of an entity.
    const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1] ?? "");
    for (const loc of locs) {
      expect(loc.replace(/&(amp|lt|gt|quot|apos);/g, "")).not.toContain("&");
    }
  });
});

describe("renderSitemapIndex", () => {
  it("lists child sitemaps in a sitemapindex", () => {
    const xml = renderSitemapIndex(
      SITEMAP_SECTIONS.map((section) => ({ url: sitemapSectionUrl(section) })),
    );
    expect(xml).toContain(
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    for (const section of SITEMAP_SECTIONS) {
      expect(xml).toContain(`<loc>${SITE_URL}/sitemap-${section}.xml</loc>`);
    }
    // An index must not carry <url> entries; mixing the two silently invalidates it.
    expect(xml).not.toContain("<url>");
    // A request-time lastmod would claim every child changed on every fetch.
    expect(xml).not.toContain("<lastmod>");
  });
});

describe("sitemapSectionUrl", () => {
  it("builds absolute URLs on the canonical origin", () => {
    for (const section of SITEMAP_SECTIONS) {
      expect(sitemapSectionUrl(section)).toBe(`${SITE_URL}/sitemap-${section}.xml`);
    }
  });
});

describe("xmlResponse", () => {
  it("serves XML rather than letting the runtime guess text/plain", async () => {
    const res = xmlResponse(renderUrlset([]));
    expect(res.headers.get("Content-Type")).toBe("application/xml; charset=utf-8");
    expect(await res.text()).toContain("<urlset");
  });
});
