import { describe, expect, it } from "bun:test";
import { GUIDE_HUB_CATEGORY_ORDER } from "@/drizzle/constants";
import { SYSTEM_GUIDE_ARTICLES } from "@/libs/guide/articles";
import { isGuideworthyEntityName } from "@/libs/guide/generate";
import {
  isReservedGuideSlug,
  prepareGuideHtml,
  slugifyGuideTitle,
} from "@/libs/guide/html";

describe("guide hub category order", () => {
  it("lists economy and ranks before bloodlines", () => {
    expect(GUIDE_HUB_CATEGORY_ORDER.indexOf("economy")).toBeLessThan(
      GUIDE_HUB_CATEGORY_ORDER.indexOf("bloodlines"),
    );
    expect(GUIDE_HUB_CATEGORY_ORDER.indexOf("ranks")).toBeLessThan(
      GUIDE_HUB_CATEGORY_ORDER.indexOf("bloodlines"),
    );
  });
});

describe("isGuideworthyEntityName", () => {
  it("skips QA and copy fixtures", () => {
    expect(isGuideworthyEntityName("QA Carrot Seeds")).toBe(false);
    expect(isGuideworthyEntityName("Basic Onion Seeds - copy")).toBe(false);
    expect(isGuideworthyEntityName("Sunroot")).toBe(true);
  });
});

describe("slugifyGuideTitle", () => {
  it("builds lowercase hyphenated slugs", () => {
    expect(slugifyGuideTitle("Getting Started")).toBe("getting-started");
    expect(slugifyGuideTitle("PVP Guide: Aerathiel")).toBe("pvp-guide-aerathiel");
  });

  it("reserves edit and new", () => {
    expect(isReservedGuideSlug("edit")).toBe(true);
    expect(isReservedGuideSlug("getting-started")).toBe(false);
  });
});

describe("guide headings", () => {
  it("extracts h2/h3 text and injects stable ids", () => {
    const { html, headings } = prepareGuideHtml(
      "<h2>How to obtain</h2><p>x</p><h3>Prices</h3><h2>How to obtain</h2>",
    );
    expect(headings.map((heading) => heading.id)).toEqual([
      "how-to-obtain",
      "prices",
      "how-to-obtain-2",
    ]);
    expect(html).toContain('id="how-to-obtain"');
    expect(html).toContain('id="how-to-obtain-2"');
  });

  it("reuses an existing heading id so the TOC matches the rendered anchor", () => {
    const { html, headings } = prepareGuideHtml('<h2 id="custom">Combat</h2>');
    expect(html).toContain('id="custom"');
    expect(headings.map((heading) => heading.id)).toEqual(["custom"]);
  });
});

describe("system guide articles", () => {
  it("includes a unique published getting-started page", () => {
    const slugs = SYSTEM_GUIDE_ARTICLES.map((article) => article.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const start = SYSTEM_GUIDE_ARTICLES.find(
      (article) => article.slug === "getting-started",
    );
    expect(start?.published).toBe(true);
    expect(start?.seoDescription.length).toBeGreaterThan(80);
    expect(start?.seoDescription.length).toBeLessThanOrEqual(160);
  });

  it("keeps SEO titles and descriptions in range", () => {
    for (const article of SYSTEM_GUIDE_ARTICLES) {
      expect(article.seoTitle.length, article.slug).toBeLessThanOrEqual(60);
      expect(article.seoDescription.length, article.slug).toBeGreaterThan(80);
      expect(article.seoDescription.length, article.slug).toBeLessThanOrEqual(160);
    }
  });

  it("states combat and farming numbers from the game constants", () => {
    const article = (slug: string) => {
      const found = SYSTEM_GUIDE_ARTICLES.find((entry) => entry.slug === slug);
      return JSON.stringify(found);
    };
    expect(article("combat")).toContain("60-second rounds");
    const farming = article("farming");
    expect(farming).toContain("Level farming to 100");
    expect(farming).toContain("through 4 growth stages");
    expect(farming).toContain("require at least level 10");
    expect(farming).toContain(
      "Seed extractors unlock at levels 10, 55 and 100 (up to 3).",
    );
  });
});
