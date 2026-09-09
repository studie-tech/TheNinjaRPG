import { describe, expect, it } from "vitest";
import { GUIDE_HUB_CATEGORY_ORDER } from "@/drizzle/constants";
import { SYSTEM_GUIDE_ARTICLES } from "@/libs/guide/articles";
import { factCheckGuideProse, isPvpRestrictedRank, normalizeRankName } from "@/libs/guide/factcheck";
import { isGuideworthyEntityName } from "@/libs/guide/generate";
import {
  extractGuideHeadings,
  headingPlainText,
  isReservedGuideSlug,
  slugifyGuideTitle,
  withGuideHeadingIds,
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
    const html = "<h2>How to obtain</h2><p>x</p><h3>Prices</h3><h2>How to obtain</h2>";
    const headings = extractGuideHeadings(html);
    expect(headings.map((heading) => heading.id)).toEqual([
      "how-to-obtain",
      "prices",
      "how-to-obtain-2",
    ]);
    const withIds = withGuideHeadingIds(html);
    expect(withIds).toContain('id="how-to-obtain"');
    expect(withIds).toContain('id="how-to-obtain-2"');
  });

  it("decodes &amp; after other entities so &amp;lt; stays a literal <", () => {
    expect(headingPlainText("A &amp;lt; B")).toBe("A &lt; B");
  });

  it("reuses an existing heading id so the TOC matches the rendered anchor", () => {
    const html = withGuideHeadingIds('<h2 id="custom">Combat</h2>');
    expect(html).toContain('id="custom"');
    expect(extractGuideHeadings(html).map((heading) => heading.id)).toEqual(["custom"]);
  });
});

describe("factCheckGuideProse", () => {
  it("flags Core 3 village and rank leftovers", () => {
    const issues = factCheckGuideProse("Train in Konoha until you are a Jounin.");
    expect(issues.length).toBeGreaterThan(0);
  });

  it("does not flag current village names or the English word current", () => {
    expect(factCheckGuideProse("Join Akikaze after the Genin exam.")).toEqual([]);
    expect(factCheckGuideProse("Open the item page for current power.")).toEqual([]);
  });

  it("flags redirected wiki village titles", () => {
    expect(factCheckGuideProse("Visit the Village of Current.")).not.toEqual([]);
  });

  it("normalizes rank aliases", () => {
    expect(normalizeRankName("chuunin")).toBe("CHUNIN");
    expect(isPvpRestrictedRank("STUDENT")).toBe(true);
    expect(isPvpRestrictedRank("CHUNIN")).toBe(false);
  });
});

describe("system guide articles", () => {
  it("includes a unique published getting-started page", () => {
    const slugs = SYSTEM_GUIDE_ARTICLES.map((article) => article.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const start = SYSTEM_GUIDE_ARTICLES.find((article) => article.slug === "getting-started");
    expect(start?.published).toBe(true);
    expect(start?.seoDescription.length).toBeGreaterThan(80);
    expect(start?.seoDescription.length).toBeLessThanOrEqual(160);
  });

  it("keeps every first-party rewrite publishable", () => {
    for (const article of SYSTEM_GUIDE_ARTICLES) {
      expect(factCheckGuideProse(`${article.title} ${article.content}`), article.slug).toEqual(
        [],
      );
      expect(article.seoTitle.length, article.slug).toBeLessThanOrEqual(60);
      expect(article.seoDescription.length, article.slug).toBeGreaterThan(80);
      expect(article.seoDescription.length, article.slug).toBeLessThanOrEqual(160);
    }
  });
});
