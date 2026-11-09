import { describe, expect, it } from "bun:test";
import sharp from "sharp";
import {
  alignToArt,
  finishSpriteSheet,
  matchColours,
  restorePalette,
  seatFrames,
} from "@/libs/spriteSheetFinish";

const CELL = 32;

/** A frame with one solid rectangle on transparency. */
const frame = (
  box: { left: number; top: number; right: number; bottom: number },
  rgb: [number, number, number] = [200, 40, 40],
) => {
  const pixels = new Uint8Array(CELL * CELL * 4);
  for (let y = box.top; y < box.bottom; y += 1) {
    for (let x = box.left; x < box.right; x += 1) {
      pixels.set([...rgb, 255], (y * CELL + x) * 4);
    }
  }
  return pixels;
};
const alpha = (pixels: Uint8Array, x: number, y: number) =>
  pixels[(y * CELL + x) * 4 + 3];
const lowestSolidRow = (pixels: Uint8Array) => {
  for (let y = CELL - 1; y >= 0; y -= 1)
    for (let x = 0; x < CELL; x += 1) if (alpha(pixels, x, y)) return y;
  return -1;
};

describe("alignToArt", () => {
  it("moves every frame by the transform that lays the first frame over the art", () => {
    const art = frame({ left: 8, top: 8, right: 24, bottom: 24 });
    const first = frame({ left: 12, top: 12, right: 20, bottom: 20 });
    const moved = frame({ left: 14, top: 12, right: 22, bottom: 20 });
    const [placed, shifted] = alignToArt([first, moved], art, CELL) as [
      Uint8Array,
      Uint8Array,
    ];
    expect(alpha(placed, 8, 8)).toBe(255);
    expect(alpha(placed, 23, 23)).toBe(255);
    expect(alpha(placed, 7, 8)).toBe(0);
    expect(alpha(shifted, 8, 8)).toBe(0);
    expect(alpha(shifted, 12, 8)).toBe(255);
  });

  it("leaves empty frames alone", () => {
    const empty = new Uint8Array(CELL * CELL * 4);
    expect(
      alignToArt([empty], frame({ left: 1, top: 1, right: 9, bottom: 9 }), CELL),
    ).toEqual([empty]);
  });
});

describe("seatFrames", () => {
  it("lifts a frame that sinks below the first frame's contact and keeps the first still", () => {
    const rest = frame({ left: 8, top: 4, right: 24, bottom: 20 });
    const sunk = frame({ left: 8, top: 10, right: 24, bottom: 26 });
    const seated = seatFrames([rest, rest, sunk, rest], CELL);
    expect(seated[0]).toEqual(rest);
    expect(lowestSolidRow(seated[2] as Uint8Array)).toBe(21);
  });

  it("drops a detached shadow under the feet", () => {
    const rest = frame({ left: 8, top: 4, right: 24, bottom: 20 });
    const shadowed = rest.slice();
    for (let x = 10; x < 20; x += 1) shadowed.set([0, 0, 0, 90], (24 * CELL + x) * 4);
    const seated = seatFrames([rest, shadowed], CELL);
    expect(alpha(seated[1] as Uint8Array, 12, 24)).toBe(0);
  });
});

describe("restorePalette", () => {
  it("repaints colours the art never used and keeps the ones it did", () => {
    const art = frame({ left: 4, top: 4, right: 28, bottom: 28 }, [40, 60, 200]);
    const tinted = frame({ left: 4, top: 4, right: 28, bottom: 28 }, [40, 60, 200]);
    tinted.set([30, 220, 40, 255], (10 * CELL + 10) * 4);
    const [restored] = restorePalette([tinted], art, CELL) as [Uint8Array];
    expect([
      ...restored.subarray((10 * CELL + 10) * 4, (10 * CELL + 10) * 4 + 3),
    ]).toEqual([40, 60, 200]);
    expect(restored[(5 * CELL + 5) * 4 + 2]).toBe(200);
  });
});

describe("matchColours", () => {
  it("pulls a brighter frame back toward the art", () => {
    const art = frame({ left: 4, top: 4, right: 28, bottom: 28 }, [100, 100, 100]);
    const bright = frame({ left: 4, top: 4, right: 28, bottom: 28 }, [140, 140, 140]);
    const [matched] = matchColours([bright], art, CELL) as [Uint8Array];
    expect(matched[(5 * CELL + 5) * 4]).toBe(106);
  });
});

describe("finishSpriteSheet", () => {
  const solid = (width: number, height: number) =>
    sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 200, g: 40, b: 40, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

  it("writes 256 and 128 pixel atlases for the same grid", async () => {
    const grid = { columns: 2, rows: 1, frameCount: 2 };
    const result = await finishSpriteSheet(
      await solid(512, 256),
      await solid(64, 64),
      grid,
    );
    const [large, small] = await Promise.all([
      sharp(result.large).metadata(),
      sharp(result.small).metadata(),
    ]);
    expect([large.format, large.width, large.height]).toEqual(["webp", 512, 256]);
    expect([small.format, small.width, small.height]).toEqual(["webp", 256, 128]);
  });

  it("refuses a sheet that does not match its reported grid", async () => {
    const grid = { columns: 2, rows: 2, frameCount: 4 };
    await expect(
      finishSpriteSheet(await solid(512, 256), await solid(64, 64), grid),
    ).rejects.toThrow();
  });
});
