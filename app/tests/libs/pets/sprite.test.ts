import { describe, expect, it } from "bun:test";
import sharp from "sharp";
import {
  hasBackgroundHaze,
  normalizePetSprite,
  PET_SPRITE_SIZE,
} from "@/libs/pets/sprite";

const MARGIN = 51;
const SAFE = 409;

describe("companion sprite trim and pad", () => {
  it("trims a provider canvas and bottom-aligns the animal on the 10% margin at the stored scale", async () => {
    const image = await canvas(1024, [
      { left: 600, top: 100, width: 200, height: 300 },
    ]);
    const sprite = await normalizePetSprite(image);
    expect(await sharp(sprite).metadata()).toMatchObject({
      format: "webp",
      width: PET_SPRITE_SIZE,
      height: PET_SPRITE_SIZE,
      hasAlpha: true,
    });
    const box = await visibleBox(sprite);
    // 1024px drawings map onto the 512px canvas at half scale; this animal already fits.
    expect(box.width).toBeWithin(99, 102);
    expect(box.height).toBeWithin(149, 152);
    expect(box.bottom).toBeWithin(
      PET_SPRITE_SIZE - MARGIN - 2,
      PET_SPRITE_SIZE - MARGIN,
    );
    expect(
      Math.abs(box.left + box.width / 2 - PET_SPRITE_SIZE / 2),
    ).toBeLessThanOrEqual(1.5);
  });

  it("shrinks a frame-filling animal into the central 80% while keeping its aspect ratio", async () => {
    const sprite = await normalizePetSprite(
      await canvas(1024, [{ left: 0, top: 12, width: 1024, height: 1000 }]),
    );
    const box = await visibleBox(sprite);
    expect(box.width).toBeWithin(SAFE - 2, SAFE + 1);
    expect(box.height).toBeWithin(
      Math.round((SAFE * 1000) / 1024) - 2,
      Math.round((SAFE * 1000) / 1024) + 2,
    );
    expect(box.left).toBeGreaterThanOrEqual(MARGIN - 1);
    expect(box.top).toBeGreaterThanOrEqual(MARGIN - 1);
    expect(PET_SPRITE_SIZE - 1 - box.right).toBeGreaterThanOrEqual(MARGIN - 1);
  });

  it("never enlarges a small early-rank animal beyond its drawn scale", async () => {
    const sprite = await normalizePetSprite(
      await canvas(512, [{ left: 10, top: 10, width: 100, height: 80 }]),
    );
    const box = await visibleBox(sprite);
    expect(box.width).toBe(100);
    expect(box.height).toBe(80);
    expect(box.bottom).toBe(PET_SPRITE_SIZE - MARGIN - 1);
  });

  it("clears faint residue instead of framing it as part of the animal", async () => {
    const image = await canvas(
      512,
      [{ left: 200, top: 200, width: 50, height: 50 }],
      12,
    );
    const sprite = await normalizePetSprite(image);
    const { data } = await sharp(sprite)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0);
    expect((await visibleBox(sprite)).width).toBe(50);
  });

  it("rejects an empty cutout", async () => {
    await expect(normalizePetSprite(await canvas(512, [], 10))).rejects.toThrow(
      "cutout is empty",
    );
  });
});

describe("companion cutout haze detection", () => {
  it("flags a semi-transparent backdrop over the canvas", async () => {
    expect(
      await hasBackgroundHaze(
        await canvas(512, [{ left: 150, top: 150, width: 200, height: 200 }], 30),
      ),
    ).toBe(true);
  });

  it("accepts a clean cutout with only anti-aliased edges", async () => {
    const image = await sharp(
      await canvas(512, [{ left: 150, top: 150, width: 200, height: 200 }]),
    )
      .blur(1.5)
      .png()
      .toBuffer();
    expect(await hasBackgroundHaze(image)).toBe(false);
  });
});

/** A square transparent canvas with opaque red rectangles and an optional uniform background alpha. */
const canvas = async (
  size: number,
  rects: { left: number; top: number; width: number; height: number }[],
  backgroundAlpha = 0,
) => {
  const data = Buffer.alloc(size * size * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = backgroundAlpha;
  for (const rect of rects)
    for (let y = rect.top; y < rect.top + rect.height; y++)
      for (let x = rect.left; x < rect.left + rect.width; x++) {
        const index = (y * size + x) * 4;
        data[index] = 200;
        data[index + 3] = 255;
      }
  return sharp(data, { raw: { width: size, height: size, channels: 4 } })
    .png()
    .toBuffer();
};

/** Bounding box of pixels at least half opaque. */
const visibleBox = async (image: Buffer) => {
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let [left, top, right, bottom] = [info.width, info.height, -1, -1];
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++)
      if ((data[(y * info.width + x) * 4 + 3] ?? 0) >= 128) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  return {
    left,
    top,
    right,
    bottom,
    width: right - left + 1,
    height: bottom - top + 1,
  };
};
