import { describe, expect, it } from "bun:test";
import {
  buildLpcCatalog,
  type LpcCatalog,
  lpcFacing,
  lpcFrame,
  lpcOppositeFacing,
} from "@/libs/lpc/catalog";
import type { LpcDirection } from "@/validators/lpc";
import { lpcConfigValidator, lpcLayoutValidator } from "@/validators/lpcAsset";

const layout = lpcLayoutValidator.parse({
  cell: 128,
  columns: 8,
  clips: {
    stand: [[0], [8], [16], [24]],
    walk: [
      [0, 1, 2],
      [8, 9, 10],
      [16, 17, 18],
      [24, 25, 26],
    ],
    slash: [
      [3, 4, 5],
      [11, 12, 13],
      [19, 20, 21],
      [27, 28, 29],
    ],
  },
  facings: [
    { row: 0, mirror: false },
    { row: 2, mirror: true },
    { row: 3, mirror: false },
    { row: 2, mirror: false },
    { row: 1, mirror: true },
    { row: 1, mirror: false },
  ],
  frameMs: { walk: 90, slash: 50 },
});
const catalog: LpcCatalog = { entries: {}, designs: {}, layouts: [layout] };
const sheet = { image: "https://example.com/character.webp", z: 0, layout: 0 };

describe("mirrored hex character poses", () => {
  it("keeps authored off-hand atlases and timings through validated design compilation", () => {
    const left = { image: "https://example.com/left.webp", z: 1, layout };
    const right = {
      image: "https://example.com/right.webp",
      z: 1,
      layout,
      offhand: left,
      travel: {
        image: "https://example.com/right-travel.webp",
        z: 1,
        layout: {
          ...layout,
          clips: { stand: layout.clips.stand, walk: layout.clips.walk },
        },
        offhand: {
          ...left,
          image: "https://example.com/left-travel.webp",
          layout: {
            ...layout,
            clips: { stand: layout.clips.stand, walk: layout.clips.walk },
          },
        },
      },
    };
    const config = lpcConfigValidator.parse({
      version: 2,
      category: "equipment",
      replacementSlots: [],
      defaultColor: "gray",
      defaultEyes: "blue",
      variants: { "male/gray/blue": [right], "female/gray/blue": [right] },
      attributions: [
        {
          authors: ["Fixture artist"],
          licenses: ["Commercial license"],
          chosenLicense: "Commercial license",
          urls: ["https://example.com/artwork"],
          notes: "",
        },
      ],
    });
    const compiled = buildLpcCatalog([{ id: "blade", lpcConfig: config }]);
    const entry = compiled.entries["blade/female/gray/blue"]?.[0];
    expect(entry?.offhand?.image).toBe(left.image);
    expect(entry?.travel?.offhand?.image).toBe("https://example.com/left-travel.webp");
    expect(compiled.layouts[entry!.offhand!.layout]?.frameMs?.slash).toBe(50);
    for (const invalid of [
      {
        ...right,
        offhand: {
          ...left,
          layout: {
            ...layout,
            clips: { stand: layout.clips.stand, walk: layout.clips.walk },
          },
        },
      },
      {
        ...right,
        offhand: {
          ...left,
          layout: { ...layout, frameMs: { ...layout.frameMs, slash: 100 } },
        },
      },
      { ...right, travel: { ...right.travel, offhand: undefined } },
      { ...right, travel: { ...right.travel, offhand: left } },
    ]) {
      const rejected = lpcConfigValidator.safeParse({
        ...config,
        variants: { ...config.variants, "male/gray/blue": [invalid] },
      });
      expect(rejected.success).toBe(false);
      if (!rejected.success)
        expect(
          rejected.error.issues.some((issue) =>
            /[Ll]eft-hand|Travel atlases/.test(issue.message),
          ),
        ).toBe(true);
    }
  });

  it("selects all six neighbour directions in Y-up coordinates and retains a stationary facing", () => {
    const diagonal = Math.sqrt(3) / 2;
    expect([
      lpcFacing(0, 1),
      lpcFacing(-diagonal, -0.5),
      lpcFacing(0, -1),
      lpcFacing(diagonal, -0.5),
      lpcFacing(-diagonal, 0.5),
      lpcFacing(diagonal, 0.5),
    ]).toEqual([0, 1, 2, 3, 4, 5]);
    expect(lpcFacing(0, 0, 5)).toBe(5);
    expect(lpcFacing(0.1, 1)).toBe(0);
    expect(lpcFacing(-0.1, -1)).toBe(2);
  });

  it("shares source texels across left/right views while retaining the mirror instruction", () => {
    for (const direction of [0, 1, 2, 3, 4, 5] as const) {
      const sampled = lpcFrame(catalog, sheet, "stand", direction, 0)!;
      expect(sampled.y).toBe(([0, 256, 384, 256, 128, 128] as const)[direction]);
      expect(!!sampled.mirror).toBe(direction === 1 || direction === 4);
      expect(lpcOppositeFacing(lpcOppositeFacing(direction))).toBe(direction);
    }
    expect(lpcOppositeFacing(4)).toBe(5);
  });

  it("retains source clip duration, loops walking and clamps attacks and reduced motion", () => {
    expect(lpcFrame(catalog, sheet, "walk", 3, 89)?.x).toBe(0);
    expect(lpcFrame(catalog, sheet, "walk", 3, 90)?.x).toBe(128);
    expect(lpcFrame(catalog, sheet, "walk", 3, 270)?.x).toBe(0);
    expect(lpcFrame(catalog, sheet, "slash", 3, 50)?.x).toBe(512);
    expect(lpcFrame(catalog, sheet, "slash", 3, 10000)?.x).toBe(640);
    expect(lpcFrame(catalog, sheet, "walk", 4, 1000, true)).toEqual(
      lpcFrame(catalog, sheet, "walk", 4, 0),
    );
  });

  it("uses side views when a four-view design is sampled at an upper hex facing", () => {
    const fourView: LpcCatalog = {
      ...catalog,
      layouts: [{ ...layout, facings: undefined }],
    };
    for (const [hex, side] of [
      [4, 1],
      [5, 3],
    ] as const)
      expect(lpcFrame(fourView, sheet, "walk", hex as LpcDirection, 90)).toEqual(
        lpcFrame(fourView, sheet, "walk", side, 90),
      );
  });
});
