import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { lpcCatalog, lpcFacing, lpcFrame } from "@/libs/lpc/catalog";
import credits from "@/libs/lpc/credits.json";

describe("bundled LPC artwork", () => {
  it("actually recolours metal armour for item palettes", async () => {
    for (const body of ["male", "female"]) for (const color of ["red", "blue"]) {
      const sheet = lpcCatalog.entries[`plate/${body}/${color}/blue`]![0]!;
      const stats = await sharp(new Uint8Array(await readFile(new URL(`../../../public${sheet.image}`, import.meta.url)))).stats();
      const red = stats.channels[0]!.mean, blue = stats.channels[2]!.mean;
      expect(color === "red" ? red : blue).toBeGreaterThan(color === "red" ? blue : red);
    }
  });
  it("ships every referenced atlas with intact transparency, dimensions and content hashes", async () => {
    const dimensions = new Map<string, { width: number; height: number }>();
    for (const layers of Object.values(lpcCatalog.entries)) for (const sheet of layers.flatMap((sheet) => [sheet, ...sheet.travel ? [sheet.travel] : []])) {
      if (!dimensions.has(sheet.image)) {
        const bytes = new Uint8Array(await readFile(new URL(`../../../public${sheet.image}`, import.meta.url)));
        expect(createHash("sha256").update(bytes).digest("hex").slice(0, 24)).toBe(sheet.image.replace(/^\/lpc\//, "").replace(/\.png$/, ""));
        const image = sharp(bytes);
        const metadata = await image.metadata();
        const stats = await image.stats();
        expect(metadata.hasAlpha).toBe(true);
        expect(metadata.width).toBeLessThanOrEqual(2048);
        expect(metadata.height).toBeLessThanOrEqual(2048);
        expect(stats.channels[3]?.min).toBe(0);
        expect(stats.channels[3]?.max).toBeGreaterThan(0);
        dimensions.set(sheet.image, { width: metadata.width!, height: metadata.height! });
      }
      const layout = lpcCatalog.layouts[sheet.layout]!;
      const bounds = dimensions.get(sheet.image)!;
      for (const directions of Object.values(layout.clips)) for (const indices of directions) for (const index of indices) {
        expect((index % layout.columns + 1) * layout.cell).toBeLessThanOrEqual(bounds.width);
        expect((Math.floor(index / layout.columns) + 1) * layout.cell).toBeLessThanOrEqual(bounds.height);
      }
    }
  }, 120000);
  it("uses one slash alternative, and supplies compact resting/movement poses for every silhouette", () => {
    const sword = lpcCatalog.entries["sword/male/gray/blue"]!;
    expect(sword.filter((sheet) => lpcCatalog.layouts[sheet.layout]!.clips.slash)).toHaveLength(2);
    for (const sheets of Object.values(lpcCatalog.entries)) {
      expect(sheets.some((sheet) => !!sheet.travel)).toBe(true);
      for (const sheet of sheets) if (sheet.travel) {
        const layout = lpcCatalog.layouts[sheet.travel.layout]!;
        expect(Object.keys(layout.clips).sort()).toEqual(["idle", "walk"]);
        for (const direction of [0, 1, 2, 3] as const) {
          expect(lpcFrame(sheet.travel, "idle", direction, 0)).not.toBeNull();
          expect(lpcFrame(sheet.travel, "walk", direction, 100)).not.toBeNull();
        }
      }
    }
  });
  it("retains attribution for every imported profile and pins the upstream revision", () => {
    expect(lpcCatalog.revision).toMatch(/^[a-f0-9]{40}$/);
    for (const key of Object.keys(lpcCatalog.entries)) expect(credits.some((entry) => entry.profile === key.split("/")[0] && entry.authors.length && entry.chosenLicense && entry.urls.length)).toBe(true);
  });
  it("uses the authored four directions, freezes reduced motion and clamps one-shot frames", () => {
    expect([lpcFacing(0, 1), lpcFacing(-1, 0), lpcFacing(0, -1), lpcFacing(1, 0)]).toEqual([0, 1, 2, 3]);
    const sheet = lpcCatalog.entries["body/male/light/blue"]![0]!;
    expect(lpcFrame(sheet, "walk", 2, 10000, true)).toEqual(lpcFrame(sheet, "walk", 2, 0, true));
    expect(lpcFrame(sheet, "slash", 2, 10000)).toEqual(lpcFrame(sheet, "slash", 2, 20000));
  });
});
