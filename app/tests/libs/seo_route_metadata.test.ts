import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { SITE_URL, buildMetadata, noindexMetadata } from "@/libs/seo";

const APP_DIR = join(import.meta.dirname, "..", "..", "src", "app");

/**
 * Every directory holding a page.tsx, anywhere under `dir`.
 */
const pageDirs = (dir: string): string[] => {
  const entries = readdirSync(dir, { withFileTypes: true });
  const here = entries.some((e) => !e.isDirectory() && e.name === "page.tsx") ? [dir] : [];
  return entries
    .filter((e) => e.isDirectory())
    .flatMap((e) => pageDirs(join(dir, e.name)))
    .concat(here);
};

/**
 * Whether a single directory declares metadata itself. Matching is on an export, not a
 * bare substring, so an import or a comment mentioning generateMetadata does not count.
 */
const DECLARES_METADATA =
  /export\s+(?:const\s+metadata\b|(?:async\s+)?function\s+generateMetadata\b)/;

const declaresMetadata = (dir: string): boolean =>
  readdirSync(dir, { withFileTypes: true }).some(
    (entry) =>
      !entry.isDirectory() &&
      /\.(ts|tsx)$/.test(entry.name) &&
      DECLARES_METADATA.test(readFileSync(join(dir, entry.name), "utf8")),
  );

/**
 * A page is covered when its own directory, or one of its ancestors up to the route
 * root, declares metadata. Checking the ancestor chain rather than the whole subtree is
 * what gives the guard teeth: a sibling route declaring its own metadata must not make
 * an uncovered page look covered.
 */
const uncoveredPages = (routeDir: string): string[] =>
  pageDirs(routeDir).filter((pageDir) => {
    let dir = pageDir;
    while (true) {
      if (declaresMetadata(dir)) return false;
      if (dir === routeDir) return true;
      dir = dirname(dir);
    }
  });

describe("route metadata coverage", () => {
  it("declares metadata for every top-level route", () => {
    // Forty gated screens shipped without any, so Googlebot received the homepage's
    // title, description and no canonical for each of them and Search Console filed the
    // set under "Duplicate without user-selected canonical".
    const uncovered = readdirSync(APP_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => uncoveredPages(join(APP_DIR, entry.name)))
      .map((dir) => dir.slice(APP_DIR.length));
    expect(uncovered).toEqual([]);
  });

  it("keeps the gated screens on noindexMetadata", () => {
    for (const route of ["hospital", "traininggrounds", "bank", "tavern", "combat"]) {
      const layout = join(APP_DIR, route, "layout.tsx");
      expect(existsSync(layout)).toBe(true);
      expect(readFileSync(layout, "utf8")).toContain("noindexMetadata");
    }
  });
});

describe("buildMetadata", () => {
  const meta = buildMetadata({
    title: "Ninja Game",
    description: "A free ninja game you play in the browser.",
    path: "/ninja-game",
  });

  it("sets a self-referencing canonical on the canonical origin", () => {
    expect(meta.alternates?.canonical).toBe(`${SITE_URL}/ninja-game`);
  });

  it("emits no hreflang alternates, since there is only one language version", () => {
    // A page declared as an alternate of itself tells Google nothing it cannot read from
    // <html lang>, and hreflang has never been a country-targeting signal.
    expect(meta.alternates?.languages).toBeUndefined();
  });

  it("keeps the brand suffix on the title even below a segment layout", () => {
    expect(meta.title).toEqual({ absolute: "Ninja Game | TheNinja-RPG" });
  });

  it("keeps noindex pages crawlable so their outbound links still count", () => {
    // follow: false here would tell Google to ignore every link on the gated screens,
    // including the ones pointing at manual and profile URLs the sitemap advertises.
    expect(noindexMetadata("Hospital").robots).toEqual({ index: false });
  });
});
