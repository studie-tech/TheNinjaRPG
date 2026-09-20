import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { isProfileIndexable, profileIndexCutoff } from "@/libs/profileIndexing";
import { SITE_URL, buildMetadata, noindexMetadata, stripSiteName } from "@/libs/seo";

// Every page lives under the shell segment; what remains at the app root is route
// handlers and metadata files, which have no metadata of their own to declare.
const APP_DIR = join(import.meta.dirname, "..", "..", "src", "app", "[shell]");

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
    title: "Manual",
    description: "The game manual.",
    path: "/manual",
  });

  it("sets a self-referencing canonical on the canonical origin", () => {
    expect(meta.alternates?.canonical).toBe(`${SITE_URL}/manual`);
  });

  it("emits no hreflang alternates, since there is only one language version", () => {
    // A page declared as an alternate of itself tells Google nothing it cannot read from
    // <html lang>, and hreflang has never been a country-targeting signal.
    expect(meta.alternates?.languages).toBeUndefined();
  });

  it("keeps the brand suffix on the title even below a segment layout", () => {
    expect(meta.title).toEqual({ absolute: "Manual | TheNinja-RPG" });
  });

  it("keeps noindex pages crawlable so their outbound links still count", () => {
    // follow: false here would tell Google to ignore every link on the gated screens,
    // including the ones pointing at manual and profile URLs the sitemap advertises.
    expect(noindexMetadata("Hospital").robots).toEqual({ index: false });
  });

  it("names no canonical on a noindex page", () => {
    // Next resolves each metadata key against the nearest ancestor that declares it, so
    // leaving `alternates` off does not mean "no canonical" -- it inherits the parent
    // segment's. That put 39 staff routes on `noindex` while pointing at an indexable
    // page (/manual/logs at /manual, /manual/item/balance at /manual/item), the one
    // pairing Google asks you not to ship. Only an explicit null replaces the inherited
    // value; undefined would fall back to it again.
    expect(noindexMetadata("Content Log").alternates).toEqual({ canonical: null });
    expect(
      buildMetadata({
        title: "Balance",
        description: "Staff tooling.",
        path: "/manual/balance",
        noindex: true,
      }).alternates,
    ).toEqual({ canonical: null });
  });
});

describe("stripSiteName", () => {
  // Guide articles store seoTitle as the whole browser-tab title, brand included, and
  // buildMetadata appends the brand again. Every guide page read
  // "Aerathiel TheNinja-RPG | TheNinja-RPG" until the edge was stripped first.
  it.each([
    ["Aerathiel TheNinja-RPG", "Aerathiel"],
    ["TheNinja-RPG Getting Started", "Getting Started"],
    ["TNR Progression", "Progression"],
    ["Farming Guide | TheNinja-RPG", "Farming Guide"],
    ["Bloodlines in TheNinja-RPG", "Bloodlines"],
    ["Welcome to TheNinja-RPG", "Welcome"],
  ])("strips the brand from the edge of %j", (input, expected) => {
    expect(stripSiteName(input)).toBe(expected);
  });

  it.each([
    "Combat in TheNinja-RPG: basics",
    "TNRx Tools",
    "Villages of Seichi",
  ])("leaves %j alone", (input) => {
    expect(stripSiteName(input)).toBe(input);
  });

  it("falls back to the input when nothing but the brand remains", () => {
    expect(stripSiteName("TheNinja-RPG")).toBe("TheNinja-RPG");
  });

  it("is what keeps buildMetadata from double-branding", () => {
    const meta = buildMetadata({
      title: "Aerathiel TheNinja-RPG",
      description: "A bloodline.",
      path: "/guide/aerathiel",
    });
    expect(meta.title).toEqual({ absolute: "Aerathiel | TheNinja-RPG" });
  });
});

describe("isProfileIndexable", () => {
  const now = Date.UTC(2026, 8, 14);
  const active = {
    level: 30,
    updatedAt: new Date(now - 24 * 60 * 60 * 1000),
    isAi: false,
    isBanned: false,
    deletionAt: null,
  };

  it("accepts an active account above the level floor", () => {
    expect(isProfileIndexable(active, now)).toBe(true);
  });

  // The sitemap already declined to advertise these; the routes now answer noindex for
  // the same set, so one that Google found before the floor existed does not stay
  // indexed indefinitely on an old crawl.
  it.each([
    ["below the level floor", { level: 13 }],
    ["inactive past the window", { updatedAt: new Date(now - 91 * 24 * 60 * 60 * 1000) }],
    ["never updated", { updatedAt: null }],
    ["an AI character", { isAi: true }],
    ["banned", { isBanned: true }],
    ["pending deletion", { deletionAt: new Date(now) }],
  ])("rejects a profile that is %s", (_label, override) => {
    expect(isProfileIndexable({ ...active, ...override }, now)).toBe(false);
  });

  it("treats the activity window as inclusive at the boundary", () => {
    expect(isProfileIndexable({ ...active, updatedAt: profileIndexCutoff(now) }, now)).toBe(
      true,
    );
  });
});
