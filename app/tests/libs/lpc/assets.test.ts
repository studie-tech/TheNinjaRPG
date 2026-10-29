import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { UPLOADTHING_HOST } from "@/libs/uploadthing";
import { lpcCatalog, lpcFacing, lpcFrame } from "@/libs/lpc/catalog";
import credits from "@/libs/lpc/credits.json";

// Publication verifies decoded RGBA pixels; runtime tests validate our atlas/frame manifest offline.
describe("published LPC artwork", () => {
  it("references immutable UploadThing assets without shipping sprites in public", () => {
    expect(existsSync(new URL("../../../public/lpc", import.meta.url))).toBe(false);
    const origin = new URL(UPLOADTHING_HOST).origin;
    expect(new URL(lpcCatalog.creditsUrl).origin).toBe(origin);
    expect(new URL(lpcCatalog.creditsUrl).pathname).toMatch(/^\/f\/lpc-credits-[a-f0-9]{24}\.json$/);
    for (const layers of Object.values(lpcCatalog.entries)) for (const sheet of layers.flatMap((sheet) => [sheet, ...sheet.travel ? [sheet.travel] : []])) {
      const url = new URL(sheet.image);
      expect(url.origin).toBe(origin);
      expect(url.pathname).toMatch(/^\/f\/[A-Za-z0-9_-]+$/);
      expect(url.search).toBe("");
      const layout = lpcCatalog.layouts[sheet.layout]!;
      expect(layout).toBeDefined();
      expect(layout.cell * layout.columns).toBeLessThanOrEqual(2048);
      for (const directions of Object.values(layout.clips)) {
        expect(directions).toHaveLength(4);
        for (const indices of directions) for (const index of indices) {
          expect(index).toBeGreaterThanOrEqual(0);
          expect((Math.floor(index / layout.columns) + 1) * layout.cell).toBeLessThanOrEqual(2048);
        }
      }
    }
  });
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
