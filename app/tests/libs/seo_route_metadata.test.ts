import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SITE_URL, buildMetadata, noindexMetadata } from "@/libs/seo";

const APP_DIR = join(import.meta.dirname, "..", "..", "src", "app");

/**
 * Whether a directory renders any HTML page at all. Route-handler directories -- the API,
 * the sitemap files, .well-known -- have no metadata to declare, and deriving that from
 * the presence of a page.tsx avoids an allowlist that goes stale as routes are added.
 */
const hasPage = (dir: string): boolean =>
  readdirSync(dir, { withFileTypes: true }).some((entry) =>
    entry.isDirectory()
      ? hasPage(join(dir, entry.name))
      : entry.name === "page.tsx" || entry.name === "page.ts",
  );

const hasMetadata = (dir: string): boolean => {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (hasMetadata(path)) return true;
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    const source = readFileSync(path, "utf8");
    if (source.includes("export const metadata") || source.includes("generateMetadata")) {
      return true;
    }
  }
  return false;
};

describe("route metadata coverage", () => {
  it("declares metadata for every top-level route", () => {
    // Forty gated screens shipped without any, so Googlebot received the homepage's
    // title, description and no canonical for each of them and Search Console filed the
    // set under "Duplicate without user-selected canonical".
    const missing = readdirSync(APP_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => hasPage(join(APP_DIR, name)))
      .filter((name) => !hasMetadata(join(APP_DIR, name)));
    expect(missing).toEqual([]);
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

  it("declares the English page as x-default for an English-only, global audience", () => {
    expect(meta.alternates?.languages).toEqual({
      en: `${SITE_URL}/ninja-game`,
      "x-default": `${SITE_URL}/ninja-game`,
    });
  });

  it("keeps the brand suffix on the title even below a segment layout", () => {
    expect(meta.title).toEqual({ absolute: "Ninja Game | TheNinja-RPG" });
  });

  it("marks noindex pages as neither indexable nor followable", () => {
    expect(noindexMetadata("Hospital").robots).toEqual({ index: false, follow: false });
  });
});
