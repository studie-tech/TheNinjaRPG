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
      const width = layout.trim?.width ?? layout.cell;
      const height = layout.trim?.height ?? layout.cell;
      const gutter = layout.trim ? 1 : 0;
      expect((width + gutter * 2) * layout.columns).toBeLessThanOrEqual(2048);
      if (layout.trim) {
        expect(layout.trim.x).toBeGreaterThanOrEqual(0);
        expect(layout.trim.y).toBeGreaterThanOrEqual(0);
        expect(layout.trim.x + width).toBeLessThanOrEqual(layout.cell);
        expect(layout.trim.y + height).toBeLessThanOrEqual(layout.cell);
      }
      for (const directions of Object.values(layout.clips)) {
        expect(directions).toHaveLength(4);
        for (const indices of directions) for (const index of indices) {
          expect(index).toBeGreaterThanOrEqual(0);
          expect((Math.floor(index / layout.columns) + 1) * (height + gutter * 2)).toBeLessThanOrEqual(2048);
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
        expect(layout.clips.stand).toBeDefined();
        expect(layout.clips.walk).toBeDefined();
        expect(Object.keys(layout.clips).every((state) => ["stand", "idle", "walk"].includes(state))).toBe(true);
        for (const direction of [0, 1, 2, 3] as const) {
          expect(lpcFrame(sheet.travel, "stand", direction, 0)).not.toBeNull();
          expect(lpcFrame(sheet.travel, "walk", direction, 100)).not.toBeNull();
        }
      }
    }
  });
  it("retains attribution for every imported profile and pins the upstream revision", () => {
    expect(lpcCatalog.revision).toMatch(/^[a-f0-9]{40}$/);
    for (const key of Object.keys(lpcCatalog.entries)) expect(credits.some((entry) => entry.profile === key.split("/")[0] && entry.authors.length && entry.chosenLicense && entry.urls.length)).toBe(true);
  });
  it("bounds movement texture memory while retaining authored resting and walking steps", () => {
    const images = new Map<string, number>();
    for (const sheets of Object.values(lpcCatalog.entries)) for (const parent of sheets) {
      const sheet = parent.travel;
      if (!sheet) continue;
      const layout = lpcCatalog.layouts[sheet.layout]!;
      expect(layout.trim).toBeDefined();
      const trim = layout.trim!;
      for (const state of ["stand", "idle", "walk"] as const) {
        expect(layout.clips[state]?.map((frames) => frames.length)).toEqual(lpcCatalog.layouts[parent.layout]!.clips[state]?.map((frames) => frames.length));
      }
      const count = Math.max(...Object.values(layout.clips).flat(2)) + 1;
      images.set(sheet.image, layout.columns * (trim.width + 2) * Math.ceil(count / layout.columns) * (trim.height + 2) * 4);
    }
    // The complete movement catalogue bounds distinct visible outfits independently of sharing.
    expect([...images.values()].reduce((sum, bytes) => sum + bytes, 0)).toBeLessThan(96 * 1024 * 1024);
  });
  it("uses the authored four directions, freezes reduced motion and clamps one-shot frames", () => {
    expect([lpcFacing(0, 1), lpcFacing(-1, 0), lpcFacing(0, -1), lpcFacing(1, 0)]).toEqual([0, 1, 2, 3]);
    const sheet = lpcCatalog.entries["body/male/light/blue"]![0]!;
    expect(lpcFrame(sheet, "walk", 2, 10000, true)).toEqual(lpcFrame(sheet, "walk", 2, 0, true));
    expect(lpcFrame(sheet, "slash", 2, 10000)).toEqual(lpcFrame(sheet, "slash", 2, 20000));
  });
  it("records valid custom body timelines and a neutral held pose for reverse-slash weapons", () => {
    for (const body of ["male", "female"] as const) for (const profile of ["club", "whip", "crossbow"]) {
      const state = profile === "crossbow" ? "shoot" : "slash";
      for (const sheet of lpcCatalog.entries[`${profile}/${body}/brown/blue`]!) {
        const layout = lpcCatalog.layouts[sheet.layout]!;
        const pose = layout.bodyPoses?.[state];
        expect(pose).toBeDefined();
        expect(pose!.frames).toHaveLength(4);
        for (const direction of [0, 1, 2, 3] as const) {
          expect(pose!.frames[direction]).toHaveLength(layout.clips[state]![direction]!.length);
          expect(pose!.frames[direction]!.every((index) => index >= 0 && index < (pose!.animation === "thrust" ? 8 : 6))).toBe(true);
          if (profile === "club") expect(layout.clips.stand![direction]).toEqual([layout.clips.slash![direction]![5]!]);
        }
      }
    }
  });
  it("keeps authored breathing holds distinct from neutral and weapon fallback poses", () => {
    for (const body of ["male", "female"] as const) {
      const base = lpcCatalog.entries[`body/${body}/light/blue`]![0]!;
      const layout = lpcCatalog.layouts[base.layout]!;
      for (const state of ["idle", "combat"] as const) for (const frames of layout.clips[state]!) {
        expect(frames).toHaveLength(3);
        expect(frames[0]).toBe(frames[1]);
        expect(frames[1]).not.toBe(frames[2]);
      }
      expect(lpcFrame(base, "combat", 2, 600)).toEqual(lpcFrame(base, "combat", 2, 0));
      const held = lpcCatalog.entries[`club/${body}/brown/blue`]![0]!;
      expect(lpcCatalog.layouts[held.layout]!.clips.idle).toBeUndefined();
      expect(lpcCatalog.layouts[held.layout]!.clips.combat).toBeUndefined();
      expect(lpcFrame(held, "stand", 2, 600)).toEqual(lpcFrame(held, "stand", 2, 0));
    }
  });
});
