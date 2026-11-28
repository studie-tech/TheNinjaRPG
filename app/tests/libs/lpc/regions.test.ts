import { expect, it } from "bun:test";
import sharp from "sharp";
import { type LpcCatalog, lpcFrame } from "@/libs/lpc/catalog";
import { lpcAtlasFrame } from "@/libs/lpc/frames";
import { packLpcTravel, validateLpcAtlas } from "@/libs/lpc/import";
import { lpcLayoutValidator } from "@/validators/lpcAsset";

const layout = lpcLayoutValidator.parse({
  cell: 64,
  columns: 1,
  pixelsPerUnit: 64,
  ground: { x: 32, y: 60 },
  clips: {
    stand: [[0], [0], [0], [0]],
    walk: [
      [0, 1],
      [0, 1],
      [0, 1],
      [0, 1],
    ],
  },
  frameMs: { walk: 40 },
  regions: {
    stand: { x: 0, y: 0, columns: 1, trim: { x: 4, y: 9, width: 1, height: 2 } },
    walk: { x: 12, y: 0, columns: 2, trim: { x: 10, y: 20, width: 2, height: 1 } },
  },
});

it("samples independently cropped native portrait poses and rejects missing or oversized cells", async () => {
  const native = {
    cell: 640,
    columns: 1,
    pixelsPerUnit: 128000 / 381,
    clips: {
      walk: [
        [0, 1],
        [0, 1],
        [0, 1],
        [0, 1],
      ],
    },
    frameMs: { walk: 100 },
    cells: [
      { x: 1, y: 1, trim: { x: 300, y: 310, width: 2, height: 3 } },
      { x: 5, y: 1, trim: { x: 340, y: 350, width: 1, height: 4 } },
    ],
  };
  const parsed = lpcLayoutValidator.parse(native);
  const image = await sharp({
    create: { width: 7, height: 6, channels: 4, background: "white" },
  })
    .png()
    .toBuffer();
  await validateLpcAtlas(image, parsed);
  expect(lpcAtlasFrame(parsed, "walk", 0)).toMatchObject({
    x: 1,
    y: 1,
    width: 2,
    height: 3,
    trim: native.cells[0]!.trim,
  });
  expect(lpcAtlasFrame(parsed, "walk", 1)).toMatchObject({
    x: 5,
    y: 1,
    width: 1,
    height: 4,
    trim: native.cells[1]!.trim,
  });
  expect(
    lpcLayoutValidator.safeParse({ ...native, cells: native.cells.slice(0, 1) })
      .success,
  ).toBe(false);
  expect(
    lpcLayoutValidator.safeParse({
      ...native,
      cells: [
        { ...native.cells[0], trim: { x: 639, y: 0, width: 2, height: 1 } },
        native.cells[1],
      ],
    }).success,
  ).toBe(false);
});

it("samples animation-specific atlas crops, local frame indices and a correctly located neutral fallback", () => {
  const catalog: LpcCatalog = { entries: {}, designs: {}, layouts: [layout] };
  const sheet = { image: "https://example.com/sprites.png", layout: 0, z: 0 };
  expect(lpcFrame(catalog, sheet, "walk", 2, 0)).toMatchObject({
    x: 13,
    y: 1,
    width: 2,
    height: 1,
    trim: { x: 10, y: 20, width: 2, height: 1 },
    ground: { x: 32, y: 60 },
  });
  expect(lpcFrame(catalog, sheet, "walk", 2, 40)?.x).toBe(17);
  expect(lpcFrame(catalog, sheet, "walk", 2, 80)?.x).toBe(13);
  expect(lpcFrame(catalog, sheet, "slash", 2, 1000)).toMatchObject({
    x: 1,
    y: 1,
    width: 1,
    height: 2,
    trim: { x: 4, y: 9, width: 1, height: 2 },
  });
  expect(
    lpcLayoutValidator.safeParse({
      ...layout,
      regions: { ...layout.regions, walk: { ...layout.regions!.walk!, x: 2047 } },
    }).success,
  ).toBe(false);
  expect(
    lpcLayoutValidator.safeParse({
      ...layout,
      regions: {
        ...layout.regions,
        walk: { ...layout.regions!.walk!, trim: { x: 63, y: 20, width: 2, height: 1 } },
      },
    }).success,
  ).toBe(false);
  expect(
    lpcLayoutValidator.safeParse({
      ...layout,
      regions: { ...layout.regions, die: layout.regions!.walk },
    }).success,
  ).toBe(false);
});

it("validates a compact regional image and exports movement without confusing equal indices from different clips", async () => {
  const width = 32,
    height = 8,
    pixels = Buffer.alloc(width * height * 4);
  const put = (x: number, y: number, color: number[]) =>
    pixels.set(color, (y * width + x) * 4);
  put(1, 1, [255, 0, 0, 255]);
  put(1, 2, [255, 0, 0, 128]);
  put(13, 1, [0, 0, 255, 255]);
  put(14, 1, [0, 255, 0, 255]);
  put(17, 1, [255, 255, 0, 255]);
  put(18, 1, [255, 255, 255, 255]);
  const bytes = await sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
  await validateLpcAtlas(bytes, layout);
  const undersized = await sharp({
    create: { width: 16, height, channels: 4, background: "transparent" },
  })
    .png()
    .toBuffer();
  await expect(validateLpcAtlas(undersized, layout)).rejects.toThrow("outside");
  const packed = await packLpcTravel(bytes, layout);
  expect(packed?.layout).toMatchObject({
    pixelsPerUnit: 64,
    ground: { x: 32, y: 60 },
    frameMs: { walk: 40 },
    trim: { x: 4, y: 9, width: 8, height: 12 },
  });
  await validateLpcAtlas(packed!.bytes, packed!.layout);
  const decoded = await sharp(packed!.bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const color = (animation: "stand" | "walk", step: number, x: number, y: number) => {
    const index = packed!.layout.clips[animation]![2]![step]!;
    const frame = lpcAtlasFrame(packed!.layout, animation, index);
    const at =
      ((frame.y + y - frame.trim!.y) * decoded.info.width +
        frame.x +
        x -
        frame.trim!.x) *
      4;
    return [...decoded.data.slice(at, at + 4)];
  };
  expect(color("stand", 0, 4, 9)).toEqual([255, 0, 0, 255]);
  expect(color("stand", 0, 4, 10)).toEqual([255, 0, 0, 128]);
  expect(color("walk", 0, 10, 20)).toEqual([0, 0, 255, 255]);
  expect(color("walk", 1, 10, 20)).toEqual([255, 255, 0, 255]);
});
