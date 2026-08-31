import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LANDING_PAGES,
  type LandingContent,
  landingStructuredData,
} from "@/libs/landing";
import { LANDING_LINKS, LANDING_ROUTES } from "@/libs/landingLinks";
import { SITE_NAME, SITE_URL } from "@/libs/seo";
import { SITEMAP_SECTIONS } from "@/libs/sitemapXml";

const APP_DIR = join(import.meta.dirname, "..", "..", "src", "app");
const pages = Object.values(LANDING_PAGES) as LandingContent[];

describe("landing page routes", () => {
  it("has a page file behind every advertised path", () => {
    // A path in the sitemap with no route behind it is submitted straight into the
    // "Not found (404)" bucket this work exists to empty.
    for (const page of pages) {
      expect(existsSync(join(APP_DIR, page.path.slice(1), "page.tsx"))).toBe(true);
    }
  });

  it("keys match their own paths, so the sitemap and the routes cannot drift", () => {
    for (const [slug, page] of Object.entries(LANDING_PAGES)) {
      expect(page.path).toBe(`/${slug}`);
      expect(page).toMatchObject(LANDING_LINKS[slug as keyof typeof LANDING_LINKS]);
    }
  });

  it("advertises every landing page in the sitemap and nothing else", () => {
    // LANDING_ROUTES is what libs/sitemap.ts submits, so it has to name real routes.
    expect([...LANDING_ROUTES].sort()).toEqual(
      ["/anime-ninja-online", "/browser-rpg", "/ninja-game"].sort(),
    );
  });

  it("uses distinct paths, titles and descriptions", () => {
    for (const field of ["path", "title", "description", "h1"] as const) {
      const values = pages.map((page) => page[field]);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it("asks a different set of questions on each page", () => {
    // Near-identical FAQ sets across three pages about one game read as doorway pages.
    const questions = pages.flatMap((page) => page.faqs.map((faq) => faq.question));
    expect(new Set(questions).size).toBe(questions.length);
  });
});

describe("landing page content", () => {
  it("keeps descriptions inside the length Google renders", () => {
    for (const page of pages) {
      expect(page.description.length).toBeGreaterThan(80);
      expect(page.description.length).toBeLessThanOrEqual(160);
    }
  });

  it("carries enough prose to not read as a doorway page", () => {
    for (const page of pages) {
      const words = page.sections
        .flatMap((section) => section.body)
        .join(" ")
        .split(/\s+/).length;
      expect(words).toBeGreaterThan(200);
      expect(page.sections.length).toBeGreaterThanOrEqual(3);
      expect(page.faqs.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("links onward to the manual so those hubs gain an internal path", () => {
    for (const page of pages) {
      expect(page.links.length).toBeGreaterThanOrEqual(3);
      for (const link of page.links) {
        expect(link.href.startsWith("/")).toBe(true);
      }
    }
    const linked = new Set(pages.flatMap((p) => p.links.map((l) => l.href)));
    // The hubs Search Console reported as "Discovered - currently not indexed".
    for (const hub of ["/manual/combat", "/manual/world", "/manual/quest", "/manual/ai"]) {
      expect(linked.has(hub)).toBe(true);
    }
  });
});

describe("landingStructuredData", () => {
  it("binds one page node, typed WebPage and FAQPage, to the canonical URL", () => {
    for (const page of pages) {
      const graph = landingStructuredData(page)["@graph"];
      // FAQPage is a subclass of WebPage, so a second page-typed node for the same URL
      // would be two competing page entities rather than one described twice.
      expect(graph.map((node) => node["@type"])).toEqual([
        ["WebPage", "FAQPage"],
        "BreadcrumbList",
      ]);

      const url = `${SITE_URL}${page.path}`;
      const webPage = graph[0] as {
        url: string;
        name: string;
        mainEntity: { name: string }[];
      };
      expect(webPage.url).toBe(url);
      expect(webPage.name).toBe(`${page.title} | ${SITE_NAME}`);
      expect(webPage.mainEntity.map((q) => q.name)).toEqual(
        page.faqs.map((f) => f.question),
      );
    }
  });

  it("carries nothing that would close the script tag it is injected into", () => {
    for (const page of pages) {
      expect(JSON.stringify(landingStructuredData(page))).not.toContain("</script");
    }
  });
});

describe("sitemap sections", () => {
  it("has a route file behind every advertised child sitemap", () => {
    for (const section of SITEMAP_SECTIONS) {
      expect(existsSync(join(APP_DIR, `sitemap-${section}.xml`, "route.ts"))).toBe(true);
    }
  });

  it("still serves the index at the path Google already has on file", () => {
    expect(existsSync(join(APP_DIR, "sitemap.xml", "route.ts"))).toBe(true);
    // The metadata convention file would collide with the route handler on /sitemap.xml.
    expect(existsSync(join(APP_DIR, "sitemap.ts"))).toBe(false);
  });
});
