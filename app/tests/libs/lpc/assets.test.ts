import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { resolveSpriteAppearance } from "@/libs/lpc/appearance";
import { lpcAtlasResources } from "@/libs/lpc/atlases";
import { lpcFrame, spriteLayerSheets } from "@/libs/lpc/catalog";
import { lpcAtlasFrame } from "@/libs/lpc/frames";
import { lpcPreviewFingerprint } from "@/libs/lpc/previewAssets";
import { CHARACTER_PIXELS_PER_UNIT } from "@/libs/rendering/characterFrame";
import { isBunnyCdnUrl } from "@/utils/image";
import { lpcAnimations } from "@/validators/lpc";
import credits from "../../../drizzle/data/lpc/credits.json";
import { lpcAssets, lpcCatalog } from "../../setup/lpc";

// Publication verifies CDN bytes; these checks validate the complete bundled manifest offline.
describe("published character artwork", () => {
  it("binds every detailed preview index to the exact gameplay definition", async () => {
    for (const asset of lpcAssets) {
      const preview = asset.lpcConfig.preview;
      expect(preview).toBeDefined();
      expect(preview?.source).toBe(await lpcPreviewFingerprint(lpcCatalog, asset.id));
      const index = new URL(preview!.index);
      expect(isBunnyCdnUrl(index.href)).toBe(true);
      expect(index.pathname).toMatch(/^\/f\/[A-Za-z0-9_-]+$/);
      expect(index.search).toBe("");
      expect(index.hash).toBe("");
    }
  });
  it("serves every colour, depth and handed atlas through immutable raw CDN keys", () => {
    expect(existsSync(new URL("../../../public/lpc", import.meta.url))).toBe(false);
    for (const image of [
      lpcCatalog.creditsUrl,
      ...lpcAssets.flatMap((asset) => [
        asset.image,
        ...lpcAtlasResources(asset.lpcConfig).map((resource) => resource.image),
      ]),
    ]) {
      const url = new URL(image);
      expect(isBunnyCdnUrl(image)).toBe(true);
      expect(url.pathname).toMatch(/^\/f\/[A-Za-z0-9_-]+$/);
      expect(url.search).toBe("");
      expect(url.hash).toBe("");
    }
  });
  it("retains both body builds, independent depth layers and every authored action for all designs", () => {
    expect(lpcAssets).toHaveLength(95);
    for (const asset of lpcAssets) {
      for (const body of ["male", "female"]) {
        expect(
          Object.keys(asset.lpcConfig.variants).some((key) =>
            key.startsWith(`${body}/`),
          ),
        ).toBe(true);
      }
      for (const sheets of Object.values(asset.lpcConfig.variants)) {
        const components = new Map<string, Set<string>>();
        for (const sheet of sheets) {
          expect(sheet.depth).toBeDefined();
          const states =
            components.get(sheet.component ?? sheet.part ?? "base") ??
            new Set<string>();
          for (const state of Object.keys(sheet.layout.clips)) states.add(state);
          components.set(sheet.component ?? sheet.part ?? "base", states);
          if (sheet.offhand) expect(sheet.offhand.depth).toBeDefined();
        }
        for (const [component, states] of components) {
          expect([...states].sort()).toEqual([...lpcAnimations].sort());
          const companions = sheets.filter(
            (sheet) =>
              (sheet.component ?? sheet.part ?? "base") === component && sheet.travel,
          );
          expect(companions.length).toBeGreaterThan(0);
        }
      }
    }
  });
  it("keeps cropped frames inside bounded atlases and aligned to one scale and foot point", () => {
    for (const layout of lpcCatalog.layouts) {
      expect([256, 320]).toContain(layout.cell);
      expect(layout.pixelsPerUnit).toBe(CHARACTER_PIXELS_PER_UNIT);
      expect(layout.ground).toEqual({
        x: layout.cell / 2,
        y: layout.cell / 2 + (41 * 5) / 3,
      });
      expect(layout.facings).toHaveLength(6);
      expect(layout.facings?.map((facing) => facing.mirror)).toEqual([
        false,
        true,
        false,
        false,
        true,
        false,
      ]);
      for (const state of lpcAnimations) {
        const directions = layout.clips[state];
        if (!directions) continue;
        expect(directions).toHaveLength(4);
        for (const indices of directions)
          for (const index of indices) {
            const frame = lpcAtlasFrame(layout, state, index);
            expect(index).toBeGreaterThanOrEqual(0);
            expect(frame.x).toBeGreaterThanOrEqual(0);
            expect(frame.y).toBeGreaterThanOrEqual(0);
            expect(frame.x + frame.width + 1).toBeLessThanOrEqual(2048);
            expect(frame.y + frame.height + 1).toBeLessThanOrEqual(2048);
            expect(frame.trim).toBeDefined();
            expect(frame.trim!.x + frame.width).toBeLessThanOrEqual(layout.cell);
            expect(frame.trim!.y + frame.height).toBeLessThanOrEqual(layout.cell);
          }
      }
    }
  });
  it("pins attribution and revision for every published design", () => {
    expect(lpcCatalog.revision).toMatch(/^[a-f0-9]{64}$/);
    for (const asset of lpcAssets) {
      expect(asset.lpcConfig.sourceRevision).toBe(lpcCatalog.revision);
      expect(asset.lpcConfig.attributions.length).toBeGreaterThan(0);
      for (const credit of asset.lpcConfig.attributions) {
        expect(credit.authors.length).toBeGreaterThan(0);
        expect(credit.urls.length).toBeGreaterThan(0);
        expect(credit.chosenLicense).toBeTruthy();
        expect(
          credits.some(
            (source) =>
              source.profile === credit.profile &&
              source.chosenLicense === credit.chosenLicense,
          ),
        ).toBe(true);
      }
    }
  });
  it("retains compact movement companions and freezes or clamps playback without changing layer selection", () => {
    for (const body of ["male", "female"] as const) {
      const appearance = resolveSpriteAppearance({ spriteBodyStyle: body });
      const resources = new Map<string, number>();
      for (const layer of appearance.layers) {
        const full = spriteLayerSheets(lpcCatalog, appearance, layer, "travel");
        for (const sheet of full) {
          const travel = sheet;
          const layout = lpcCatalog.layouts[travel.layout]!;
          expect(Object.keys(layout.clips).sort()).toEqual(["idle", "stand", "walk"]);
          expect(layout.clips.stand?.map((frames) => frames.length)).toEqual([
            1, 1, 1, 1,
          ]);
          expect(layout.clips.walk?.map((frames) => frames.length)).toEqual([
            8, 8, 8, 8,
          ]);
          for (const facing of [0, 1, 2, 3, 4, 5] as const) {
            expect(lpcFrame(lpcCatalog, travel, "walk", facing, 10000, true)).toEqual(
              lpcFrame(lpcCatalog, travel, "walk", facing, 0, true),
            );
          }
          let width = 0,
            height = 0;
          for (const state of ["stand", "idle", "walk"] as const)
            for (const index of layout.clips[state]!.flat()) {
              const frame = lpcAtlasFrame(layout, state, index);
              width = Math.max(width, frame.x + frame.width + 1);
              height = Math.max(height, frame.y + frame.height + 1);
            }
          resources.set(travel.image, width * height * 4);
          resources.set(travel.depth!, width * height * 4);
        }
      }
      const attack = spriteLayerSheets(
        lpcCatalog,
        appearance,
        appearance.layers[0]!,
      ).find((sheet) => lpcCatalog.layouts[sheet.layout]!.clips.slash)!;
      expect(attack).toBeDefined();
      expect(lpcFrame(lpcCatalog, attack, "slash", 2, 10000)).toEqual(
        lpcFrame(lpcCatalog, attack, "slash", 2, 20000),
      );
      expect(
        [...resources.values()].reduce((sum, bytes) => sum + bytes, 0),
      ).toBeLessThan(24 * 1024 * 1024);
    }
  });
});
